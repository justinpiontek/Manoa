import { recurrenceRule, type RecurrenceSpec } from './recurrence'
import type { Invitee } from '../sms/invitees'
import { google } from 'googleapis'
import type { Credentials } from 'google-auth-library'
import { appUrl, requiredEnv } from '../env'
import { supabaseAdmin } from '../supabaseAdmin'
import { addMinutes, endOfDay, formatSmsDate, formatSmsTime, overlaps, setTime, startOfDay } from './dates'

export type CalendarConnection = {
  id: string
  profile_id: string
  provider: 'google'
  calendar_id: string
  access_token: string
  refresh_token: string | null
  expires_at: string | null
  status: string
}

export type ScheduleOption = {
  title: string
  start: string
  end: string
  calendarId: string
  calendarName: string
  dayLabel: string
  timeLabel: string
  attendees?: Invitee[]
  recurrence?: RecurrenceSpec | null
}

export type EventSummary = {
  id: string
  title: string
  start: string
  end: string
  calendarId: string
  calendarName: string
  timeLabel: string
  location: string
  description: string
  organizerEmail: string
  attendeeCount: number
}

export function googleOAuthClient() {
  return new google.auth.OAuth2(
    requiredEnv('GOOGLE_CLIENT_ID'),
    requiredEnv('GOOGLE_CLIENT_SECRET'),
    process.env.GOOGLE_REDIRECT_URI || `${appUrl()}/api/calendar/google/callback`,
  )
}

export function googleAuthUrl(profileId: string) {
  return googleOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    state: profileId,
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.freebusy',
    ],
  })
}

export async function storeGoogleConnection(profileId: string, tokens: Credentials) {
  const { error } = await supabaseAdmin.from('calendar_connections').upsert(
    {
      profile_id: profileId,
      provider: 'google',
      calendar_id: 'primary',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      status: 'active',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id,provider,calendar_id' },
  )

  if (error) throw error
}

export async function getGoogleConnection(profileId: string) {
  const { data, error } = await supabaseAdmin
    .from('calendar_connections')
    .select('id,profile_id,provider,calendar_id,access_token,refresh_token,expires_at,status')
    .eq('profile_id', profileId)
    .eq('provider', 'google')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle<CalendarConnection>()

  if (error) throw error
  return data
}

async function calendarForProfile(profileId: string) {
  const connection = await getGoogleConnection(profileId)
  if (!connection) return null

  const auth = googleOAuthClient()
  auth.setCredentials({
    access_token: connection.access_token,
    refresh_token: connection.refresh_token || undefined,
    expiry_date: connection.expires_at ? new Date(connection.expires_at).getTime() : undefined,
  })

  return {
    calendar: google.calendar({ version: 'v3', auth }),
    connection,
  }
}

export async function hasGoogleCalendar(profileId: string) {
  return Boolean(await getGoogleConnection(profileId))
}

export async function listAgenda(profileId: string, day: 'today' | 'tomorrow') {
  const client = await calendarForProfile(profileId)
  if (!client) return []

  const offset = day === 'tomorrow' ? 1 : 0
  const response = await client.calendar.events.list({
    calendarId: client.connection.calendar_id,
    timeMin: startOfDay(offset).toISOString(),
    timeMax: endOfDay(offset).toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 8,
  })

  return (response.data.items || []).map((event) => ({
    id: event.id || '',
    title: event.summary || 'Untitled event',
    start: event.start?.dateTime || event.start?.date || '',
    end: event.end?.dateTime || event.end?.date || '',
    calendarId: client.connection.calendar_id,
    calendarName: 'Google Calendar',
    timeLabel: event.start?.dateTime
      ? formatSmsTime(new Date(event.start.dateTime))
      : 'All day',
    location: event.location || '',
    description: event.description || '',
    organizerEmail: event.organizer?.email || '',
    attendeeCount: event.attendees?.length || 0,
  }))
}

async function busyBlocks(
  profileId: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
) {
  const client = await calendarForProfile(profileId)
  if (!client) return []

  const response = await client.calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: calendarId }],
    },
  })

  return (response.data.calendars?.[calendarId]?.busy || []).flatMap((item) => {
    if (!item.start || !item.end) return []
    return [{ start: new Date(item.start), end: new Date(item.end) }]
  })
}

export async function findScheduleOptions({
  profileId,
  title,
  baseDate,
  exactTime,
  calendarHint,
  durationMinutes = 30,
  recurrence = null,
}: {
  profileId: string
  title: string
  baseDate: Date
  exactTime?: { hour: number; minute: number } | null
  calendarHint?: string
  durationMinutes?: number
  recurrence?: RecurrenceSpec | null
}) {
  const client = await calendarForProfile(profileId)
  if (!client) return []

  const calendarId = client.connection.calendar_id
  const candidateStarts = exactTime
    ? [
        setTime(baseDate, exactTime),
        addMinutes(setTime(baseDate, exactTime), 60),
        addMinutes(setTime(baseDate, exactTime), 120),
      ]
    : [
        setTime(baseDate, { hour: 9, minute: 0 }),
        setTime(baseDate, { hour: 11, minute: 0 }),
        setTime(baseDate, { hour: 14, minute: 30 }),
      ]

  const timeMin = candidateStarts[0]
  const timeMax = addMinutes(candidateStarts[candidateStarts.length - 1], durationMinutes)
  const busy = await busyBlocks(profileId, calendarId, timeMin, timeMax)

  return candidateStarts
    .map((start) => ({
      start,
      end: addMinutes(start, durationMinutes),
    }))
    .filter((candidate) => !overlaps(candidate, busy))
    .slice(0, 3)
    .map<ScheduleOption>((candidate) => ({
      title,
      start: candidate.start.toISOString(),
      end: candidate.end.toISOString(),
      calendarId,
      calendarName: calendarHint || 'Google Calendar',
      dayLabel: formatSmsDate(candidate.start),
      timeLabel: formatSmsTime(candidate.start),
      recurrence,
    }))
}

export async function createCalendarEvent(profileId: string, option: ScheduleOption) {
  const client = await calendarForProfile(profileId)
  if (!client) throw new Error('Google Calendar is not connected.')
  const recurrence = option.recurrence ? recurrenceRule(option.recurrence, option.start) : null

  const response = await client.calendar.events.insert({
    calendarId: option.calendarId || client.connection.calendar_id,
    sendUpdates: option.attendees?.length ? 'all' : 'none',
    requestBody: {
      summary: option.title,
      start: {
        dateTime: option.start,
      },
      end: {
        dateTime: option.end,
      },
      attendees: option.attendees?.map((invitee) => ({
        email: invitee.email,
        displayName: invitee.displayName || undefined,
      })),
      recurrence: recurrence ? [recurrence] : undefined,
    },
  })

  return response.data
}

export async function updateCalendarEvent(
  profileId: string,
  eventId: string,
  option: ScheduleOption,
  sendUpdates: 'all' | 'none' = 'none',
) {
  const client = await calendarForProfile(profileId)
  if (!client) throw new Error('Google Calendar is not connected.')

  const response = await client.calendar.events.patch({
    calendarId: option.calendarId || client.connection.calendar_id,
    eventId,
    sendUpdates,
    requestBody: {
      summary: option.title,
      start: {
        dateTime: option.start,
      },
      end: {
        dateTime: option.end,
      },
    },
  })

  return response.data
}

export async function deleteCalendarEvent(
  profileId: string,
  eventId: string,
  calendarId?: string,
  sendUpdates: 'all' | 'none' = 'none',
) {
  const client = await calendarForProfile(profileId)
  if (!client) throw new Error('Google Calendar is not connected.')

  await client.calendar.events.delete({
    calendarId: calendarId || client.connection.calendar_id,
    eventId,
    sendUpdates,
  })
}
