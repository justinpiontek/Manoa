import { parseGoogleRecurrence, recurrenceRule, recurrenceSummary, type RecurrenceSpec } from './recurrence'
import { scheduleCandidateTimesForTitle } from './schedulingPreferences'
import type { Invitee } from '../sms/invitees'
import { google, type calendar_v3 } from 'googleapis'
import type { Credentials } from 'google-auth-library'
import { appUrl, defaultTimezone, requiredEnv } from '../env'
import { supabaseAdmin } from '../supabaseAdmin'
import { decryptCalendarToken, encryptCalendarToken } from './tokenEncryption'
import {
  addDays,
  addMinutes,
  dateFromTimeZoneParts,
  dateTimePartsInTimeZone,
  endOfDay,
  formatSmsDate,
  formatSmsTime,
  overlaps,
  setTime,
  startOfDay,
} from './dates'

export type CalendarProvider = 'google' | 'outlook' | 'apple'

export type CalendarConnection = {
  id: string
  profile_id: string
  provider: CalendarProvider
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
  provider: CalendarProvider
  sourceName: string
  label: string
  includeInConflicts: boolean
  allowNewEvents: boolean
  canWrite: boolean
  isPrimary: boolean
}

export type ConfiguredCalendarAccount = {
  provider: CalendarProvider
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
  provider: CalendarProvider
  isPrimary: boolean
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
  isAllDay?: boolean
  location?: string | null
  provider: CalendarProvider
  calendarId: string
  calendarName: string
  dayLabel: string
  timeLabel: string
  timeZone?: string
  ownerEmail?: string | null
  attendees?: Invitee[]
  recurrence?: RecurrenceSpec | null
}

function allDayDateInTimeZone(value: Date | string, timeZone?: string) {
  const parts = dateTimePartsInTimeZone(value, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function allDayDateStamp(value: Date | string, timeZone?: string) {
  const parts = dateTimePartsInTimeZone(value, timeZone)
  return `${parts.year}${String(parts.month).padStart(2, '0')}${String(parts.day).padStart(2, '0')}`
}

export type EventSummary = {
  id: string
  title: string
  start: string
  end: string
  provider: CalendarProvider
  calendarId: string
  calendarName: string
  timeLabel: string
  location: string
  description: string
  organizerEmail: string
  ownerEmail?: string | null
  attendeeCount: number
  selfResponseStatus?: string | null
  recurrence?: string[] | null
  recurringEventId?: string | null
  originalStart?: string | null
  providerEventUid?: string | null
}

type GoogleCalendarDescriptor = {
  id: string
  name: string
  primary: boolean
  selected: boolean
  hidden: boolean
  accessRole: string
}

type OutlookTokens = {
  access_token: string
  refresh_token: string | null
  expires_at: string | null
}

type OutlookCalendarDescriptor = {
  id: string
  name: string
  canEdit: boolean
  isDefaultCalendar: boolean
  ownerEmail: string | null
}

type OutlookDateTime = {
  dateTime?: string | null
  timeZone?: string | null
}

type AppleCalendarDescriptor = {
  id: string
  name: string
  canEdit: boolean
  isDefaultCalendar: boolean
  ownerEmail: string | null
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
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    ],
  })
}

const microsoftAuthority = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const microsoftGraphBase = 'https://graph.microsoft.com/v1.0'
const microsoftScopes = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite',
]

function microsoftRedirectUri() {
  return process.env.MICROSOFT_REDIRECT_URI || `${appUrl()}/api/calendar/outlook/callback`
}

export function microsoftAuthUrl(state: string) {
  const url = new URL(`${microsoftAuthority}/authorize`)
  url.searchParams.set('client_id', requiredEnv('MICROSOFT_CLIENT_ID'))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', microsoftRedirectUri())
  url.searchParams.set('response_mode', 'query')
  url.searchParams.set('scope', microsoftScopes.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

async function microsoftTokenRequest(params: URLSearchParams) {
  params.set('client_id', requiredEnv('MICROSOFT_CLIENT_ID'))
  params.set('client_secret', requiredEnv('MICROSOFT_CLIENT_SECRET'))
  params.set('redirect_uri', microsoftRedirectUri())

  const response = await fetch(`${microsoftAuthority}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Microsoft token request failed: ${response.status} ${body}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_at: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null,
  } satisfies OutlookTokens
}

async function exchangeMicrosoftCode(code: string) {
  const params = new URLSearchParams()
  params.set('grant_type', 'authorization_code')
  params.set('code', code)
  params.set('scope', microsoftScopes.join(' '))
  return microsoftTokenRequest(params)
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
  return (
    cleanCalendarDisplayText(connection.calendar_label) ||
    cleanCalendarDisplayText(connection.calendar_name) ||
    `${providerLabel(connection.provider)} Calendar`
  )
}

async function getProfileTimeZone(profileId: string) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('timezone')
    .eq('id', profileId)
    .maybeSingle<{ timezone: string | null }>()

  return data?.timezone?.trim() || defaultTimezone()
}

function mapGoogleEvent(
  event: calendar_v3.Schema$Event,
  connection: Pick<
    CalendarConnection,
    'calendar_id' | 'calendar_name' | 'calendar_label' | 'account_email'
  >,
  timeZone = defaultTimezone(),
) {
  const normalizedAccountEmail = (connection.account_email || '').trim().toLowerCase()
  const selfAttendee =
    event.attendees?.find((attendee) => attendee.self) ||
    event.attendees?.find((attendee) => (attendee.email || '').trim().toLowerCase() === normalizedAccountEmail)

  return {
    id: event.id || '',
    title: event.summary || 'Untitled event',
    start: event.start?.dateTime || event.start?.date || '',
    end: event.end?.dateTime || event.end?.date || '',
    provider: 'google',
    calendarId: connection.calendar_id,
    calendarName: connection.calendar_label?.trim() || connection.calendar_name || 'Google Calendar',
    timeLabel: event.start?.dateTime ? formatSmsTime(new Date(event.start.dateTime), timeZone) : 'All day',
    location: event.location || '',
    description: event.description || '',
    organizerEmail: event.organizer?.email || '',
    ownerEmail: connection.account_email || null,
    attendeeCount: event.attendees?.length || 0,
    selfResponseStatus: selfAttendee?.responseStatus || null,
    recurrence: event.recurrence || null,
    recurringEventId: event.recurringEventId || null,
    originalStart: event.originalStartTime?.dateTime || event.originalStartTime?.date || null,
  } satisfies EventSummary
}

function outlookDateTimeToIso(value: OutlookDateTime | null | undefined) {
  if (!value?.dateTime) return ''
  const raw = value.dateTime
  const timeZone = value.timeZone || 'UTC'

  if (/z$/i.test(raw) || /[+-]\d\d:\d\d$/.test(raw)) {
    return new Date(raw).toISOString()
  }

  if (timeZone.toUpperCase() === 'UTC') {
    return new Date(`${raw}Z`).toISOString()
  }

  return new Date(raw).toISOString()
}

function mapOutlookAccessRole(descriptor: OutlookCalendarDescriptor) {
  if (descriptor.canEdit) {
    return descriptor.isDefaultCalendar ? 'owner' : 'writer'
  }
  return 'reader'
}

function mapOutlookEvent(
  event: {
    id?: string | null
    subject?: string | null
    start?: OutlookDateTime | null
    end?: OutlookDateTime | null
    location?: { displayName?: string | null } | null
    bodyPreview?: string | null
    organizer?: { emailAddress?: { address?: string | null } | null } | null
    attendees?: Array<unknown> | null
    responseStatus?: { response?: string | null } | null
    recurrence?: unknown
    seriesMasterId?: string | null
    type?: string | null
    originalStart?: string | null
  },
  connection: Pick<CalendarConnection, 'calendar_id' | 'calendar_name' | 'calendar_label' | 'account_email'>,
  timeZone = defaultTimezone(),
) {
  const start = outlookDateTimeToIso(event.start)
  const recurrence = parseOutlookRecurrence(event.recurrence, start)

  return {
    id: event.id || '',
    title: event.subject || 'Untitled event',
    start,
    end: outlookDateTimeToIso(event.end),
    provider: 'outlook',
    calendarId: connection.calendar_id,
    calendarName: connection.calendar_label?.trim() || connection.calendar_name || 'Outlook Calendar',
    timeLabel: start ? formatSmsTime(new Date(start), timeZone) : 'All day',
    location: event.location?.displayName || '',
    description: event.bodyPreview || '',
    organizerEmail: event.organizer?.emailAddress?.address || '',
    ownerEmail: connection.account_email || null,
    attendeeCount: event.attendees?.length || 0,
    selfResponseStatus: event.responseStatus?.response || null,
    recurrence: recurrence ? [recurrenceSummary(recurrence, start, timeZone) || 'Recurring event'] : null,
    recurringEventId: event.seriesMasterId || null,
    originalStart: event.originalStart || null,
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

function providerLabel(provider: CalendarProvider) {
  if (provider === 'outlook') return 'Outlook'
  if (provider === 'apple') return 'Apple'
  return 'Google'
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value != null
}

function cleanCalendarDisplayText(value: string | null | undefined) {
  return (value || '')
    .replace(/\s*[⚠⚠️]+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isAppleCalendarAccessError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  return /apple calendar request failed:\s*(403|404)\b/i.test(message)
}

function normalizedAppleCollectionName(value: string | null | undefined) {
  return normalizeCalendarText(cleanCalendarDisplayText(value))
}

function isLikelyAppleReminderName(value: string | null | undefined) {
  const normalized = normalizedAppleCollectionName(value)
  if (!normalized) return false

  const exactReminderNames = new Set([
    'reminder',
    'reminders',
    'reminder to do s',
    'reminders to do s',
    'to do',
    'to dos',
    'todo',
    'todos',
    'tasks',
    'task list',
    'notifications',
    'notification',
    'groceries',
    'grocery list',
    'shopping',
    'shopping list',
    'xmas cookie ingredients',
    'christmas cookie ingredients',
  ])

  if (exactReminderNames.has(normalized)) return true

  return /\b(reminder|to do|todo|task|tasks|checklist|errands|ingredients)\b/.test(normalized)
}

function appleSupportedCalendarComponentNames(value: string) {
  return [...value.matchAll(/\bname\s*=\s*["']?([A-Z-]+)["']?/gi)].map((match) =>
    match[1].toUpperCase(),
  )
}

function appleCollectionSupportsEvents(supportedComponents: string) {
  const componentNames = appleSupportedCalendarComponentNames(supportedComponents)
  if (!componentNames.length) return true
  return componentNames.includes('VEVENT')
}

function isLikelyAppleReminderConnection(connection: CalendarConnection) {
  return (
    connection.provider === 'apple' &&
    (isLikelyAppleReminderName(connection.calendar_label) ||
      isLikelyAppleReminderName(connection.calendar_name) ||
      isLikelyAppleReminderName(connection.calendar_id))
  )
}

function normalizeOutlookGraphDateTime(value: Date | string) {
  return new Date(value).toISOString().replace(/Z$/, '')
}

function calendarLocalDateTime(value: Date | string, timeZone?: string) {
  const parts = dateTimePartsInTimeZone(value, timeZone || defaultTimezone())
  return `${parts.year}-${padCalendarPart(parts.month)}-${padCalendarPart(parts.day)}T${padCalendarPart(
    parts.hour,
  )}:${padCalendarPart(parts.minute)}:${padCalendarPart(parts.second)}`
}

function basicLocalTimestamp(value: Date | string, timeZone?: string) {
  return calendarLocalDateTime(value, timeZone).replace(/[-:]/g, '')
}

function graphHeaders(accessToken: string, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Prefer: 'outlook.timezone="UTC"',
    ...extra,
  }
}

async function graphJson<T>(
  path: string,
  {
    accessToken,
    method = 'GET',
    body,
  }: {
    accessToken: string
    method?: string
    body?: unknown
  },
) {
  const response = await fetch(`${microsoftGraphBase}${path}`, {
    method,
    headers: graphHeaders(accessToken),
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Microsoft Graph request failed: ${response.status} ${errorBody}`)
  }

  if (response.status === 204) {
    return null as T
  }

  return (await response.json()) as T
}

const appleCalDavBase = 'https://caldav.icloud.com'

function appleAuthHeader(email: string, appSpecificPassword: string) {
  return `Basic ${Buffer.from(`${email}:${appSpecificPassword}`).toString('base64')}`
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function xmlUnescape(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function stripXmlTagPrefix(value: string) {
  return value.replace(/^[a-z0-9_-]+:/i, '')
}

function firstXmlBlock(xml: string, localName: string) {
  const match = xml.match(new RegExp(`<[^>]*:?${localName}\\b[^>]*>([\\s\\S]*?)<\\/[^>]*:?${localName}>`, 'i'))
  return match?.[1] || null
}

function allXmlBlocks(xml: string, localName: string) {
  return [...xml.matchAll(new RegExp(`<[^>]*:?${localName}\\b[^>]*>([\\s\\S]*?)<\\/[^>]*:?${localName}>`, 'gi'))].map(
    (match) => match[1],
  )
}

function firstXmlText(xml: string, localName: string) {
  const match = xml.match(new RegExp(`<[^>]*:?${localName}\\b[^>]*>([\\s\\S]*?)<\\/[^>]*:?${localName}>`, 'i'))
  return match ? xmlUnescape(match[1].trim()) : null
}

function sanitizeAppleHref(href: string, baseUrl: string) {
  return new URL(href, baseUrl).toString()
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAppleNotFoundError(error: unknown) {
  return /404|not found/i.test(error instanceof Error ? error.message : String(error))
}

async function appleDavRequest({
  url,
  email,
  appSpecificPassword,
  method = 'PROPFIND',
  depth,
  body,
  contentType = 'application/xml; charset=utf-8',
}: {
  url: string
  email: string
  appSpecificPassword: string
  method?: string
  depth?: string
  body?: string
  contentType?: string
}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: appleAuthHeader(email, appSpecificPassword),
      ...(depth ? { Depth: depth } : {}),
      ...(body ? { 'Content-Type': contentType } : {}),
    },
    body,
    cache: 'no-store',
    redirect: 'follow',
  })

  if (!response.ok && response.status !== 207) {
    const errorBody = await response.text()
    throw new Error(`Apple Calendar request failed: ${response.status} ${errorBody || response.statusText}`)
  }

  return {
    text: await response.text(),
    url: response.url,
    status: response.status,
  }
}

function appleProp(statXml: string, localName: string) {
  const propstatBlocks = allXmlBlocks(statXml, 'propstat')
  for (const block of propstatBlocks) {
    const status = firstXmlText(block, 'status') || ''
    if (!status.includes(' 200 ')) continue
    const propBlock = firstXmlBlock(block, 'prop')
    if (!propBlock) continue
    const value = firstXmlBlock(propBlock, localName)
    if (value !== null) return value
  }
  return null
}

function unfoldIcs(value: string) {
  return value.replace(/\r?\n[ \t]/g, '')
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function escapeIcsParam(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function foldIcsLine(line: string) {
  const chunks: string[] = []
  let remaining = line

  while (remaining.length > 75) {
    chunks.push(remaining.slice(0, 75))
    remaining = ` ${remaining.slice(75)}`
  }

  chunks.push(remaining)
  return chunks.join('\r\n')
}

function serializeIcsLines(lines: string[]) {
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`
}

function unescapeIcsText(value: string) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

function parseIcsDateValue(value: string, params: Record<string, string>) {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  }

  const basic = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/)
  if (!basic) return ''

  const [, year, month, day, hour, minute, second, zulu] = basic
  if (zulu === 'Z') {
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString()
  }

  const tzid = params.TZID
  if (tzid) {
    return dateFromTimeZoneParts(
      {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second),
      },
      tzid,
    ).toISOString()
  }

  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`).toISOString()
}

function basicUtcTimestamp(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

function sameCalendarDay(left: Date, right: Date, timeZone?: string) {
  const leftParts = dateTimePartsInTimeZone(left, timeZone)
  const rightParts = dateTimePartsInTimeZone(right, timeZone)

  return (
    leftParts.year === rightParts.year &&
    leftParts.month === rightParts.month &&
    leftParts.day === rightParts.day
  )
}

function exactScheduleCandidateStarts({
  title,
  baseDate,
  exactTime,
  timeZone,
}: {
  title: string
  baseDate: Date
  exactTime: { hour: number; minute: number }
  timeZone: string
}) {
  const requestedStart = setTime(baseDate, exactTime, timeZone)
  const laterStarts = [60, 120, 180, 240].map((minutes) => addMinutes(requestedStart, minutes))
  const titleStarts = scheduleCandidateTimesForTitle(title).map((time) => setTime(baseDate, time, timeZone))

  return [...new Map(
    [requestedStart, ...laterStarts, ...titleStarts]
      .filter((start) => sameCalendarDay(start, requestedStart, timeZone))
      .map((start) => [start.getTime(), start] as const),
  ).values()]
}

function parseIcsProperty(rawLine: string) {
  const separatorIndex = rawLine.indexOf(':')
  if (separatorIndex === -1) return null

  const left = rawLine.slice(0, separatorIndex)
  const value = rawLine.slice(separatorIndex + 1)
  const [namePart, ...paramParts] = left.split(';')
  const params = Object.fromEntries(
    paramParts.map((part) => {
      const [key, paramValue = ''] = part.split('=')
      return [key.toUpperCase(), paramValue]
    }),
  )

  return {
    name: namePart.toUpperCase(),
    params,
    value,
  }
}

function attendeeLine(invitee: Invitee) {
  const email = invitee.email.trim().toLowerCase()
  const displayName = invitee.displayName?.trim() || email

  return [
    `ATTENDEE;CN=${escapeIcsParam(displayName)}`,
    'CUTYPE=INDIVIDUAL',
    'ROLE=REQ-PARTICIPANT',
    'PARTSTAT=NEEDS-ACTION',
    'RSVP=TRUE',
    `mailto:${email}`,
  ].join(';').replace(';mailto:', ':mailto:')
}

function organizerLine(email: string) {
  const normalizedEmail = email.trim().toLowerCase()
  return `ORGANIZER;CN=${escapeIcsParam(normalizedEmail)}:mailto:${normalizedEmail}`
}

function attendeeEmailFromLine(line: string) {
  const property = parseIcsProperty(line)
  if (property?.name !== 'ATTENDEE') return ''
  return property.value.replace(/^mailto:/i, '').trim().toLowerCase()
}

function appleEventParticipants(calendarData: string) {
  const lines = unfoldIcs(calendarData).split(/\r?\n/)
  const attendees: Invitee[] = []
  let organizerEmail = ''

  for (const line of lines) {
    const property = parseIcsProperty(line)
    if (!property) continue

    if (property.name === 'ORGANIZER') {
      organizerEmail = property.value.replace(/^mailto:/i, '').trim().toLowerCase()
    }

    if (property.name === 'ATTENDEE') {
      const email = property.value.replace(/^mailto:/i, '').trim().toLowerCase()
      if (!email) continue
      attendees.push({
        email,
        displayName: property.params.CN || undefined,
      })
    }
  }

  return {
    organizerEmail,
    attendees: attendees.filter(
      (attendee, index, list) =>
        list.findIndex((item) => item.email.toLowerCase() === attendee.email.toLowerCase()) === index,
    ),
  }
}

function monthlyOccurrenceFromOffset(
  originalStart: Date,
  spec: RecurrenceSpec,
  monthOffset: number,
  timeZone?: string,
) {
  if (spec.unit !== 'month') return null

  const originalParts = dateTimePartsInTimeZone(originalStart, timeZone)
  const targetMonthAnchor = new Date(Date.UTC(originalParts.year, originalParts.month - 1, 1))
  targetMonthAnchor.setUTCMonth(targetMonthAnchor.getUTCMonth() + monthOffset)
  const targetYear = targetMonthAnchor.getUTCFullYear()
  const targetMonth = targetMonthAnchor.getUTCMonth() + 1
  const lastDayOfMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate()

  if (spec.mode === 'month_day') {
    if (originalParts.day > lastDayOfMonth) return null
    return dateFromTimeZoneParts(
      {
        year: targetYear,
        month: targetMonth,
        day: originalParts.day,
        hour: originalParts.hour,
        minute: originalParts.minute,
        second: originalParts.second,
      },
      timeZone,
    )
  }

  const occurrence = Math.floor((originalParts.day - 1) / 7) + 1
  const targetWeekday = spec.weekday ?? originalParts.weekday
  const monthStart = dateFromTimeZoneParts(
    {
      year: targetYear,
      month: targetMonth,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
  )
  const firstWeekday = dateTimePartsInTimeZone(monthStart, timeZone).weekday
  const dayOffset = (targetWeekday - firstWeekday + 7) % 7
  const occurrenceDay = 1 + dayOffset + (occurrence - 1) * 7
  if (occurrenceDay > lastDayOfMonth) return null

  return dateFromTimeZoneParts(
    {
      year: targetYear,
      month: targetMonth,
      day: occurrenceDay,
      hour: originalParts.hour,
      minute: originalParts.minute,
      second: originalParts.second,
    },
    timeZone,
  )
}

function projectSimpleRecurringEventIntoRange(
  event: EventSummary,
  timeRange: { timeMin: Date; timeMax: Date },
  timeZone?: string,
) {
  if (!event.recurrence?.length) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(event.start) || /^\d{4}-\d{2}-\d{2}$/.test(event.end)) return null

  const spec = parseGoogleRecurrence(event.recurrence)
  if (!spec) return null

  const originalStart = new Date(event.start)
  const originalEnd = new Date(event.end)
  if (Number.isNaN(originalStart.getTime()) || Number.isNaN(originalEnd.getTime()) || originalEnd <= originalStart) {
    return null
  }

  const durationMs = originalEnd.getTime() - originalStart.getTime()
  let candidateStart: Date | null = null

  if (spec.unit === 'week') {
    const originalParts = dateTimePartsInTimeZone(originalStart, timeZone)
    const targetWeekday = spec.weekday ?? originalParts.weekday
    let weekdayOffset = targetWeekday - originalParts.weekday
    if (weekdayOffset < 0) weekdayOffset += 7
    candidateStart = weekdayOffset === 0 ? new Date(originalStart) : addDays(originalStart, weekdayOffset, timeZone)
    while (candidateStart.getTime() < timeRange.timeMin.getTime()) {
      candidateStart = addDays(candidateStart, spec.interval * 7, timeZone)
    }
  } else {
    for (let monthOffset = 0; monthOffset < 36; monthOffset += spec.interval) {
      const next = monthlyOccurrenceFromOffset(originalStart, spec, monthOffset, timeZone)
      if (!next) continue
      if (next.getTime() < timeRange.timeMin.getTime()) continue
      candidateStart = next
      break
    }
  }

  if (!candidateStart || candidateStart.getTime() >= timeRange.timeMax.getTime()) return null

  const candidateEnd = new Date(candidateStart.getTime() + durationMs)
  return {
    ...event,
    start: candidateStart.toISOString(),
    end: candidateEnd.toISOString(),
    timeLabel: formatSmsTime(candidateStart, timeZone),
    originalStart: event.originalStart || event.start,
  } satisfies EventSummary
}

function parseAppleCalendarData(
  calendarData: string,
  connection: Pick<CalendarConnection, 'calendar_id' | 'calendar_name' | 'calendar_label' | 'account_email'>,
  eventHref: string,
  timeZone = defaultTimezone(),
  timeRange?: { timeMin: Date; timeMax: Date },
): EventSummary | null {
  const unfolded = unfoldIcs(calendarData)
  const eventBlocks = [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/gi)].map(
    (match) => match[1],
  )
  if (!eventBlocks.length) return null

  const eventStartInRange = (value: string | null | undefined) => {
    if (!value) return false

    const start =
      /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? dateFromTimeZoneParts(
            {
              year: Number(value.slice(0, 4)),
              month: Number(value.slice(5, 7)),
              day: Number(value.slice(8, 10)),
              hour: 0,
              minute: 0,
              second: 0,
            },
            timeZone,
          )
        : new Date(value)

    const time = start.getTime()
    if (Number.isNaN(time)) return false
    return time >= timeRange!.timeMin.getTime() && time < timeRange!.timeMax.getTime()
  }

  const parseAppleEventBlock = (eventBlock: string): EventSummary | null => {
    const lines = eventBlock.split(/\r?\n/)
    let title = 'Untitled event'
    let start = ''
    let end = ''
    let location = ''
    let description = ''
    let organizerEmail = ''
    let attendeeCount = 0
    let selfResponseStatus: string | null = null
    const recurrence: string[] = []
    let providerEventUid: string | null = null
    let originalStart: string | null = null

    const normalizedAccountEmail = (connection.account_email || '').trim().toLowerCase()

    for (const line of lines) {
      const property = parseIcsProperty(line)
      if (!property) continue

      if (property.name === 'SUMMARY') title = unescapeIcsText(property.value) || title
      if (property.name === 'DTSTART') start = parseIcsDateValue(property.value, property.params)
      if (property.name === 'DTEND') end = parseIcsDateValue(property.value, property.params)
      if (property.name === 'LOCATION') location = unescapeIcsText(property.value)
      if (property.name === 'DESCRIPTION') description = unescapeIcsText(property.value)
      if (property.name === 'RRULE') recurrence.push(`RRULE:${property.value}`)
      if (property.name === 'RECURRENCE-ID') originalStart = parseIcsDateValue(property.value, property.params)
      if (property.name === 'ORGANIZER') {
        organizerEmail = property.value.replace(/^mailto:/i, '')
      }
      if (property.name === 'ATTENDEE') {
        attendeeCount += 1
        const attendeeEmail = property.value.replace(/^mailto:/i, '').trim().toLowerCase()
        if (attendeeEmail === normalizedAccountEmail) {
          selfResponseStatus = property.params.PARTSTAT?.toLowerCase() || null
        }
      }
      if (property.name === 'UID') providerEventUid = property.value || providerEventUid
    }

    const recurringEventId = recurrence.length || originalStart ? eventHref : null

    return {
      id: eventHref,
      title,
      start,
      end,
      provider: 'apple' as const,
      calendarId: connection.calendar_id,
      calendarName: connection.calendar_label?.trim() || connection.calendar_name || 'Apple Calendar',
      timeLabel: start && !/^\d{4}-\d{2}-\d{2}$/.test(start) ? formatSmsTime(new Date(start), timeZone) : 'All day',
      location,
      description,
      organizerEmail,
      ownerEmail: connection.account_email || null,
      attendeeCount,
      selfResponseStatus,
      recurrence: recurrence.length ? recurrence : null,
      recurringEventId,
      originalStart,
      providerEventUid,
    } satisfies EventSummary
  }

  const parsedEvents = eventBlocks.map(parseAppleEventBlock).filter(isDefined)
  if (!parsedEvents.length) return null

  if (!timeRange) {
    return parsedEvents[0]
  }

  const inRangeEvents = parsedEvents
    .filter((event) => !event.recurrence?.length || Boolean(event.originalStart))
    .filter((event) => eventStartInRange(event.start))
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())
  if (inRangeEvents.length) return inRangeEvents[0]

  const recurrenceInstances = parsedEvents.filter(
    (event) => Boolean(event.originalStart) && eventStartInRange(event.originalStart),
  )
  if (recurrenceInstances.length) return recurrenceInstances[0]

  const projectedRecurringEvents = parsedEvents
    .map((event) => projectSimpleRecurringEventIntoRange(event, timeRange, timeZone))
    .filter(isDefined)
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())
  if (projectedRecurringEvents.length) return projectedRecurringEvents[0]

  const recurringOverrides = parsedEvents.filter((event) => Boolean(event.originalStart))
  if (recurringOverrides.length) return recurringOverrides[0]

  return parsedEvents[0]
}

function buildAppleCalendarEventBody({
  option,
  uid,
  organizerEmail,
}: {
  option: ScheduleOption
  uid: string
  organizerEmail?: string | null
}) {
  const eventTimeZone = option.timeZone || defaultTimezone()
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Manoa//Calendar//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-TIMEZONE:${eventTimeZone}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${basicUtcTimestamp(new Date())}`,
    ...(option.isAllDay
      ? [
          `DTSTART;VALUE=DATE:${allDayDateStamp(option.start, eventTimeZone)}`,
          `DTEND;VALUE=DATE:${allDayDateStamp(option.end, eventTimeZone)}`,
        ]
      : [
          `DTSTART;TZID=${eventTimeZone}:${basicLocalTimestamp(option.start, eventTimeZone)}`,
          `DTEND;TZID=${eventTimeZone}:${basicLocalTimestamp(option.end, eventTimeZone)}`,
        ]),
    `SUMMARY:${escapeIcsText(option.title)}`,
  ]

  if (option.recurrence) {
    const rule = recurrenceRule(option.recurrence, option.start, option.timeZone)
    if (rule) lines.push(rule)
  }

  if (option.location?.trim()) {
    lines.push(`LOCATION:${escapeIcsText(option.location.trim())}`)
  }

  const attendees = option.attendees || []
  if (attendees.length && organizerEmail?.trim()) {
    lines.push(organizerLine(organizerEmail))
  }

  for (const invitee of attendees) {
    if (invitee.email.trim()) lines.push(attendeeLine(invitee))
  }

  lines.push('END:VEVENT', 'END:VCALENDAR')
  return serializeIcsLines(lines)
}

async function discoverAppleCalendars(email: string, appSpecificPassword: string) {
  const rootResponse = await appleDavRequest({
    url: `${appleCalDavBase}/`,
    email,
    appSpecificPassword,
    depth: '0',
    body:
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
      '<d:prop><d:current-user-principal /></d:prop>' +
      '</d:propfind>',
  })

  const rootResponseBlock = allXmlBlocks(rootResponse.text, 'response')[0] || rootResponse.text
  const principalHref = firstXmlText(appleProp(rootResponseBlock, 'current-user-principal') || '', 'href')
  if (!principalHref) {
    throw new Error('Apple Calendar did not return a principal for this account.')
  }

  const principalUrl = sanitizeAppleHref(principalHref, rootResponse.url)
  const principalResponse = await appleDavRequest({
    url: principalUrl,
    email,
    appSpecificPassword,
    depth: '0',
    body:
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
      '<d:prop><c:calendar-home-set /><d:displayname /></d:prop>' +
      '</d:propfind>',
  })

  const principalBlock = allXmlBlocks(principalResponse.text, 'response')[0] || principalResponse.text
  const homeHref = firstXmlText(appleProp(principalBlock, 'calendar-home-set') || '', 'href')
  if (!homeHref) {
    throw new Error('Apple Calendar did not return a calendar home for this account.')
  }

  const homeUrl = sanitizeAppleHref(homeHref, principalResponse.url)
  const calendarsResponse = await appleDavRequest({
    url: homeUrl,
    email,
    appSpecificPassword,
    depth: '1',
    body:
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
      '<d:prop><d:displayname /><d:resourcetype /><d:current-user-privilege-set /><c:supported-calendar-component-set /></d:prop>' +
      '</d:propfind>',
  })

  const calendars = allXmlBlocks(calendarsResponse.text, 'response')
    .map<AppleCalendarDescriptor | null>((responseBlock) => {
      const href = firstXmlText(responseBlock, 'href')
      const resourcetype = appleProp(responseBlock, 'resourcetype') || ''
      if (!href || !/calendar/i.test(resourcetype)) return null

      const resolvedUrl = sanitizeAppleHref(href, calendarsResponse.url)
      if (resolvedUrl.replace(/\/+$/, '') === homeUrl.replace(/\/+$/, '')) return null

      const supportedComponents = appleProp(responseBlock, 'supported-calendar-component-set') || ''
      if (!appleCollectionSupportsEvents(supportedComponents)) return null

      const privilegeSet = appleProp(responseBlock, 'current-user-privilege-set') || ''
      const canEdit = /write/i.test(privilegeSet) || /all/i.test(privilegeSet) || privilegeSet === ''
      const name = firstXmlText(responseBlock, 'displayname') || resolvedUrl.split('/').filter(Boolean).pop() || 'Apple Calendar'
      if (isLikelyAppleReminderName(name)) return null

      return {
        id: resolvedUrl,
        name,
        canEdit,
        isDefaultCalendar: false,
        ownerEmail: email,
      }
    })
    .filter(isDefined)

  if (!calendars.length) {
    throw new Error('Apple Calendar did not return any calendars for this account.')
  }

  const [firstCalendar, ...remainingCalendars] = calendars

  return {
    accountId: email.trim().toLowerCase(),
    accountEmail: email.trim().toLowerCase(),
    calendars: [
      {
        ...firstCalendar,
        isDefaultCalendar: true,
      },
      ...remainingCalendars,
    ],
  }
}

async function listAppleEventsForConnection({
  connection,
  timeMin,
  timeMax,
  timeZone,
}: {
  connection: CalendarConnection
  timeMin: Date
  timeMax: Date
  timeZone?: string
}) {
  let response: Awaited<ReturnType<typeof appleDavRequest>>
  const reportBody = (expandOccurrences: boolean) =>
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
    '<d:prop><d:getetag /><c:calendar-data>' +
    (expandOccurrences
      ? `<c:expand start="${basicUtcTimestamp(timeMin)}" end="${basicUtcTimestamp(timeMax)}" />`
      : '') +
    '</c:calendar-data></d:prop>' +
    `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${basicUtcTimestamp(
      timeMin,
    )}" end="${basicUtcTimestamp(timeMax)}" /></c:comp-filter></c:comp-filter></c:filter>` +
    '</c:calendar-query>'

  try {
    response = await appleDavRequest({
      url: connection.calendar_id,
      email: connection.account_email || connection.account_id,
      appSpecificPassword: connection.access_token,
      method: 'REPORT',
      depth: '1',
      body: reportBody(true),
    })
  } catch (error) {
    if (isAppleCalendarAccessError(error)) {
      return []
    }

    const message = error instanceof Error ? error.message : String(error)
    if (!/\b(400|415|422|500|501)\b/.test(message)) {
      throw error
    }

    response = await appleDavRequest({
      url: connection.calendar_id,
      email: connection.account_email || connection.account_id,
      appSpecificPassword: connection.access_token,
      method: 'REPORT',
      depth: '1',
      body: reportBody(false),
    })
  }

  return allXmlBlocks(response.text, 'response')
    .map<EventSummary | null>((responseBlock) => {
      const href = firstXmlText(responseBlock, 'href')
      const calendarData = appleProp(responseBlock, 'calendar-data')
      if (!href || !calendarData) return null
      return parseAppleCalendarData(
        calendarData,
        connection,
        sanitizeAppleHref(href, response.url),
        timeZone || defaultTimezone(),
        { timeMin, timeMax },
      )
    })
    .filter(isDefined)
}

async function getAppleEventForConnection(connection: CalendarConnection, eventId: string) {
  const url = sanitizeAppleHref(eventId, connection.calendar_id)
  const response = await appleDavRequest({
    url,
    email: connection.account_email || connection.account_id,
    appSpecificPassword: connection.access_token,
    method: 'GET',
    contentType: 'text/calendar; charset=utf-8',
  })

  return parseAppleCalendarData(response.text, connection, url)
}

async function getAppleEventDataForConnection(connection: CalendarConnection, eventId: string) {
  const url = sanitizeAppleHref(eventId, connection.calendar_id)
  const response = await appleDavRequest({
    url,
    email: connection.account_email || connection.account_id,
    appSpecificPassword: connection.access_token,
    method: 'GET',
    contentType: 'text/calendar; charset=utf-8',
  })

  return {
    text: response.text,
    url,
  }
}

async function maybeGetAppleEventForConnection(connection: CalendarConnection, eventId: string) {
  try {
    return await getAppleEventForConnection(connection, eventId)
  } catch (error) {
    if (isAppleNotFoundError(error)) return null
    throw error
  }
}

async function verifyAppleEventExists(
  connection: CalendarConnection,
  eventId: string,
  action: 'create' | 'update',
) {
  for (const delay of [0, 250, 750, 1500]) {
    if (delay) await wait(delay)
    const event = await maybeGetAppleEventForConnection(connection, eventId)
    if (event) return event
  }

  throw new Error(
    `Apple Calendar ${action} was accepted, but Manoa could not verify the event on ${displayCalendarName(
      connection,
    )}. Check Apple Calendar and try again.`,
  )
}

async function verifyAppleEventDeleted(connection: CalendarConnection, eventId: string) {
  for (const delay of [0, 250, 750, 1500]) {
    if (delay) await wait(delay)
    const event = await maybeGetAppleEventForConnection(connection, eventId)
    if (!event) return
  }

  throw new Error(
    `Apple Calendar delete was accepted, but the event still appears on ${displayCalendarName(
      connection,
    )}. Try again in a minute.`,
  )
}

async function createAppleCalendarEvent(connection: CalendarConnection, option: ScheduleOption) {
  const uid = crypto.randomUUID()
  const eventUrl = sanitizeAppleHref(`${uid}.ics`, connection.calendar_id.endsWith('/') ? connection.calendar_id : `${connection.calendar_id}/`)
  const response = await fetch(eventUrl, {
    method: 'PUT',
    headers: {
      Authorization: appleAuthHeader(connection.account_email || connection.account_id, connection.access_token),
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-None-Match': '*',
    },
    body: buildAppleCalendarEventBody({
      option,
      uid,
      organizerEmail: connection.account_email || connection.account_id,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Apple Calendar create failed: ${response.status} ${body || response.statusText}`)
  }

  await verifyAppleEventExists(connection, eventUrl, 'create')

  return { id: eventUrl }
}

async function updateAppleCalendarEvent(connection: CalendarConnection, eventId: string, option: ScheduleOption) {
  const existingData = await getAppleEventDataForConnection(connection, eventId)
  const existing = parseAppleCalendarData(existingData.text, connection, existingData.url)
  const participants = appleEventParticipants(existingData.text)
  const uid = existing?.providerEventUid || new URL(eventId).pathname.split('/').pop()?.replace(/\.ics$/i, '') || crypto.randomUUID()
  const response = await fetch(sanitizeAppleHref(eventId, connection.calendar_id), {
    method: 'PUT',
    headers: {
      Authorization: appleAuthHeader(connection.account_email || connection.account_id, connection.access_token),
      'Content-Type': 'text/calendar; charset=utf-8',
    },
    body: buildAppleCalendarEventBody({
      option: {
        ...option,
        attendees: option.attendees || participants.attendees,
      },
      uid,
      organizerEmail: participants.organizerEmail || connection.account_email || connection.account_id,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Apple Calendar update failed: ${response.status} ${body || response.statusText}`)
  }

  const updatedEventUrl = sanitizeAppleHref(eventId, connection.calendar_id)
  await verifyAppleEventExists(connection, updatedEventUrl, 'update')

  return { id: updatedEventUrl }
}

async function deleteAppleCalendarEvent(connection: CalendarConnection, eventId: string) {
  const eventUrl = sanitizeAppleHref(eventId, connection.calendar_id)
  const response = await fetch(eventUrl, {
    method: 'DELETE',
    headers: {
      Authorization: appleAuthHeader(connection.account_email || connection.account_id, connection.access_token),
    },
  })

  if (response.status === 404) {
    throw new Error('Apple Calendar delete failed: 404 Not Found')
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Apple Calendar delete failed: ${response.status} ${body || response.statusText}`)
  }

  await verifyAppleEventDeleted(connection, eventUrl)
}

function parseOutlookRecurrence(
  recurrence: unknown,
  start: string,
): RecurrenceSpec | null {
  if (!recurrence || typeof recurrence !== 'object') return null

  const pattern = (recurrence as { pattern?: Record<string, unknown> }).pattern
  if (!pattern || typeof pattern !== 'object') return null

  const type = String(pattern.type || '')
  const interval = Number(pattern.interval || 1)
  const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const daysOfWeek = Array.isArray((pattern as { daysOfWeek?: unknown }).daysOfWeek)
    ? ((pattern as { daysOfWeek?: unknown[] }).daysOfWeek || []).map((value) => String(value).toLowerCase())
    : []
  const weekday = daysOfWeek.length ? weekdayNames.indexOf(daysOfWeek[0]) : -1

  if (type === 'weekly' && (interval === 1 || interval === 2)) {
    return {
      unit: 'week',
      interval: interval as 1 | 2,
      weekday: weekday >= 0 ? weekday : undefined,
    }
  }

  if (type === 'absoluteMonthly') {
    return {
      unit: 'month',
      interval: 1,
      mode: 'month_day',
    }
  }

  if (type === 'relativeMonthly') {
    return {
      unit: 'month',
      interval: 1,
      mode: 'nth_weekday',
      weekday: weekday >= 0 ? weekday : undefined,
    }
  }

  return null
}

function padCalendarPart(value: number) {
  return String(value).padStart(2, '0')
}

function recurrenceStartDate(start: Date | string, timeZone?: string) {
  const parts = dateTimePartsInTimeZone(start, timeZone)
  return `${parts.year}-${padCalendarPart(parts.month)}-${padCalendarPart(parts.day)}`
}

function outlookRecurrenceBody(
  spec: RecurrenceSpec | null | undefined,
  start: string,
  timeZone?: string,
) {
  if (!spec) return undefined

  const date = new Date(start)
  if (Number.isNaN(date.getTime())) return undefined
  const parts = dateTimePartsInTimeZone(date, timeZone)

  const weekdayNames = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ]
  const nth = Math.floor((parts.day - 1) / 7) + 1
  const index = nth >= 5 ? 'last' : (['first', 'second', 'third', 'fourth'][nth - 1] || 'last')
  const startDate = recurrenceStartDate(date, timeZone)

  if (spec.unit === 'week') {
    return {
      pattern: {
        type: 'weekly',
        interval: spec.interval,
        daysOfWeek: [weekdayNames[parts.weekday]],
        firstDayOfWeek: 'sunday',
      },
      range: {
        type: 'noEnd',
        startDate,
      },
    }
  }

  if (spec.mode === 'nth_weekday') {
    return {
      pattern: {
        type: 'relativeMonthly',
        interval: 1,
        daysOfWeek: [weekdayNames[parts.weekday]],
        index,
      },
      range: {
        type: 'noEnd',
        startDate,
      },
    }
  }

  return {
    pattern: {
      type: 'absoluteMonthly',
      interval: 1,
      dayOfMonth: parts.day,
    },
    range: {
      type: 'noEnd',
      startDate,
    },
  }
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

async function loadOutlookProfileAndCalendars(accessToken: string) {
  const profile = await graphJson<{
    id: string
    mail?: string | null
    userPrincipalName?: string | null
  }>('/me?$select=id,mail,userPrincipalName', {
    accessToken,
  })

  const calendarsResponse = await graphJson<{
    value: Array<{
      id: string
      name?: string | null
      canEdit?: boolean | null
      isDefaultCalendar?: boolean | null
      owner?: { address?: string | null } | null
    }>
  }>('/me/calendars?$select=id,name,canEdit,isDefaultCalendar,owner', {
    accessToken,
  })

  const calendars = (calendarsResponse.value || []).map<OutlookCalendarDescriptor>((item) => ({
    id: item.id,
    name: item.name || item.id,
    canEdit: item.canEdit !== false,
    isDefaultCalendar: Boolean(item.isDefaultCalendar),
    ownerEmail: item.owner?.address || null,
  }))

  return {
    accountId: profile.id,
    accountEmail: profile.mail || profile.userPrincipalName || null,
    calendars,
  }
}

async function refreshOutlookTokensForAccount(connection: CalendarConnection) {
  if (connection.provider !== 'outlook' || !connection.refresh_token) {
    throw new Error('Outlook refresh token is missing.')
  }

  const params = new URLSearchParams()
  params.set('grant_type', 'refresh_token')
  params.set('refresh_token', connection.refresh_token)
  params.set('scope', microsoftScopes.join(' '))

  const tokens = await microsoftTokenRequest(params)

  const { error } = await supabaseAdmin
    .from('calendar_connections')
    .update({
      access_token: encryptCalendarToken(tokens.access_token) || '',
      refresh_token: encryptCalendarToken(tokens.refresh_token || connection.refresh_token),
      expires_at: tokens.expires_at,
      updated_at: new Date().toISOString(),
    })
    .eq('profile_id', connection.profile_id)
    .eq('provider', 'outlook')
    .eq('account_id', connection.account_id)

  if (error) throw error

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || connection.refresh_token,
    expiresAt: tokens.expires_at,
  }
}

async function ensureOutlookAccessToken(connection: CalendarConnection) {
  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : null
  if (connection.access_token && (!expiresAt || expiresAt - Date.now() > 60_000)) {
    return connection.access_token
  }

  const refreshed = await refreshOutlookTokensForAccount(connection)
  return refreshed.accessToken
}

function isRevokedCalendarTokenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const dataError =
    typeof error === 'object' && error !== null && 'response' in error
      ? (error as { response?: { data?: { error?: unknown; error_description?: unknown } } }).response?.data
      : null

  return (
    dataError?.error === 'invalid_grant' ||
    /invalid_grant|expired or revoked|refresh token.*(expired|revoked)/i.test(message)
  )
}

async function deactivateCalendarConnections(connections: CalendarConnection[]) {
  const ids = connections.map((connection) => connection.id).filter(Boolean)
  if (!ids.length) return

  await supabaseAdmin
    .from('calendar_connections')
    .update({
      status: 'inactive',
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)
}

function canonicalAccountId(
  connection: Pick<CalendarConnection, 'provider' | 'account_id' | 'account_email' | 'calendar_id'>,
) {
  if (connection.provider === 'google' && connection.account_id === 'primary') {
    if (connection.account_email) return connection.account_email
    if (connection.calendar_id && connection.calendar_id !== 'primary') return connection.calendar_id
  }

  return connection.account_id
}

function isLegacyGooglePlaceholderConnection(
  connection: Pick<CalendarConnection, 'provider' | 'account_id' | 'account_email' | 'calendar_id'>,
) {
  return (
    connection.provider === 'google' &&
    connection.account_id === 'primary' &&
    !connection.account_email &&
    (!connection.calendar_id || connection.calendar_id === 'primary')
  )
}

function normalizeGoogleAccountConnections(connections: CalendarConnection[]) {
  const hasNamedGoogleAccount = connections.some(
    (connection) =>
      connection.provider === 'google' && !isLegacyGooglePlaceholderConnection(connection),
  )

  if (!hasNamedGoogleAccount) return connections

  return connections.filter((connection) => !isLegacyGooglePlaceholderConnection(connection))
}

async function deactivateGoogleAccountRows(profileId: string, accountId: string) {
  const updatedAt = new Date().toISOString()

  const { error: directError } = await supabaseAdmin
    .from('calendar_connections')
    .update({
      status: 'inactive',
      updated_at: updatedAt,
    })
    .eq('profile_id', profileId)
    .eq('provider', 'google')
    .eq('account_id', accountId)

  if (directError) throw directError

  const { error: legacyError } = await supabaseAdmin
    .from('calendar_connections')
    .update({
      status: 'inactive',
      updated_at: updatedAt,
    })
    .eq('profile_id', profileId)
    .eq('provider', 'google')
    .eq('account_id', 'primary')
    .eq('account_email', accountId)

  if (legacyError) throw legacyError
}

function uniqueAccountIds(connections: CalendarConnection[]) {
  return [
    ...new Set(
      normalizeGoogleAccountConnections(connections)
        .map((connection) => canonicalAccountId(connection))
        .filter(Boolean),
    ),
  ]
}

function groupConnectionsByAccount(connections: CalendarConnection[]) {
  return normalizeGoogleAccountConnections(connections).reduce<Record<string, CalendarConnection[]>>((groups, connection) => {
    const key = `${connection.provider}:${canonicalAccountId(connection)}`
    groups[key] ||= []
    groups[key].push(connection)
    return groups
  }, {})
}

function visibleConfiguredCalendars(connections: CalendarConnection[]) {
  const normalizedConnections = normalizeGoogleAccountConnections(connections)
  const visible = normalizedConnections.filter((connection) => {
    if (connection.provider === 'apple') {
      return !isLikelyAppleReminderConnection(connection)
    }

    if (connection.provider !== 'google') return true

    return !isSystemCalendar({
      id: connection.calendar_id,
      name: connection.calendar_name,
      primary: connection.is_primary,
      selected: true,
      hidden: false,
      accessRole: connection.access_role,
    })
  })

  return visible.length !== normalizedConnections.length ? visible : normalizedConnections
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
  const [connection] = await getCalendarConnections(profileId, 'google')
  return connection || null
}

function isLegacyCalendarConnectionsSchemaError(message: string) {
  const lower = message.toLowerCase()

  return [
    'provider',
    'account_id',
    'account_email',
    'calendar_name',
    'calendar_label',
    'access_role',
    'is_primary',
    'include_in_conflicts',
    'allow_new_events',
  ].some((column) => lower.includes(column) && lower.includes('does not exist'))
}

async function getLegacyCalendarConnections(profileId: string) {
  const { data, error } = await supabaseAdmin
    .from('calendar_connections')
    .select('id,profile_id,calendar_id,access_token,refresh_token,expires_at,status')
    .eq('profile_id', profileId)
    .eq('status', 'active')
    .order('calendar_id', { ascending: true })

  if (error) throw error

  return ((data || []) as Array<{
    id: string
    profile_id: string
    calendar_id: string
    access_token: string
    refresh_token: string | null
    expires_at: string | null
    status: string
  }>).map((connection) => ({
    ...connection,
    provider: 'google' as const,
    account_id: connection.calendar_id || 'primary',
    account_email: null,
    calendar_name: 'Google Calendar',
    calendar_label: connection.calendar_id === 'primary' ? 'Personal' : 'Google Calendar',
    access_role: 'owner',
    is_primary: connection.calendar_id === 'primary',
    include_in_conflicts: true,
    allow_new_events: true,
  }))
}

async function getCalendarConnections(profileId: string, provider?: CalendarProvider) {
  let query = supabaseAdmin
    .from('calendar_connections')
    .select(
      'id,profile_id,provider,account_id,account_email,calendar_id,calendar_name,calendar_label,access_token,refresh_token,expires_at,access_role,is_primary,include_in_conflicts,allow_new_events,status',
    )
    .eq('profile_id', profileId)
    .eq('status', 'active')
    .order('account_email', { ascending: true, nullsFirst: false })
    .order('is_primary', { ascending: false })
    .order('calendar_name', { ascending: true })

  if (provider) {
    query = query.eq('provider', provider)
  }

  const { data, error } = await query

  if (error) {
    if (provider === 'outlook') {
      if (isLegacyCalendarConnectionsSchemaError(error.message || '')) {
        return []
      }
      throw error
    }

    if (!provider && isLegacyCalendarConnectionsSchemaError(error.message || '')) {
      return getLegacyCalendarConnections(profileId)
    }

    if (provider === 'google' && isLegacyCalendarConnectionsSchemaError(error.message || '')) {
      return getLegacyCalendarConnections(profileId)
    }

    throw error
  }

  return ((data || []) as CalendarConnection[]).map((connection) => ({
    ...connection,
    access_token: decryptCalendarToken(connection.access_token) || '',
    refresh_token: decryptCalendarToken(connection.refresh_token),
  }))
}

async function getGoogleConnections(profileId: string) {
  return getCalendarConnections(profileId, 'google')
}

async function getOutlookConnections(profileId: string) {
  return getCalendarConnections(profileId, 'outlook')
}

async function getAppleConnections(profileId: string) {
  return getCalendarConnections(profileId, 'apple')
}

async function calendarForConnection(connection: CalendarConnection) {
  if (connection.provider === 'google') {
    const auth = googleOAuthClient()
    auth.setCredentials({
      access_token: connection.access_token,
      refresh_token: connection.refresh_token || undefined,
      expiry_date: connection.expires_at ? new Date(connection.expires_at).getTime() : undefined,
    })

    return {
      provider: 'google' as const,
      calendar: google.calendar({ version: 'v3', auth }),
      connection,
    }
  }

  if (connection.provider === 'apple') {
    return {
      provider: 'apple' as const,
      connection,
    }
  }

  return {
    provider: 'outlook' as const,
    accessToken: await ensureOutlookAccessToken(connection),
    connection,
  }
}

async function calendarForProfile(
  profileId: string,
  options?: { calendarId?: string; accountId?: string; provider?: CalendarProvider },
) {
  const connections = await getCalendarConnections(profileId, options?.provider)
  const connection =
    (options?.calendarId
      ? connections.find((item) => item.calendar_id === options.calendarId)
      : null) ||
    (options?.accountId
      ? connections.find((item) => canonicalAccountId(item) === options.accountId)
      : null) ||
    connections[0]

  if (!connection) return null
  return calendarForConnection(connection)
}

export async function hasConnectedCalendar(profileId: string) {
  return Boolean((await getCalendarConnections(profileId))[0])
}

export async function hasGoogleCalendar(profileId: string) {
  return hasConnectedCalendar(profileId)
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
      .filter((connection) => canonicalAccountId(connection) === accountId)
      .map((connection) => [connection.calendar_id, connection]),
  )

  await deactivateGoogleAccountRows(profileId, options?.reconnectAccountId || accountId)

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
      access_token: encryptCalendarToken(tokens.access_token) || '',
      refresh_token: encryptCalendarToken(tokens.refresh_token || existing?.refresh_token || null),
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

export async function storeOutlookConnection(
  profileId: string,
  code: string,
  options?: { reconnectAccountId?: string | null },
) {
  const tokens = await exchangeMicrosoftCode(code)
  const accountData = await loadOutlookProfileAndCalendars(tokens.access_token)
  const existingConnections = await getOutlookConnections(profileId)
  const existingAccountIds = uniqueAccountIds(existingConnections)
  const accountId = accountData.accountId

  if (!existingAccountIds.includes(accountId) && existingAccountIds.length >= 2) {
    throw new Error('Manoa supports up to 2 Outlook accounts right now.')
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
    .eq('provider', 'outlook')
    .eq('account_id', options?.reconnectAccountId || accountId)

  const rows = accountData.calendars.map((descriptor) => {
    const existing = existingByCalendarId.get(descriptor.id)
    const writable = descriptor.canEdit

    return {
      profile_id: profileId,
      provider: 'outlook' as const,
      account_id: accountId,
      account_email: accountData.accountEmail,
      calendar_id: descriptor.id,
      calendar_name: descriptor.name,
      calendar_label:
        existing?.calendar_label?.trim() ||
        (descriptor.isDefaultCalendar && !existingAccountIds.length ? 'Personal' : descriptor.name),
      access_token: encryptCalendarToken(tokens.access_token) || '',
      refresh_token: encryptCalendarToken(tokens.refresh_token),
      expires_at: tokens.expires_at,
      access_role: existing?.access_role || mapOutlookAccessRole(descriptor),
      is_primary: descriptor.isDefaultCalendar,
      include_in_conflicts: existing?.include_in_conflicts ?? true,
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
    accountEmail: accountData.accountEmail,
    calendarCount: rows.length,
  }
}

export async function storeAppleConnection(
  profileId: string,
  {
    email,
    appSpecificPassword,
  }: {
    email: string
    appSpecificPassword: string
  },
  options?: { reconnectAccountId?: string | null },
) {
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedPassword = appSpecificPassword.trim()
  if (!normalizedEmail || !normalizedPassword) {
    throw new Error('Apple email and app-specific password are both required.')
  }

  const accountData = await discoverAppleCalendars(normalizedEmail, normalizedPassword)
  const existingConnections = await getAppleConnections(profileId)
  const existingAccountIds = uniqueAccountIds(existingConnections)
  const accountId = accountData.accountId

  if (!existingAccountIds.includes(accountId) && existingAccountIds.length >= 1) {
    throw new Error('Manoa supports 1 Apple account right now.')
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
    .eq('provider', 'apple')
    .eq('account_id', options?.reconnectAccountId || accountId)

  const defaultBookingCalendarId =
    accountData.calendars.find((descriptor) => descriptor.canEdit && descriptor.isDefaultCalendar)?.id ||
    accountData.calendars.find((descriptor) => descriptor.canEdit)?.id ||
    null

  const rows = accountData.calendars.map((descriptor) => {
    const existing = existingByCalendarId.get(descriptor.id)
    const writable = descriptor.canEdit

    return {
      profile_id: profileId,
      provider: 'apple' as const,
      account_id: accountId,
      account_email: accountData.accountEmail,
      calendar_id: descriptor.id,
      calendar_name: descriptor.name,
      calendar_label:
        existing?.calendar_label?.trim() ||
        (descriptor.isDefaultCalendar && !existingAccountIds.length ? 'Personal' : descriptor.name),
      access_token: encryptCalendarToken(normalizedPassword) || '',
      refresh_token: null,
      expires_at: null,
      access_role: existing?.access_role || (writable ? 'owner' : 'reader'),
      is_primary: descriptor.isDefaultCalendar,
      include_in_conflicts: existing?.include_in_conflicts ?? true,
      allow_new_events: existing?.allow_new_events ?? (writable && descriptor.id === defaultBookingCalendarId),
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
    accountEmail: accountData.accountEmail,
    calendarCount: rows.length,
  }
}

function configuredAccountsFromConnections(connections: CalendarConnection[]) {
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
          accountId: canonicalAccountId(connection),
          accountEmail: connection.account_email,
          calendarId: connection.calendar_id,
          provider: connection.provider,
          sourceName: cleanCalendarDisplayText(connection.calendar_name) || connection.calendar_name,
          label: displayCalendarName(connection),
          includeInConflicts: connection.include_in_conflicts,
          allowNewEvents: connection.allow_new_events,
          canWrite: canWriteToCalendar(connection.access_role),
          isPrimary: connection.is_primary,
        }))

      return {
        provider: group[0].provider,
        accountId: canonicalAccountId(group[0]),
        accountEmail: group[0].account_email,
        calendars: sortedCalendars,
      } satisfies ConfiguredCalendarAccount
    })
    .sort((left, right) => {
      if (left.provider !== right.provider) {
        return left.provider.localeCompare(right.provider)
      }

      return (left.accountEmail || left.accountId).localeCompare(right.accountEmail || right.accountId)
    })
}

export async function listConfiguredCalendarAccounts(profileId: string) {
  const connections = visibleConfiguredCalendars(await getCalendarConnections(profileId))
  return configuredAccountsFromConnections(connections)
}

export async function listConfiguredGoogleCalendars(profileId: string) {
  const connections = visibleConfiguredCalendars(await getGoogleConnections(profileId))
  return configuredAccountsFromConnections(connections)
}

export async function listConfiguredOutlookCalendars(profileId: string) {
  const connections = visibleConfiguredCalendars(await getOutlookConnections(profileId))
  return configuredAccountsFromConnections(connections)
}

export async function listConfiguredAppleCalendars(profileId: string) {
  const connections = visibleConfiguredCalendars(await getAppleConnections(profileId))
  return configuredAccountsFromConnections(connections)
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

export async function updateConfiguredCalendar({
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
  return updateConfiguredGoogleCalendar({
    profileId,
    connectionId,
    calendarLabel,
    includeInConflicts,
    allowNewEvents,
  })
}

export async function removeConfiguredCalendar({
  profileId,
  connectionId,
}: {
  profileId: string
  connectionId: string
}) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('calendar_connections')
    .select('id')
    .eq('id', connectionId)
    .eq('profile_id', profileId)
    .eq('status', 'active')
    .maybeSingle<{ id: string }>()

  if (existingError) throw existingError
  if (!existing) throw new Error('Calendar connection not found.')

  const { error } = await supabaseAdmin
    .from('calendar_connections')
    .update({
      status: 'inactive',
      updated_at: new Date().toISOString(),
    })
    .eq('id', connectionId)
    .eq('profile_id', profileId)
    .eq('status', 'active')

  if (error) throw error
}

export async function disconnectCalendarAccount({
  profileId,
  provider,
  accountId,
}: {
  profileId: string
  provider: CalendarProvider
  accountId: string
}) {
  if (provider === 'google') {
    const existingConnections = await getGoogleConnections(profileId)
    const existing = existingConnections.find((connection) => canonicalAccountId(connection) === accountId)

    if (!existing) {
      throw new Error('Calendar account not found.')
    }

    await deactivateGoogleAccountRows(profileId, accountId)
    return
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('calendar_connections')
    .select('id')
    .eq('profile_id', profileId)
    .eq('provider', provider)
    .eq('account_id', accountId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (existingError) throw existingError
  if (!existing) {
    throw new Error('Calendar account not found.')
  }

  const { error } = await supabaseAdmin
    .from('calendar_connections')
    .update({
      status: 'inactive',
      updated_at: new Date().toISOString(),
    })
    .eq('profile_id', profileId)
    .eq('provider', provider)
    .eq('account_id', accountId)
    .eq('status', 'active')

  if (error) throw error
}

function toPlacementOption(connection: CalendarConnection): CalendarPlacementOption {
  return {
    connectionId: connection.id,
    accountId: canonicalAccountId(connection),
    accountEmail: connection.account_email,
    calendarId: connection.calendar_id,
    calendarName: connection.calendar_name,
    calendarLabel: displayCalendarName(connection),
    provider: connection.provider,
    isPrimary: connection.is_primary,
  }
}

export async function resolveCalendarPlacement(
  profileId: string,
  calendarHint?: string,
): Promise<CalendarPlacementResolution> {
  const connections = visibleConfiguredCalendars(await getCalendarConnections(profileId))
  const bookingConnections = connections.filter((connection) => {
    return connection.allow_new_events && canWriteToCalendar(connection.access_role)
  })

  const bookingCalendars = bookingConnections.map(toPlacementOption)
  const normalizedHint = normalizeCalendarText(calendarHint || '')
  const genericHint =
    !normalizedHint ||
    normalizedHint === normalizeCalendarText('Google Calendar') ||
    normalizedHint === normalizeCalendarText('Calendar')

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
  const normalizedConnections = normalizeGoogleAccountConnections(connections)
  const included = normalizedConnections.filter((connection) => connection.include_in_conflicts)
  return (included.length ? included : normalizedConnections).reduce<Record<string, CalendarConnection[]>>(
    (groups, connection) => {
      const key = `${connection.provider}:${canonicalAccountId(connection)}`
      groups[key] ||= []
      groups[key].push(connection)
      return groups
    },
    {},
  )
}

async function listOutlookEventsForConnection({
  connection,
  timeMin,
  timeMax,
  maxResults,
  timeZone,
}: {
  connection: CalendarConnection
  timeMin: Date
  timeMax: Date
  maxResults: number
  timeZone?: string
}) {
  const accessToken = await ensureOutlookAccessToken(connection)
  const params = new URLSearchParams()
  params.set('startDateTime', timeMin.toISOString())
  params.set('endDateTime', timeMax.toISOString())
  params.set(
    '$select',
    'id,subject,start,end,location,bodyPreview,organizer,attendees,responseStatus,recurrence,seriesMasterId,type,originalStart',
  )
  params.set('$orderby', 'start/dateTime')
  params.set('$top', String(maxResults))

  const response = await graphJson<{
    value: Array<{
      id?: string | null
      subject?: string | null
      start?: OutlookDateTime | null
      end?: OutlookDateTime | null
      location?: { displayName?: string | null } | null
      bodyPreview?: string | null
      organizer?: { emailAddress?: { address?: string | null } | null } | null
      attendees?: Array<unknown> | null
      responseStatus?: { response?: string | null } | null
      recurrence?: unknown
      seriesMasterId?: string | null
      type?: string | null
      originalStart?: string | null
    }>
  }>(`/me/calendars/${encodeURIComponent(connection.calendar_id)}/calendarView?${params.toString()}`, {
    accessToken,
  })

  return (response.value || []).map((event) => mapOutlookEvent(event, connection, timeZone))
}

async function listEventsBetween({
  profileId,
  timeMin,
  timeMax,
  maxResults = 20,
  timeZone,
}: {
  profileId: string
  timeMin: Date
  timeMax: Date
  maxResults?: number
  timeZone?: string
}) {
  const resolvedTimeZone = timeZone || (await getProfileTimeZone(profileId))
  const connections = visibleConfiguredCalendars(await getCalendarConnections(profileId))
  if (!connections.length) return []

  const grouped = groupedAvailabilityConnections(connections)
  const eventLists = await Promise.all(
    Object.values(grouped).map(async (accountConnections) => {
      if (accountConnections[0].provider === 'outlook') {
        const accountEventLists = await Promise.all(
          accountConnections.map((connection) =>
            listOutlookEventsForConnection({
              connection,
              timeMin,
              timeMax,
              maxResults,
              timeZone: resolvedTimeZone,
            }),
          ),
        )

        return accountEventLists.flat()
      }

      if (accountConnections[0].provider === 'apple') {
        const accountEventLists = await Promise.all(
          accountConnections.map((connection) =>
            listAppleEventsForConnection({
              connection,
              timeMin,
              timeMax,
              timeZone: resolvedTimeZone,
            }),
          ),
        )

        return accountEventLists.flat()
      }

      const client = await calendarForConnection(accountConnections[0])
      if (client.provider !== 'google') return []

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

          return (response.data.items || []).map((event) =>
            mapGoogleEvent(event, connection, resolvedTimeZone),
          )
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

export async function listAgenda(profileId: string, day: 'today' | 'tomorrow', timeZone?: string) {
  const offset = day === 'tomorrow' ? 1 : 0
  const resolvedTimeZone = timeZone || (await getProfileTimeZone(profileId))
  return listEventsBetween({
    profileId,
    timeMin: startOfDay(offset, resolvedTimeZone),
    timeMax: endOfDay(offset, resolvedTimeZone),
    maxResults: 8,
    timeZone: resolvedTimeZone,
  })
}

export async function listUpcomingEvents({
  profileId,
  windowMinutes,
  startAt = new Date(),
  maxResults = 20,
  timeZone,
}: {
  profileId: string
  windowMinutes: number
  startAt?: Date
  maxResults?: number
  timeZone?: string
}) {
  return listEventsBetween({
    profileId,
    timeMin: startAt,
    timeMax: addMinutes(startAt, windowMinutes),
    maxResults,
    timeZone,
  })
}

export async function getCalendarEvent(
  profileId: string,
  eventId: string,
  calendarId?: string,
  timeZone?: string,
) {
  const resolvedTimeZone = timeZone || (await getProfileTimeZone(profileId))
  const connections = await getCalendarConnections(profileId)
  if (!connections.length) return null

  const targetConnections = calendarId
    ? connections.filter((connection) => connection.calendar_id === calendarId)
    : connections

  for (const connection of targetConnections) {
    if (connection.provider === 'outlook') {
      try {
        const accessToken = await ensureOutlookAccessToken(connection)
        const response = await graphJson<{
          id?: string | null
          subject?: string | null
          start?: OutlookDateTime | null
          end?: OutlookDateTime | null
          location?: { displayName?: string | null } | null
          bodyPreview?: string | null
          organizer?: { emailAddress?: { address?: string | null } | null } | null
          attendees?: Array<unknown> | null
          responseStatus?: { response?: string | null } | null
          recurrence?: unknown
          seriesMasterId?: string | null
          type?: string | null
          originalStart?: string | null
        }>(`/me/calendars/${encodeURIComponent(connection.calendar_id)}/events/${encodeURIComponent(eventId)}`, {
          accessToken,
        })

        return mapOutlookEvent(response, connection, resolvedTimeZone)
      } catch (error) {
        if (String(error).includes('404')) continue
        throw error
      }
    }

    if (connection.provider === 'apple') {
      try {
        return await getAppleEventForConnection(connection, eventId)
      } catch (error) {
        if (String(error).includes('404')) continue
        throw error
      }
    }

    const client = await calendarForConnection(connection)
    if (client.provider !== 'google') continue

    try {
      const response = await client.calendar.events.get({
        calendarId: connection.calendar_id,
        eventId,
      })

      return mapGoogleEvent(response.data, connection, resolvedTimeZone)
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
  timeZone?: string,
  options?: { skippedConnectionIds?: Set<string> },
) {
  if (!connections.length) return []

  const grouped = groupedAvailabilityConnections(connections)
  const busyLists = await Promise.all(
    Object.values(grouped).map(async (accountConnections) => {
      try {
        if (accountConnections[0].provider === 'outlook') {
          const eventLists = await Promise.all(
            accountConnections.map((connection) =>
              listOutlookEventsForConnection({
                connection,
                timeMin,
                timeMax,
                maxResults: 100,
              }),
            ),
          )

          return eventLists.flat().flatMap((event) => {
            if (!event.start || !event.end) return []
            return [{ start: new Date(event.start), end: new Date(event.end) }]
          })
        }

        if (accountConnections[0].provider === 'apple') {
          const eventLists = await Promise.all(
            accountConnections.map((connection) =>
              listAppleEventsForConnection({
                connection,
                timeMin,
                timeMax,
                timeZone,
              }),
            ),
          )

          return eventLists.flat().flatMap((event) => {
            if (!event.start || !event.end) return []
            return [{ start: new Date(event.start), end: new Date(event.end) }]
          })
        }

        const client = await calendarForConnection(accountConnections[0])
        if (client.provider !== 'google') return []
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
      } catch (error) {
        if (!isRevokedCalendarTokenError(error)) throw error

        accountConnections.forEach((connection) => options?.skippedConnectionIds?.add(connection.id))
        await deactivateCalendarConnections(accountConnections)
        return []
      }
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
  if (
    normalizedHint &&
    normalizedHint !== normalizeCalendarText('Google Calendar') &&
    normalizedHint !== normalizeCalendarText('Calendar')
  ) {
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
  location = null,
  timeZone,
}: {
  profileId: string
  title: string
  baseDate: Date
  exactTime?: { hour: number; minute: number } | null
  calendarHint?: string
  calendarId?: string
  durationMinutes?: number
  recurrence?: RecurrenceSpec | null
  location?: string | null
  timeZone?: string
}) {
  const resolvedTimeZone = timeZone || (await getProfileTimeZone(profileId))
  const connections = visibleConfiguredCalendars(await getCalendarConnections(profileId))
  if (!connections.length) return []

  const bookingConnections = connections.filter((connection) => {
    return connection.allow_new_events && canWriteToCalendar(connection.access_role)
  })

  const targetConnection = chooseTargetConnection({
    connections: bookingConnections,
    calendarId,
    calendarHint,
  })
  if (!targetConnection) return []

  const candidateStarts = exactTime
    ? exactScheduleCandidateStarts({
        title,
        baseDate,
        exactTime,
        timeZone: resolvedTimeZone,
      })
    : scheduleCandidateTimesForTitle(title).map((time) => setTime(baseDate, time, resolvedTimeZone))
  const futureCandidateStarts = candidateStarts.filter((start) => {
    return start.getTime() > Date.now() + 5 * 60_000
  })

  if (!futureCandidateStarts.length) return []

  const timeMin = futureCandidateStarts[0]
  const timeMax = addMinutes(futureCandidateStarts[futureCandidateStarts.length - 1], durationMinutes)
  const skippedConnectionIds = new Set<string>()
  const busy = await busyBlocks(connections, timeMin, timeMax, timeZone, { skippedConnectionIds })

  if (skippedConnectionIds.has(targetConnection.id)) {
    throw new Error(`Reconnect ${displayCalendarName(targetConnection)} in Manoa before adding events there.`)
  }

  return futureCandidateStarts
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
      location,
      provider: targetConnection.provider,
      calendarId: targetConnection.calendar_id,
      calendarName: displayCalendarName(targetConnection),
      dayLabel: formatSmsDate(candidate.start, resolvedTimeZone),
      timeLabel: formatSmsTime(candidate.start, resolvedTimeZone),
      timeZone: resolvedTimeZone,
      ownerEmail: targetConnection.account_email || targetConnection.account_id || null,
      recurrence,
    }))
}

export async function createCalendarEvent(
  profileId: string,
  option: ScheduleOption,
): Promise<{ id?: string | null }> {
  const client = await calendarForProfile(profileId, {
    calendarId: option.calendarId,
    provider: option.provider,
  })
  if (!client) throw new Error('Calendar is not connected.')
  if (client.provider === 'apple') {
    return createAppleCalendarEvent(client.connection, option)
  }
  if (client.provider === 'outlook') {
    const recurrence = outlookRecurrenceBody(option.recurrence, option.start, option.timeZone)
    const recurrenceTimeZone = option.recurrence ? option.timeZone || defaultTimezone() : null
    const eventTimeZone = recurrenceTimeZone || option.timeZone || defaultTimezone()
    return graphJson(`/me/calendars/${encodeURIComponent(option.calendarId || client.connection.calendar_id)}/events`, {
      accessToken: client.accessToken,
      method: 'POST',
      body: {
        subject: option.title,
        isAllDay: Boolean(option.isAllDay),
        start: {
          dateTime: option.isAllDay
            ? calendarLocalDateTime(option.start, eventTimeZone)
            : recurrenceTimeZone
            ? calendarLocalDateTime(option.start, recurrenceTimeZone)
            : normalizeOutlookGraphDateTime(option.start),
          timeZone: eventTimeZone,
        },
        end: {
          dateTime: option.isAllDay
            ? calendarLocalDateTime(option.end, eventTimeZone)
            : recurrenceTimeZone
            ? calendarLocalDateTime(option.end, recurrenceTimeZone)
            : normalizeOutlookGraphDateTime(option.end),
          timeZone: eventTimeZone,
        },
        attendees: option.attendees?.map((invitee) => ({
          emailAddress: {
            address: invitee.email,
            name: invitee.displayName || invitee.email,
          },
          type: 'required',
        })),
        location: option.location?.trim()
          ? {
              displayName: option.location.trim(),
            }
          : undefined,
        recurrence,
      },
    })
  }

  const recurrence = option.recurrence
    ? recurrenceRule(option.recurrence, option.start, option.timeZone)
    : null
  const recurrenceTimeZone = option.recurrence ? option.timeZone || defaultTimezone() : null

  const response = await client.calendar.events.insert({
    calendarId: option.calendarId || client.connection.calendar_id,
    sendUpdates: option.attendees?.length ? 'all' : 'none',
    requestBody: {
      summary: option.title,
      start: {
        ...(option.isAllDay
          ? {
              date: allDayDateInTimeZone(option.start, option.timeZone || defaultTimezone()),
            }
          : {
              dateTime: recurrenceTimeZone
                ? calendarLocalDateTime(option.start, recurrenceTimeZone)
                : option.start,
              timeZone: recurrenceTimeZone || undefined,
            }),
      },
      end: {
        ...(option.isAllDay
          ? {
              date: allDayDateInTimeZone(option.end, option.timeZone || defaultTimezone()),
            }
          : {
              dateTime: recurrenceTimeZone
                ? calendarLocalDateTime(option.end, recurrenceTimeZone)
                : option.end,
              timeZone: recurrenceTimeZone || undefined,
            }),
      },
      location: option.location?.trim() || undefined,
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
): Promise<unknown> {
  const client = await calendarForProfile(profileId, {
    calendarId: option.calendarId,
    provider: option.provider,
  })
  if (!client) throw new Error('Calendar is not connected.')
  if (client.provider === 'apple') {
    return updateAppleCalendarEvent(client.connection, eventId, option)
  }
  if (client.provider === 'outlook') {
    const recurrence = outlookRecurrenceBody(option.recurrence, option.start, option.timeZone)
    const recurrenceTimeZone = option.recurrence ? option.timeZone || defaultTimezone() : null
    const eventTimeZone = recurrenceTimeZone || option.timeZone || defaultTimezone()
    return graphJson(`/me/calendars/${encodeURIComponent(option.calendarId || client.connection.calendar_id)}/events/${encodeURIComponent(eventId)}`, {
      accessToken: client.accessToken,
      method: 'PATCH',
      body: {
        subject: option.title,
        isAllDay: Boolean(option.isAllDay),
        start: {
          dateTime: option.isAllDay
            ? calendarLocalDateTime(option.start, eventTimeZone)
            : recurrenceTimeZone
            ? calendarLocalDateTime(option.start, recurrenceTimeZone)
            : normalizeOutlookGraphDateTime(option.start),
          timeZone: eventTimeZone,
        },
        end: {
          dateTime: option.isAllDay
            ? calendarLocalDateTime(option.end, eventTimeZone)
            : recurrenceTimeZone
            ? calendarLocalDateTime(option.end, recurrenceTimeZone)
            : normalizeOutlookGraphDateTime(option.end),
          timeZone: eventTimeZone,
        },
        location: option.location?.trim()
          ? {
              displayName: option.location.trim(),
            }
          : undefined,
        recurrence,
      },
    })
  }

  const recurrence = option.recurrence
    ? recurrenceRule(option.recurrence, option.start, option.timeZone)
    : null
  const recurrenceTimeZone = option.recurrence ? option.timeZone || defaultTimezone() : null

  const response = await client.calendar.events.patch({
    calendarId: option.calendarId || client.connection.calendar_id,
    eventId,
    sendUpdates,
    requestBody: {
      summary: option.title,
      start: {
        ...(option.isAllDay
          ? {
              date: allDayDateInTimeZone(option.start, option.timeZone || defaultTimezone()),
            }
          : {
              dateTime: recurrenceTimeZone
                ? calendarLocalDateTime(option.start, recurrenceTimeZone)
                : option.start,
              timeZone: recurrenceTimeZone || undefined,
            }),
      },
      end: {
        ...(option.isAllDay
          ? {
              date: allDayDateInTimeZone(option.end, option.timeZone || defaultTimezone()),
            }
          : {
              dateTime: recurrenceTimeZone
                ? calendarLocalDateTime(option.end, recurrenceTimeZone)
                : option.end,
              timeZone: recurrenceTimeZone || undefined,
            }),
      },
      location: option.location?.trim() || undefined,
      recurrence: recurrence ? [recurrence] : undefined,
    },
  })

  return response.data
}

function mergeGoogleAttendees(
  existing: calendar_v3.Schema$EventAttendee[] | undefined,
  invitees: Invitee[],
) {
  const merged = [...(existing || [])]

  for (const invitee of invitees) {
    const email = invitee.email.trim()
    if (!email) continue
    if (merged.some((attendee) => (attendee.email || '').trim().toLowerCase() === email.toLowerCase())) {
      continue
    }

    merged.push({
      email,
      displayName: invitee.displayName || undefined,
    })
  }

  return merged
}

function mergeOutlookAttendees(existing: unknown, invitees: Invitee[]) {
  const merged = Array.isArray(existing) ? [...existing] : []
  const attendeeEmail = (attendee: unknown) => {
    if (!attendee || typeof attendee !== 'object') return ''
    const emailAddress = (attendee as { emailAddress?: { address?: unknown } }).emailAddress
    return typeof emailAddress?.address === 'string' ? emailAddress.address.trim().toLowerCase() : ''
  }

  for (const invitee of invitees) {
    const email = invitee.email.trim()
    if (!email) continue
    if (merged.some((attendee) => attendeeEmail(attendee) === email.toLowerCase())) continue

    merged.push({
      emailAddress: {
        address: email,
        name: invitee.displayName || email,
      },
      type: 'required',
    })
  }

  return merged
}

function addInviteesToAppleCalendarData(
  calendarData: string,
  invitees: Invitee[],
  organizerEmail?: string | null,
) {
  const lines = unfoldIcs(calendarData).split(/\r?\n/).filter(Boolean)
  const eventStartIndex = lines.findIndex((line) => /^BEGIN:VEVENT$/i.test(line))
  const eventEndIndex = lines.findIndex((line) => /^END:VEVENT$/i.test(line))

  if (eventStartIndex === -1 || eventEndIndex === -1 || eventEndIndex <= eventStartIndex) {
    throw new Error('Apple Calendar invite failed: event data could not be updated')
  }

  const eventLines = lines.slice(eventStartIndex + 1, eventEndIndex)
  const existingAttendeeEmails = new Set(
    eventLines.map(attendeeEmailFromLine).filter(Boolean),
  )
  const additions = invitees
    .filter((invitee) => {
      const email = invitee.email.trim().toLowerCase()
      return email && !existingAttendeeEmails.has(email)
    })
    .map(attendeeLine)

  if (!additions.length) {
    return serializeIcsLines(lines)
  }

  const hasOrganizer = eventLines.some((line) => parseIcsProperty(line)?.name === 'ORGANIZER')
  const organizerAddition =
    hasOrganizer || !organizerEmail?.trim() ? [] : [organizerLine(organizerEmail)]
  const dtstampIndex = eventLines.findIndex((line) => parseIcsProperty(line)?.name === 'DTSTAMP')
  if (dtstampIndex >= 0) {
    lines[eventStartIndex + 1 + dtstampIndex] = `DTSTAMP:${basicUtcTimestamp(new Date())}`
  }

  const sequenceIndex = eventLines.findIndex((line) => parseIcsProperty(line)?.name === 'SEQUENCE')
  if (sequenceIndex >= 0) {
    const currentSequence = Number(parseIcsProperty(eventLines[sequenceIndex])?.value || '0')
    lines[eventStartIndex + 1 + sequenceIndex] = `SEQUENCE:${Number.isFinite(currentSequence) ? currentSequence + 1 : 1}`
  } else {
    additions.unshift('SEQUENCE:1')
  }

  lines.splice(eventEndIndex, 0, ...organizerAddition, ...additions)
  return serializeIcsLines(lines)
}

async function addInviteesToAppleCalendarEvent(
  connection: CalendarConnection,
  eventId: string,
  invitees: Invitee[],
) {
  const eventData = await getAppleEventDataForConnection(connection, eventId)
  const body = addInviteesToAppleCalendarData(
    eventData.text,
    invitees,
    connection.account_email || connection.account_id,
  )
  const response = await fetch(eventData.url, {
    method: 'PUT',
    headers: {
      Authorization: appleAuthHeader(connection.account_email || connection.account_id, connection.access_token),
      'Content-Type': 'text/calendar; charset=utf-8',
    },
    body,
  })

  if (!response.ok) {
    const responseBody = await response.text()
    throw new Error(`Apple Calendar invite failed: ${response.status} ${responseBody || response.statusText}`)
  }

  await verifyAppleEventExists(connection, eventData.url, 'update')
}

export async function addInviteesToCalendarEvent(
  profileId: string,
  target: Pick<EventSummary, 'id' | 'calendarId' | 'provider'>,
  invitees: Invitee[],
): Promise<void> {
  const client = await calendarForProfile(profileId, {
    calendarId: target.calendarId,
    provider: target.provider,
  })
  if (!client) throw new Error('Calendar is not connected.')

  if (client.provider === 'apple') {
    await addInviteesToAppleCalendarEvent(client.connection, target.id, invitees)
    return
  }

  if (client.provider === 'outlook') {
    const calendarId = target.calendarId || client.connection.calendar_id
    const current = await graphJson<{ attendees?: unknown }>(
      `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(target.id)}`,
      {
        accessToken: client.accessToken,
      },
    )
    await graphJson(`/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(target.id)}`, {
      accessToken: client.accessToken,
      method: 'PATCH',
      body: {
        attendees: mergeOutlookAttendees(current.attendees, invitees),
      },
    })
    return
  }

  const calendarId = target.calendarId || client.connection.calendar_id
  const current = await client.calendar.events.get({
    calendarId,
    eventId: target.id,
  })

  await client.calendar.events.patch({
    calendarId,
    eventId: target.id,
    sendUpdates: 'all',
    requestBody: {
      attendees: mergeGoogleAttendees(current.data.attendees, invitees),
    },
  })
}

export async function deleteCalendarEvent(
  profileId: string,
  eventId: string,
  calendarId?: string,
  sendUpdates: 'all' | 'none' = 'none',
): Promise<void> {
  const client = await calendarForProfile(profileId, { calendarId })
  if (!client) throw new Error('Calendar is not connected.')
  if (client.provider === 'apple') {
    await deleteAppleCalendarEvent(client.connection, eventId)
    return
  }
  if (client.provider === 'outlook') {
    await graphJson(`/me/calendars/${encodeURIComponent(calendarId || client.connection.calendar_id)}/events/${encodeURIComponent(eventId)}`, {
      accessToken: client.accessToken,
      method: 'DELETE',
    })
    return
  }

  await client.calendar.events.delete({
    calendarId: calendarId || client.connection.calendar_id,
    eventId,
    sendUpdates,
  })
}
