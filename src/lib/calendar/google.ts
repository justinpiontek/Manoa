import { recurrenceRule, type RecurrenceSpec } from './recurrence'
import type { Invitee } from '../sms/invitees'
import { google, type calendar_v3 } from 'googleapis'
import type { Credentials } from 'google-auth-library'
import { appUrl, requiredEnv } from '../env'
import { supabaseAdmin } from '../supabaseAdmin'
import {
  addMinutes,
  endOfDay,
  formatSmsDate,
  formatSmsTime,
  overlaps,
  setTime,
  startOfDay,
} from './dates'

export type CalendarConnection = {
  id: string
  profile_id: string
  provider: 'google'
  account_id: string
  account_email: string | null
  calendar_id: string
  calendar_name: string
  calendar_label: string | null
  access_token: string
  refresh_token: string | null
  expires_at: string | null
  access_role: string
  is_primary: boolean
  include_in_conflicts: boolean
  allow_new_events: boolean
  status: string
}

export type ConfiguredCalendar = {
  connectionId: string
  accountId: string
  accountEmail: string | null
  calendarId: string
  provider: 'google'
  sourceName: string
  label: string
  includeInConflicts: boolean
  allowNewEvents: boolean
  canWrite: boolean
  isPrimary: boolean
}

export type ConfiguredGoogleAccount = {
  accountId: string
  accountEmail: string | null
  calendars: ConfiguredCalendar[]
}

export type CalendarPlacementOption = {
  connectionId: string
  accountId: string
  accountEmail: string | null
  calendarId: string
  calendarName: string
  calendarLabel: string
  provider: 'google'
}

export type CalendarPlacementResolution = {
  genericHint: boolean
  bookingCalendars: CalendarPlacementOption[]
  matches: CalendarPlacementOption[]
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
  recurrence?: string[] | null
  recurringEventId?: string | null
  originalStart?: string | null
}

type GoogleCalendarDescriptor = {
  id: string
  name: string
  primary: boolean
  selected: boolean
  hidden: boolean
  accessRole: string
}

export function googleOAuthClient() {
  return new google.auth.OAuth2(
    requiredEnv('GOOGLE_CLIENT_ID'),
    requiredEnv('GOOGLE_CLIENT_SECRET'),
    process.env.GOOGLE_REDIRECT_URI || `${appUrl()}/api/calendar/google/callback`,
  )
}

export function googleAuthUrl(state: string) {
  return googleOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.freebusy',
    ],
  })
}

function accountEmailFromId(accountId: string) {
  return accountId.includes('@') ? accountId : null
}

function normalizeCalendarText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function canWriteToCalendar(accessRole: string) {
  return accessRole === 'owner' || accessRole === 'writer'
}

function isSystemCalendar(calendar: GoogleCalendarDescriptor) {
  const id = calendar.id.toLowerCase()
  const name = calendar.name.toLowerCase()

  return (
    id.includes('holiday.calendar.google.com') ||
    id.includes('#contacts@group.v.calendar.google.com') ||
    name === 'birthdays' ||
    name.includes('holidays')
  )
}

function displayCalendarName(connection: CalendarConnection) {
  return connection.calendar_label?.trim() || connection.calendar_name || 'Google Calendar'
}

function mapGoogleEvent(
  event: calendar_v3.Schema$Event,
  connection: Pick<CalendarConnection, 'calendar_id' | 'calendar_name' | 'calendar_label'>,
) {
  return {
    id: event.id || '',
    title: event.summary || 'Untitled event',
    start: event.start?.dateTime || event.start?.date || '',
    end: event.end?.dateTime || event.end?.date || '',
    calendarId: connection.calendar_id,
    calendarName: connection.calendar_label?.trim() || connection.calendar_name || 'Google Calendar',
    timeLabel: event.start?.dateTime ? formatSmsTime(new Date(event.start.dateTime)) : 'All day',
    location: event.location || '',
    description: event.description || '',
    organizerEmail: event.organizer?.email || '',
    attendeeCount: event.attendees?.length || 0,
    recurrence: event.recurrence || null,
    recurringEventId: event.recurringEventId || null,
    originalStart: event.originalStartTime?.dateTime || event.originalStartTime?.date || null,
  } satisfies EventSummary
}

function googleClientFromTokens(tokens: Credentials) {
  const auth = googleOAuthClient()
  auth.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || undefined,
    expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).getTime() : undefined,
  })

  return google.calendar({ version: 'v3', auth })
}

async function loadGoogleCalendarDescriptors(calendar: calendar_v3.Calendar) {
  const calendars: GoogleCalendarDescriptor[] = []
  let pageToken: string | undefined

  do {
    const response = await calendar.calendarList.list({
      minAccessRole: 'freeBusyReader',
      pageToken,
      showDeleted: false,
      showHidden: false,
    })

    for (const item of response.data.items || []) {
      if (!item.id) continue

      calendars.push({
        id: item.id,
        name: item.summary || item.id,
        primary: Boolean(item.primary),
        selected: item.selected !== false,
        hidden: Boolean(item.hidden),
        accessRole: item.accessRole || 'freeBusyReader',
      })
    }

    pageToken = response.data.nextPageToken || undefined
  } while (pageToken)

  return calendars
}

function uniqueAccountIds(connections: CalendarConnection[]) {
  return [...new Set(connections.map((connection) => connection.account_id).filter(Boolean))]
}

function groupConnectionsByAccount(connections: CalendarConnection[]) {
  return connections.reduce<Record<string, CalendarConnection[]>>((groups, connection) => {
    groups[connection.account_id] ||= []
    groups[connection.account_id].push(connection)
    return groups
  }, {})
}

function visibleConfiguredCalendars(connections: CalendarConnection[]) {
  const visible = connections.filter((connection) => !isSystemCalendar({
    id: connection.calendar_id,
    name: connection.calendar_name,
    primary: connection.is_primary,
    selected: true,
    hidden: false,
    accessRole: connection.access_role,
  }))

  return visible.length ? visible : connections
}

function deriveDefaultCalendarLabel({
  descriptor,
  existingLabel,
  existingAccountIds,
}: {
  descriptor: GoogleCalendarDescriptor
  existingLabel?: string | null
  existingAccountIds: string[]
}) {
  if (existingLabel?.trim()) return existingLabel.trim()
  if (descriptor.primary && existingAccountIds.length === 0) return 'Personal'
  return descriptor.name || descriptor.id
}

export async function getGoogleConnection(profileId: string) {
  const [connection] = await getGoogleConnections(profileId)
  return connection || null
}

async function getGoogleConnections(profileId: string) {
  const { data, error } = await supabaseAdmin
    .from('calendar_connections')
    .select(
      'id,profile_id,provider,account_id,account_email,calendar_id,calendar_name,calendar_label,access_token,refresh_token,expires_at,access_role,is_primary,include_in_conflicts,allow_new_events,status',
    )
    .eq('profile_id', profileId)
    .eq('provider', 'google')
    .eq('status', 'active')
    .order('account_email', { ascending: true, nullsFirst: false })
    .order('is_primary', { ascending: false })
    .order('calendar_name', { ascending: true })

  if (error) throw error
  return (data || []) as CalendarConnection[]
}

async function calendarForConnection(connection: CalendarConnection) {
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

async function calendarForProfile(
  profileId: string,
  options?: { calendarId?: string; accountId?: string },
) {
  const connections = await getGoogleConnections(profileId)
  const connection =
    (options?.calendarId
      ? connections.find((item) => item.calendar_id === options.calendarId)
      : null) ||
    (options?.accountId
      ? connections.find((item) => item.account_id === options.accountId)
      : null) ||
    connections[0]

  if (!connection) return null
  return calendarForConnection(connection)
}

export async function hasGoogleCalendar(profileId: string) {
  return Boolean(await getGoogleConnection(profileId))
}

export async function storeGoogleConnection(
  profileId: string,
  tokens: Credentials,
  options?: { reconnectAccountId?: string | null },
) {
  const calendar = googleClientFromTokens(tokens)
  const descriptors = await loadGoogleCalendarDescriptors(calendar)
  const usableDescriptors = descriptors.filter((item) => !item.hidden && !isSystemCalendar(item))
  const persistedDescriptors = usableDescriptors.length ? usableDescriptors : descriptors.filter((item) => !isSystemCalendar(item))
  const primaryDescriptor = descriptors.find((item) => item.primary) || persistedDescriptors[0]

  if (!primaryDescriptor) {
    throw new Error('Google Calendar account did not return any calendars.')
  }

  const existingConnections = await getGoogleConnections(profileId)
  const existingAccountIds = uniqueAccountIds(existingConnections)
  const accountId = primaryDescriptor.id

  if (!existingAccountIds.includes(accountId) && existingAccountIds.length >= 2) {
    throw new Error('Manoa supports up to 2 Google accounts right now.')
  }

  const existingByCalendarId = new Map(
    existingConnections
      .filter((connection) => connection.account_id === accountId)
      .map((connection) => [connection.calendar_id, connection]),
  )

  await supabaseAdmin
    .from('calendar_connections')
    .update({
      status: 'inactive',
      updated_at: new Date().toISOString(),
    })
    .eq('profile_id', profileId)
    .eq('provider', 'google')
    .eq('account_id', options?.reconnectAccountId || accountId)

  const rows = persistedDescriptors.map((descriptor) => {
    const existing = existingByCalendarId.get(descriptor.id)
    const writable = canWriteToCalendar(descriptor.accessRole)

    return {
      profile_id: profileId,
      provider: 'google',
      account_id: accountId,
      account_email: accountEmailFromId(accountId),
      calendar_id: descriptor.id,
      calendar_name: descriptor.name,
      calendar_label: deriveDefaultCalendarLabel({
        descriptor,
        existingLabel: existing?.calendar_label,
        existingAccountIds,
      }),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || existing?.refresh_token || null,
      expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : existing?.expires_at || null,
      access_role: descriptor.accessRole,
      is_primary: descriptor.primary,
      include_in_conflicts: existing?.include_in_conflicts ?? descriptor.selected,
      allow_new_events: existing?.allow_new_events ?? writable,
      status: 'active',
      updated_at: new Date().toISOString(),
    }
  })

  const { error } = await supabaseAdmin.from('calendar_connections').upsert(rows, {
    onConflict: 'profile_id,provider,calendar_id',
  })

  if (error) throw error

  return {
    accountId,
    accountEmail: accountEmailFromId(accountId),
    calendarCount: rows.length,
  }
}

export async function listConfiguredGoogleCalendars(profileId: string) {
  const connections = visibleConfiguredCalendars(await getGoogleConnections(profileId))
  const accounts = groupConnectionsByAccount(connections)

  return Object.values(accounts)
    .map((group) => {
      const sortedCalendars = [...group]
        .sort((left, right) => {
          if (left.allow_new_events !== right.allow_new_events) {
            return left.allow_new_events ? -1 : 1
          }

          if (left.is_primary !== right.is_primary) {
            return left.is_primary ? -1 : 1
          }

          return displayCalendarName(left).localeCompare(displayCalendarName(right))
        })
        .map<ConfiguredCalendar>((connection) => ({
          connectionId: connection.id,
          accountId: connection.account_id,
          accountEmail: connection.account_email,
          calendarId: connection.calendar_id,
          provider: 'google',
          sourceName: connection.calendar_name,
          label: displayCalendarName(connection),
          includeInConflicts: connection.include_in_conflicts,
          allowNewEvents: connection.allow_new_events,
          canWrite: canWriteToCalendar(connection.access_role),
          isPrimary: connection.is_primary,
        }))

      return {
        accountId: group[0].account_id,
        accountEmail: group[0].account_email,
        calendars: sortedCalendars,
      } satisfies ConfiguredGoogleAccount
    })
    .sort((left, right) => (left.accountEmail || left.accountId).localeCompare(right.accountEmail || right.accountId))
}

export async function updateConfiguredGoogleCalendar({
  profileId,
  connectionId,
  calendarLabel,
  includeInConflicts,
  allowNewEvents,
}: {
  profileId: string
  connectionId: string
  calendarLabel: string
  includeInConflicts: boolean
  allowNewEvents: boolean
}) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('calendar_connections')
    .select('id,profile_id,calendar_name,access_role')
    .eq('id', connectionId)
    .eq('profile_id', profileId)
    .eq('provider', 'google')
    .eq('status', 'active')
    .maybeSingle<{
      id: string
      profile_id: string
      calendar_name: string
      access_role: string
    }>()

  if (existingError) throw existingError
  if (!existing) throw new Error('Calendar connection not found.')

  const sanitizedLabel = calendarLabel.trim() || existing.calendar_name
  const writable = canWriteToCalendar(existing.access_role)

  const { error } = await supabaseAdmin
    .from('calendar_connections')
    .update({
      calendar_label: sanitizedLabel,
      include_in_conflicts: includeInConflicts,
      allow_new_events: writable ? allowNewEvents : false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connectionId)
    .eq('profile_id', profileId)

  if (error) throw error
}

function toPlacementOption(connection: CalendarConnection): CalendarPlacementOption {
  return {
    connectionId: connection.id,
    accountId: connection.account_id,
    accountEmail: connection.account_email,
    calendarId: connection.calendar_id,
    calendarName: connection.calendar_name,
    calendarLabel: displayCalendarName(connection),
    provider: 'google',
  }
}

export async function resolveCalendarPlacement(
  profileId: string,
  calendarHint?: string,
): Promise<CalendarPlacementResolution> {
  const connections = visibleConfiguredCalendars(await getGoogleConnections(profileId))
  const writableConnections = connections.filter((connection) => connection.allow_new_events)
  const bookingConnections = writableConnections.length
    ? writableConnections
    : connections.filter((connection) => canWriteToCalendar(connection.access_role))

  const bookingCalendars = bookingConnections.map(toPlacementOption)
  const normalizedHint = normalizeCalendarText(calendarHint || '')
  const genericHint = !normalizedHint || normalizedHint === normalizeCalendarText('Google Calendar')

  if (genericHint) {
    return {
      genericHint: true,
      bookingCalendars,
      matches: bookingCalendars,
    }
  }

  const hintWords = normalizedHint.split(' ').filter(Boolean)
  const matches = bookingCalendars.filter((calendar) => {
    const label = normalizeCalendarText(calendar.calendarLabel)
    const sourceName = normalizeCalendarText(calendar.calendarName)
    const id = normalizeCalendarText(calendar.calendarId)

    return (
      label === normalizedHint ||
      sourceName === normalizedHint ||
      id === normalizedHint ||
      label.includes(normalizedHint) ||
      sourceName.includes(normalizedHint) ||
      hintWords.every((word) => label.includes(word) || sourceName.includes(word))
    )
  })

  return {
    genericHint: false,
    bookingCalendars,
    matches,
  }
}

function groupedAvailabilityConnections(connections: CalendarConnection[]) {
  const included = connections.filter((connection) => connection.include_in_conflicts)
  return groupConnectionsByAccount(included.length ? included : connections)
}

async function listEventsBetween({
  profileId,
  timeMin,
  timeMax,
  maxResults = 20,
}: {
  profileId: string
  timeMin: Date
  timeMax: Date
  maxResults?: number
}) {
  const connections = visibleConfiguredCalendars(await getGoogleConnections(profileId))
  if (!connections.length) return []

  const grouped = groupedAvailabilityConnections(connections)
  const eventLists = await Promise.all(
    Object.values(grouped).map(async (accountConnections) => {
      const client = await calendarForConnection(accountConnections[0])

      const accountEventLists = await Promise.all(
        accountConnections.map(async (connection) => {
          const response = await client.calendar.events.list({
            calendarId: connection.calendar_id,
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults,
          })

          return (response.data.items || []).map((event) => mapGoogleEvent(event, connection))
        }),
      )

      return accountEventLists.flat()
    }),
  )

  return eventLists
    .flat()
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())
    .slice(0, maxResults)
}

export async function listAgenda(profileId: string, day: 'today' | 'tomorrow') {
  const offset = day === 'tomorrow' ? 1 : 0
  return listEventsBetween({
    profileId,
    timeMin: startOfDay(offset),
    timeMax: endOfDay(offset),
    maxResults: 8,
  })
}

export async function listUpcomingEvents({
  profileId,
  windowMinutes,
  startAt = new Date(),
  maxResults = 20,
}: {
  profileId: string
  windowMinutes: number
  startAt?: Date
  maxResults?: number
}) {
  return listEventsBetween({
    profileId,
    timeMin: startAt,
    timeMax: addMinutes(startAt, windowMinutes),
    maxResults,
  })
}

export async function getCalendarEvent(profileId: string, eventId: string, calendarId?: string) {
  const connections = await getGoogleConnections(profileId)
  if (!connections.length) return null

  const targetConnections = calendarId
    ? connections.filter((connection) => connection.calendar_id === calendarId)
    : connections

  for (const connection of targetConnections) {
    const client = await calendarForConnection(connection)

    try {
      const response = await client.calendar.events.get({
        calendarId: connection.calendar_id,
        eventId,
      })

      return mapGoogleEvent(response.data, connection)
    } catch (error) {
      const status =
        (error as { code?: number; response?: { status?: number } }).code ||
        (error as { response?: { status?: number } }).response?.status

      if (status === 404) continue
      throw error
    }
  }

  return null
}

async function busyBlocks(
  connections: CalendarConnection[],
  timeMin: Date,
  timeMax: Date,
) {
  if (!connections.length) return []

  const grouped = groupedAvailabilityConnections(connections)
  const busyLists = await Promise.all(
    Object.values(grouped).map(async (accountConnections) => {
      const client = await calendarForConnection(accountConnections[0])
      const response = await client.calendar.freebusy.query({
        requestBody: {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          items: accountConnections.map((connection) => ({ id: connection.calendar_id })),
        },
      })

      return accountConnections.flatMap((connection) =>
        (response.data.calendars?.[connection.calendar_id]?.busy || []).flatMap((item) => {
          if (!item.start || !item.end) return []
          return [{ start: new Date(item.start), end: new Date(item.end) }]
        }),
      )
    }),
  )

  return busyLists.flat()
}

function chooseTargetConnection({
  connections,
  calendarId,
  calendarHint,
}: {
  connections: CalendarConnection[]
  calendarId?: string
  calendarHint?: string
}) {
  if (!connections.length) return null

  if (calendarId) {
    return connections.find((connection) => connection.calendar_id === calendarId) || null
  }

  const normalizedHint = normalizeCalendarText(calendarHint || '')
  if (normalizedHint && normalizedHint !== normalizeCalendarText('Google Calendar')) {
    const hintWords = normalizedHint.split(' ').filter(Boolean)
    const matched =
      connections.find((connection) => normalizeCalendarText(displayCalendarName(connection)) === normalizedHint) ||
      connections.find((connection) => normalizeCalendarText(connection.calendar_name) === normalizedHint) ||
      connections.find((connection) => normalizeCalendarText(displayCalendarName(connection)).includes(normalizedHint)) ||
      connections.find((connection) => hintWords.every((word) => normalizeCalendarText(displayCalendarName(connection)).includes(word)))

    if (matched) return matched
  }

  return (
    connections.find((connection) => connection.is_primary) ||
    connections[0]
  )
}

export async function findScheduleOptions({
  profileId,
  title,
  baseDate,
  exactTime,
  calendarHint,
  calendarId,
  durationMinutes = 30,
  recurrence = null,
}: {
  profileId: string
  title: string
  baseDate: Date
  exactTime?: { hour: number; minute: number } | null
  calendarHint?: string
  calendarId?: string
  durationMinutes?: number
  recurrence?: RecurrenceSpec | null
}) {
  const connections = visibleConfiguredCalendars(await getGoogleConnections(profileId))
  if (!connections.length) return []

  const writableConnections = connections.filter((connection) => connection.allow_new_events)
  const bookingConnections = writableConnections.length
    ? writableConnections
    : connections.filter((connection) => canWriteToCalendar(connection.access_role))

  const targetConnection = chooseTargetConnection({
    connections: bookingConnections,
    calendarId,
    calendarHint,
  })
  if (!targetConnection) return []

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
  const busy = await busyBlocks(connections, timeMin, timeMax)

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
      calendarId: targetConnection.calendar_id,
      calendarName: displayCalendarName(targetConnection),
      dayLabel: formatSmsDate(candidate.start),
      timeLabel: formatSmsTime(candidate.start),
      recurrence,
    }))
}

export async function createCalendarEvent(profileId: string, option: ScheduleOption) {
  const client = await calendarForProfile(profileId, { calendarId: option.calendarId })
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
  const client = await calendarForProfile(profileId, { calendarId: option.calendarId })
  if (!client) throw new Error('Google Calendar is not connected.')
  const recurrence = option.recurrence ? recurrenceRule(option.recurrence, option.start) : null

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
      recurrence: recurrence ? [recurrence] : undefined,
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
  const client = await calendarForProfile(profileId, { calendarId })
  if (!client) throw new Error('Google Calendar is not connected.')

  await client.calendar.events.delete({
    calendarId: calendarId || client.connection.calendar_id,
    eventId,
    sendUpdates,
  })
}
