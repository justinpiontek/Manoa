import { parseGoogleRecurrence, recurrenceRule, recurrenceSummary, type RecurrenceSpec } from './recurrence'
import type { Invitee } from '../sms/invitees'
import { google, type calendar_v3 } from 'googleapis'
import type { Credentials } from 'google-auth-library'
import { appUrl, requiredEnv } from '../env'
import { supabaseAdmin } from '../supabaseAdmin'
import { decryptCalendarToken, encryptCalendarToken } from './tokenEncryption'
import {
  addMinutes,
  endOfDay,
  formatSmsDate,
  formatSmsTime,
  overlaps,
  setTime,
  startOfDay,
} from './dates'

export type CalendarProvider = 'google' | 'outlook'

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
  provider: CalendarProvider
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
  provider: CalendarProvider
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
    provider: 'google',
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
    recurrence?: unknown
    seriesMasterId?: string | null
    type?: string | null
    originalStart?: string | null
  },
  connection: Pick<CalendarConnection, 'calendar_id' | 'calendar_name' | 'calendar_label'>,
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
    timeLabel: start ? formatSmsTime(new Date(start)) : 'All day',
    location: event.location?.displayName || '',
    description: event.bodyPreview || '',
    organizerEmail: event.organizer?.emailAddress?.address || '',
    attendeeCount: event.attendees?.length || 0,
    recurrence: recurrence ? [recurrenceSummary(recurrence, start) || 'Recurring event'] : null,
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
  return provider === 'outlook' ? 'Outlook' : 'Google'
}

function normalizeOutlookGraphDateTime(value: Date | string) {
  return new Date(value).toISOString().replace(/Z$/, '')
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

function parseOutlookRecurrence(
  recurrence: unknown,
  start: string,
): RecurrenceSpec | null {
  if (!recurrence || typeof recurrence !== 'object') return null

  const pattern = (recurrence as { pattern?: Record<string, unknown> }).pattern
  if (!pattern || typeof pattern !== 'object') return null

  const type = String(pattern.type || '')
  const interval = Number(pattern.interval || 1)

  if (type === 'weekly' && (interval === 1 || interval === 2)) {
    return {
      unit: 'week',
      interval: interval as 1 | 2,
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
    }
  }

  return null
}

function outlookRecurrenceBody(spec: RecurrenceSpec | null | undefined, start: string) {
  if (!spec) return undefined

  const date = new Date(start)
  if (Number.isNaN(date.getTime())) return undefined

  const weekdayNames = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ]
  const nth = Math.floor((date.getUTCDate() - 1) / 7) + 1
  const index = nth >= 5 ? 'last' : (['first', 'second', 'third', 'fourth'][nth - 1] || 'last')

  if (spec.unit === 'week') {
    return {
      pattern: {
        type: 'weekly',
        interval: spec.interval,
        daysOfWeek: [weekdayNames[date.getUTCDay()]],
        firstDayOfWeek: 'sunday',
      },
      range: {
        type: 'noEnd',
        startDate: date.toISOString().slice(0, 10),
      },
    }
  }

  if (spec.mode === 'nth_weekday') {
    return {
      pattern: {
        type: 'relativeMonthly',
        interval: 1,
        daysOfWeek: [weekdayNames[date.getUTCDay()]],
        index,
      },
      range: {
        type: 'noEnd',
        startDate: date.toISOString().slice(0, 10),
      },
    }
  }

  return {
    pattern: {
      type: 'absoluteMonthly',
      interval: 1,
      dayOfMonth: date.getUTCDate(),
    },
    range: {
      type: 'noEnd',
      startDate: date.toISOString().slice(0, 10),
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

function canonicalAccountId(
  connection: Pick<CalendarConnection, 'provider' | 'account_id' | 'account_email'>,
) {
  if (connection.provider === 'google' && connection.account_id === 'primary' && connection.account_email) {
    return connection.account_email
  }

  return connection.account_id
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
  return [...new Set(connections.map((connection) => canonicalAccountId(connection)).filter(Boolean))]
}

function groupConnectionsByAccount(connections: CalendarConnection[]) {
  return connections.reduce<Record<string, CalendarConnection[]>>((groups, connection) => {
    const key = `${connection.provider}:${canonicalAccountId(connection)}`
    groups[key] ||= []
    groups[key].push(connection)
    return groups
  }, {})
}

function visibleConfiguredCalendars(connections: CalendarConnection[]) {
  const visible = connections.filter((connection) => {
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
          sourceName: connection.calendar_name,
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
  const included = connections.filter((connection) => connection.include_in_conflicts)
  return (included.length ? included : connections).reduce<Record<string, CalendarConnection[]>>(
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
}: {
  connection: CalendarConnection
  timeMin: Date
  timeMax: Date
  maxResults: number
}) {
  const accessToken = await ensureOutlookAccessToken(connection)
  const params = new URLSearchParams()
  params.set('startDateTime', timeMin.toISOString())
  params.set('endDateTime', timeMax.toISOString())
  params.set(
    '$select',
    'id,subject,start,end,location,bodyPreview,organizer,attendees,recurrence,seriesMasterId,type,originalStart',
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
      recurrence?: unknown
      seriesMasterId?: string | null
      type?: string | null
      originalStart?: string | null
    }>
  }>(`/me/calendars/${encodeURIComponent(connection.calendar_id)}/calendarView?${params.toString()}`, {
    accessToken,
  })

  return (response.value || []).map((event) => mapOutlookEvent(event, connection))
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
          recurrence?: unknown
          seriesMasterId?: string | null
          type?: string | null
          originalStart?: string | null
        }>(`/me/calendars/${encodeURIComponent(connection.calendar_id)}/events/${encodeURIComponent(eventId)}`, {
          accessToken,
        })

        return mapOutlookEvent(response, connection)
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
  const connections = visibleConfiguredCalendars(await getCalendarConnections(profileId))
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
      provider: targetConnection.provider,
      calendarId: targetConnection.calendar_id,
      calendarName: displayCalendarName(targetConnection),
      dayLabel: formatSmsDate(candidate.start),
      timeLabel: formatSmsTime(candidate.start),
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
  if (client.provider === 'outlook') {
    const recurrence = outlookRecurrenceBody(option.recurrence, option.start)
    return graphJson(`/me/calendars/${encodeURIComponent(option.calendarId || client.connection.calendar_id)}/events`, {
      accessToken: client.accessToken,
      method: 'POST',
      body: {
        subject: option.title,
        start: {
          dateTime: normalizeOutlookGraphDateTime(option.start),
          timeZone: 'UTC',
        },
        end: {
          dateTime: normalizeOutlookGraphDateTime(option.end),
          timeZone: 'UTC',
        },
        attendees: option.attendees?.map((invitee) => ({
          emailAddress: {
            address: invitee.email,
            name: invitee.displayName || invitee.email,
          },
          type: 'required',
        })),
        recurrence,
      },
    })
  }

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
): Promise<unknown> {
  const client = await calendarForProfile(profileId, {
    calendarId: option.calendarId,
    provider: option.provider,
  })
  if (!client) throw new Error('Calendar is not connected.')
  if (client.provider === 'outlook') {
    const recurrence = outlookRecurrenceBody(option.recurrence, option.start)
    return graphJson(`/me/calendars/${encodeURIComponent(option.calendarId || client.connection.calendar_id)}/events/${encodeURIComponent(eventId)}`, {
      accessToken: client.accessToken,
      method: 'PATCH',
      body: {
        subject: option.title,
        start: {
          dateTime: normalizeOutlookGraphDateTime(option.start),
          timeZone: 'UTC',
        },
        end: {
          dateTime: normalizeOutlookGraphDateTime(option.end),
          timeZone: 'UTC',
        },
        recurrence,
      },
    })
  }

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
): Promise<void> {
  const client = await calendarForProfile(profileId, { calendarId })
  if (!client) throw new Error('Calendar is not connected.')
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
