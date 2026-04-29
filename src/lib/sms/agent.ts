import {
  addInviteesToCalendarEvent,
  createCalendarEvent,
  deleteCalendarEvent,
  findScheduleOptions,
  getCalendarEvent,
  hasConnectedCalendar,
  listAgenda,
  resolveCalendarPlacement,
  listUpcomingEvents,
  updateCalendarEvent,
  type CalendarPlacementOption,
  type EventSummary,
  type ScheduleOption,
} from '../calendar/google'
import {
  addDays,
  addMinutes,
  dateTimePartsInTimeZone,
  formatSmsDate,
  formatSmsTime,
  nextDateForWeekday,
  sameCalendarDay,
  setTime,
  startOfDay,
} from '../calendar/dates'
import { parseGoogleRecurrence, recurrenceSummary, type RecurrenceSpec } from '../calendar/recurrence'
import { scheduleCandidateTimesForTitle } from '../calendar/schedulingPreferences'
import {
  buildBusinessAliases,
  extractPhoneFromText,
  inferBusinessContact,
  saveOrUpdateBusinessContact,
  type BusinessContact,
} from '../businessContacts'
import {
  buildPersonAliases,
  findPersonContact,
  saveOrUpdatePersonContact,
} from '../peopleContacts'
import { isMissingDefaultDurationColumnError } from '../profiles'
import { profileIdFromDashboardSender } from './sender'
import {
  classifyEventAuthority,
  looksExternalAppointment,
  type EventAuthority,
} from '../eventAuthority'
import { supabaseAdmin } from '../supabaseAdmin'
import {
  inviteeLabel,
  isInviteeEmailFollowUp,
  parseExistingEventInviteRequest,
  parseInviteesFromText,
  resolveInviteeFollowUp,
  type ExistingEventInviteRequest,
  type Invitee,
} from './invitees'
import { parseSmsIntentWithAI, type AiConversationTurn } from './aiIntent'
import { listSmsAiIntentContext } from './thread'
import { resolvePendingChoice } from './pendingChoice'
import { parseSmsIntent, parseSmsTime, type DateWindow, type ParsedSmsIntent } from './parser'

type SmsProfile = {
  id: string
  email: string
  phone_e164: string | null
  timezone: string
  default_event_duration_minutes: number
  phone_confirmed_at: string | null
  sms_opted_out_at: string | null
  subscriptionStatus: string
}

type PendingKind =
  | 'schedule'
  | 'choose_calendar'
  | 'resolve_invitees'
  | 'reschedule'
  | 'select_reschedule_target'
  | 'select_cancel_target'
  | 'invited_reschedule_action'
  | 'invited_reschedule_hold'
  | 'invited_cancel_action'
  | 'external_call_prep'
  | 'external_cancel_confirm'
  | 'external_reschedule_confirm'
  | 'save_business_contact_phone'

type SerializedDateWindow = {
  start: string
  end: string
  label: string
}

type PendingPayload = {
  options?: ScheduleOption[]
  calendarChoices?: CalendarPlacementOption[]
  visibleCalendarChoiceCount?: number
  selectedOption?: ScheduleOption
  events?: EventSummary[]
  target?: EventSummary
  seriesTarget?: EventSummary
  businessName?: string
  phoneE164?: string | null
  callNote?: string
  requestedBaseDate?: string
  exactTime?: { hour: number; minute: number } | null
  authority?: EventAuthority
  recurrence?: RecurrenceSpec | null
  stage?: 'scope' | 'options'
  scope?: 'single' | 'series'
  followUpKind?: PendingKind | null
  recentlyCreated?: boolean
  holdEventId?: string | null
  holdCalendarId?: string | null
  attendees?: Invitee[]
  unresolvedInvitees?: string[]
  scheduleRequest?: {
    title: string
    baseDate: string
    dateWindow?: SerializedDateWindow | null
    exactTime: { hour: number; minute: number } | null
    durationMinutes: number
    recurrence: RecurrenceSpec | null
    location?: string | null
    serviceConfirmed?: boolean
  }
}

type PendingAction = {
  id: string
  kind: PendingKind
  payload: PendingPayload
}

const activeSubscriptionStatuses = new Set(['active', 'trialing'])
const backgroundPendingKinds: PendingKind[] = [
  'external_cancel_confirm',
  'external_reschedule_confirm',
]
const weekdayNumbers: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

const stopWords = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'])
const startWords = new Set(['start', 'unstop'])
const maxCalendarChoicesToDisplay = 5

function optionList(options: ScheduleOption[]) {
  return options
    .map(
      (option, index) =>
        `${index + 1}. ${option.dayLabel} at ${option.timeLabel} on ${option.calendarName}`,
    )
    .join('\n')
}

function callPrepOptionList(options: ScheduleOption[]) {
  return options
    .map((option, index) => `${index + 1}. ${option.dayLabel} at ${option.timeLabel}`)
    .join('\n')
}

function calendarProviderName(provider: CalendarPlacementOption['provider']) {
  if (provider === 'apple') return 'Apple'
  if (provider === 'outlook') return 'Outlook'
  return 'Google'
}

function calendarChoiceDisplayLabel(
  calendar: CalendarPlacementOption,
  calendars: CalendarPlacementOption[],
) {
  const normalizedLabel = tokenizeText(calendar.calendarLabel).join(' ')
  const duplicates = calendars.filter((item) => {
    return tokenizeText(item.calendarLabel).join(' ') === normalizedLabel
  })

  if (duplicates.length <= 1) return calendar.calendarLabel

  const providerName = calendarProviderName(calendar.provider)
  const providerDuplicates = duplicates.filter((item) => item.provider === calendar.provider)
  if (providerDuplicates.length === 1) {
    return `${calendar.calendarLabel} (${providerName})`
  }

  if (calendar.accountEmail) {
    return `${calendar.calendarLabel} - ${calendar.accountEmail}`
  }

  if (calendar.calendarName && calendar.calendarName !== calendar.calendarLabel) {
    return `${calendar.calendarLabel} - ${calendar.calendarName}`
  }

  return `${calendar.calendarLabel} (${providerName})`
}

function calendarChoiceList(
  calendars: CalendarPlacementOption[],
  allCalendars: CalendarPlacementOption[] = calendars,
) {
  return calendars
    .map((calendar, index) => `${index + 1}. ${calendarChoiceDisplayLabel(calendar, allCalendars)}`)
    .join('\n')
}

function calendarChoiceRank(calendar: CalendarPlacementOption) {
  const label = tokenizeText(`${calendar.calendarLabel} ${calendar.calendarName}`).join(' ')
  if (calendar.isPrimary) return 0
  if (/\b(personal|home|work|main|primary)\b/.test(label)) return 1
  if (/\b(family|business|company)\b/.test(label)) return 2
  return 3
}

function prioritizedCalendarChoices(calendars: CalendarPlacementOption[]) {
  return [...calendars].sort((left, right) => {
    const rankDelta = calendarChoiceRank(left) - calendarChoiceRank(right)
    if (rankDelta) return rankDelta
    return calendarChoiceDisplayLabel(left, calendars).localeCompare(calendarChoiceDisplayLabel(right, calendars))
  })
}

function visibleCalendarChoices(calendars: CalendarPlacementOption[]) {
  return prioritizedCalendarChoices(calendars).slice(0, maxCalendarChoicesToDisplay)
}

function calendarChoiceReply({
  heading,
  calendars,
}: {
  heading: string
  calendars: CalendarPlacementOption[]
}) {
  const visibleCalendars = visibleCalendarChoices(calendars)
  const extraCount = calendars.length - visibleCalendars.length
  const lines = [
    heading,
    calendarChoiceList(visibleCalendars, calendars),
  ]

  if (extraCount > 0) {
    lines.push(`There are ${extraCount} more calendars hidden. You can type the exact calendar name instead.`)
  }

  lines.push('Reply with a number or calendar name.')
  return {
    reply: lines.join('\n'),
    visibleCount: visibleCalendars.length,
  }
}

function actionChoiceList(lines: string[]) {
  return lines.join('\n')
}

function recurrenceLine(options: ScheduleOption[]) {
  const firstOption = options[0]
  const summary = recurrenceSummary(
    firstOption?.recurrence,
    firstOption?.start || '',
    firstOption?.timeZone,
  )
  return summary || null
}

function bookingText(option: ScheduleOption) {
  const location = option.location?.trim()
  const locationLine = location ? `\nLocation: ${location}.` : ''
  const summary = recurrenceSummary(option.recurrence, option.start, option.timeZone)
  if (summary) {
    return `Booked ${option.title} starting ${option.dayLabel} at ${option.timeLabel}.${locationLine}\n${summary}`
  }

  return `Booked ${option.title} for ${option.dayLabel} at ${option.timeLabel}.${locationLine}`
}

function createdEventSummaryFromOption(
  option: ScheduleOption,
  eventId: string | null | undefined,
  organizerEmail?: string | null,
): EventSummary | null {
  if (!eventId) return null

  return {
    id: eventId,
    title: option.title,
    start: option.start,
    end: option.end,
    provider: option.provider,
    calendarId: option.calendarId,
    calendarName: option.calendarName,
    timeLabel: option.timeLabel,
    location: option.location || '',
    description: '',
    organizerEmail: organizerEmail || '',
    ownerEmail: option.ownerEmail || organizerEmail || '',
    attendeeCount: option.attendees?.length || 0,
  }
}

async function storeRecentCreatedEvent({
  profileId,
  smsFrom,
  option,
  eventId,
  organizerEmail,
}: {
  profileId: string
  smsFrom: string
  option: ScheduleOption
  eventId: string | null | undefined
  organizerEmail?: string | null
}) {
  const event = createdEventSummaryFromOption(option, eventId, organizerEmail)
  if (!event) return

  try {
    await storePendingAction({
      profileId,
      smsFrom,
      kind: 'select_cancel_target',
      payload: {
        events: [event],
        recentlyCreated: true,
      },
    })
  } catch (error) {
    console.error('Could not store recent created event pending action', error)
  }
}

function providerCanSendInvites(provider: ScheduleOption['provider']) {
  return ['apple', 'google', 'outlook'].includes(provider)
}

function attendeesForCalendarEvent(option: ScheduleOption, attendees: Invitee[]) {
  return providerCanSendInvites(option.provider) ? attendees : []
}

function inviteOutcomeLine(option: ScheduleOption, attendees: Invitee[]) {
  if (!attendees.length) return ''

  const summary = inviteeSummary(attendees)
  if (providerCanSendInvites(option.provider)) {
    return `I invited ${summary}.`
  }

  return `${calendarProviderName(option.provider)} Calendar does not send invite emails through Manoa yet, so I booked it on your calendar and saved ${summary} for next time.`
}

function exactAvailabilityReply({
  option,
  attendees,
  unresolvedInvitees,
}: {
  option: ScheduleOption
  attendees: Invitee[]
  unresolvedInvitees: string[]
}) {
  const lines = [
    `I confirmed ${option.dayLabel} at ${option.timeLabel} is available on ${option.calendarName}.`,
  ]

  if (option.location?.trim()) {
    lines.push(`Location: ${option.location.trim()}.`)
  }

  if (attendees.length) {
    lines.push(`Ready to invite: ${inviteeSummary(attendees)}.`)
  }

  if (unresolvedInvitees.length) {
    lines.push(`I still need email${unresolvedInvitees.length > 1 ? 's' : ''} for ${unresolvedInviteeSummary(
      unresolvedInvitees,
    )}.`)
  }

  lines.push('Book it? Reply YES to book or NO to leave it.')
  return lines.join('\n')
}

function normalizeEmail(value: string | null | undefined) {
  return (value || '').trim().toLowerCase()
}

function overlapsOption(event: EventSummary, start: Date, end: Date) {
  const eventStart = new Date(event.start)
  const eventEnd = new Date(event.end)

  if (Number.isNaN(eventStart.getTime()) || Number.isNaN(eventEnd.getTime())) {
    return false
  }

  return eventStart < end && eventEnd > start
}

function isPendingInviteConflict(event: EventSummary, profileEmail: string) {
  const response = (event.selfResponseStatus || '').trim().toLowerCase()
  const organizerEmail = normalizeEmail(event.organizerEmail)
  const userEmail = normalizeEmail(profileEmail)

  return (
    organizerEmail.length > 0 &&
    userEmail.length > 0 &&
    organizerEmail !== userEmail &&
    (response === 'tentative' || response === 'needsaction')
  )
}

function pendingInviteScheduleReply({
  conflict,
  requestedOption,
  alternatives,
}: {
  conflict: EventSummary
  requestedOption: ScheduleOption
  alternatives: ScheduleOption[]
}) {
  const lines = [
    `You have a pending invite for "${conflict.title}" at ${conflict.timeLabel}.`,
    `1. Book over it anyway: ${requestedOption.dayLabel} at ${requestedOption.timeLabel} on ${requestedOption.calendarName}`,
  ]

  if (alternatives[0]) {
    lines.push(`2. ${alternatives[0].dayLabel} at ${alternatives[0].timeLabel} on ${alternatives[0].calendarName}`)
  }

  if (alternatives[1]) {
    lines.push(`3. ${alternatives[1].dayLabel} at ${alternatives[1].timeLabel} on ${alternatives[1].calendarName}`)
  }

  if (alternatives[1]) {
    lines.push('Reply 1, 2, or 3.')
  } else if (alternatives[0]) {
    lines.push('Reply 1 or 2.')
  } else {
    lines.push('Reply 1 to book over it anyway, or text a different day or time.')
  }

  return lines.join('\n')
}

function hardConflictScheduleReply({
  conflict,
  requestedOption,
  alternatives,
}: {
  conflict: EventSummary
  requestedOption: ScheduleOption
  alternatives: ScheduleOption[]
}) {
  const lines = [
    `That time is already reserved for "${conflict.title}" at ${conflict.timeLabel} on ${conflict.calendarName}.`,
    `1. Book anyway: ${requestedOption.dayLabel} at ${requestedOption.timeLabel} on ${requestedOption.calendarName}`,
  ]

  if (alternatives[0]) {
    lines.push(`2. Adjust to ${alternatives[0].dayLabel} at ${alternatives[0].timeLabel} on ${alternatives[0].calendarName}`)
  }

  if (alternatives[1]) {
    lines.push(`3. Adjust to ${alternatives[1].dayLabel} at ${alternatives[1].timeLabel} on ${alternatives[1].calendarName}`)
  }

  if (alternatives[1]) {
    lines.push('Reply 1, 2, or 3.')
  } else if (alternatives[0]) {
    lines.push('Reply 1 or 2.')
  } else {
    lines.push('Reply 1 to book anyway, or text a different day or time.')
  }

  return lines.join('\n')
}

function genericNoOpeningReply({
  calendarLabel,
  dateLabel,
}: {
  calendarLabel?: string | null
  dateLabel?: string | null
}) {
  return `I couldn't find an opening${calendarLabel ? ` on ${calendarLabel}` : ''}${dateLabel ? ` for ${dateLabel}` : ''}. Try a specific weekday or a different calendar.`
}

function blockedDayNoOpeningReply({
  conflict,
  pendingInvite,
  options,
  attendees,
  unresolvedInvitees,
}: {
  conflict: EventSummary
  pendingInvite: boolean
  options: ScheduleOption[]
  attendees: Invitee[]
  unresolvedInvitees: string[]
}) {
  const lines = [
    pendingInvite
      ? `You have a pending invite for "${conflict.title}" at ${conflict.timeLabel} on ${conflict.calendarName}.`
      : `That day is already reserved for "${conflict.title}" at ${conflict.timeLabel} on ${conflict.calendarName}.`,
    ...options.map(
      (option, index) =>
        `${index + 1}. Book anyway: ${option.dayLabel} at ${option.timeLabel} on ${option.calendarName}`,
    ),
  ]

  if (options.length >= 3) {
    lines.push('Reply 1, 2, or 3.')
  } else if (options.length === 2) {
    lines.push('Reply 1 or 2.')
  } else {
    lines.push('Reply 1 to book anyway, or text a different day or time.')
  }

  if (attendees.length) {
    lines.push(`Ready to invite: ${inviteeSummary(attendees)}.`)
  }
  if (unresolvedInvitees.length) {
    lines.push(
      `I still need email${unresolvedInvitees.length > 1 ? 's' : ''} for ${unresolvedInviteeSummary(
        unresolvedInvitees,
      )}.`,
    )
  }

  return lines.join('\n')
}

async function explainNoOpeningDayConflict({
  profile,
  title,
  baseDate,
  exactTime,
  durationMinutes,
  dateWindow,
  calendarLabel,
}: {
  profile: SmsProfile
  title: string
  baseDate: Date
  exactTime: { hour: number; minute: number } | null | undefined
  durationMinutes: number
  dateWindow?: DateWindow | null
  calendarLabel?: string | null
}) {
  if (exactTime) return null

  const anchorDate =
    dateWindow && sameCalendarDay(dateWindow.start, dateWindow.end, profile.timezone)
      ? dateWindow.start
      : null

  if (!anchorDate) return null

  const dayStart = setTime(anchorDate, { hour: 0, minute: 0 }, profile.timezone)
  const nextDayStart = addDays(dayStart, 1, profile.timezone)
  const dayWindowMinutes = Math.max(
    1,
    Math.round((nextDayStart.getTime() - dayStart.getTime()) / 60_000),
  )

  const candidateStarts = scheduleCandidateTimesForTitle(title)
    .map((time) => setTime(dayStart, time, profile.timezone))
    .filter((start) => start.getTime() > Date.now() + 5 * 60_000)

  if (!candidateStarts.length) return null

  const events = await listUpcomingEvents({
    profileId: profile.id,
    startAt: dayStart,
    windowMinutes: dayWindowMinutes,
    maxResults: 50,
    timeZone: profile.timezone,
  })

  const slotConflicts = candidateStarts.map((start) => {
    const end = addMinutes(start, durationMinutes)
    const pendingInviteConflict = events.find(
      (event) => overlapsOption(event, start, end) && isPendingInviteConflict(event, profile.email),
    )

    if (pendingInviteConflict) {
      return {
        event: pendingInviteConflict,
        pendingInvite: true,
      }
    }

    const hardConflict = events.find(
      (event) => overlapsOption(event, start, end) && !isPendingInviteConflict(event, profile.email),
    )

    if (hardConflict) {
      return {
        event: hardConflict,
        pendingInvite: false,
      }
    }

    return null
  })

  if (slotConflicts.some((item) => !item)) return null

  const allDayConflict = slotConflicts.find((item) => item?.event.timeLabel === 'All day')
  if (allDayConflict) {
    return allDayConflict.pendingInvite
      ? `I couldn't find an opening${calendarLabel ? ` on ${calendarLabel}` : ''}${dateWindow?.label ? ` for ${dateWindow.label}` : ''} because you have a pending invite for "${allDayConflict.event.title}" at ${allDayConflict.event.timeLabel} on ${allDayConflict.event.calendarName}. Text a specific time if you want to book over it anyway, or choose a different day or calendar.`
      : `I couldn't find an opening${calendarLabel ? ` on ${calendarLabel}` : ''}${dateWindow?.label ? ` for ${dateWindow.label}` : ''} because that day is already reserved for "${allDayConflict.event.title}" at ${allDayConflict.event.timeLabel} on ${allDayConflict.event.calendarName}. Text a specific time if you want to book anyway, or choose a different day or calendar.`
  }

  const uniqueConflictIds = new Set(slotConflicts.map((item) => item?.event.id))
  if (uniqueConflictIds.size === 1 && slotConflicts[0]) {
    return slotConflicts[0].pendingInvite
      ? `I couldn't find an opening${calendarLabel ? ` on ${calendarLabel}` : ''}${dateWindow?.label ? ` for ${dateWindow.label}` : ''} because you have a pending invite for "${slotConflicts[0].event.title}" at ${slotConflicts[0].event.timeLabel} on ${slotConflicts[0].event.calendarName}. Text a specific time if you want to book over it anyway, or choose a different day or calendar.`
      : `I couldn't find an opening${calendarLabel ? ` on ${calendarLabel}` : ''}${dateWindow?.label ? ` for ${dateWindow.label}` : ''} because that day is already reserved for "${slotConflicts[0].event.title}" at ${slotConflicts[0].event.timeLabel} on ${slotConflicts[0].event.calendarName}. Text a specific time if you want to book anyway, or choose a different day or calendar.`
  }

  return null
}

async function noOpeningScheduleReply({
  profile,
  smsFrom,
  title,
  baseDate,
  exactTime,
  durationMinutes,
  dateWindow,
  chosenCalendar,
  location,
  recurrence,
  attendees,
  unresolvedInvitees,
  calendarLabel,
}: {
  profile: SmsProfile
  smsFrom: string
  title: string
  baseDate: Date
  exactTime: { hour: number; minute: number } | null | undefined
  durationMinutes: number
  dateWindow?: DateWindow | null
  chosenCalendar?: CalendarPlacementOption | null
  location?: string | null
  recurrence?: RecurrenceSpec | null
  attendees: Invitee[]
  unresolvedInvitees: string[]
  calendarLabel?: string | null
}) {
  const conflictReply = await explainNoOpeningDayConflict({
    profile,
    title,
    baseDate,
    exactTime,
    durationMinutes,
    dateWindow,
    calendarLabel,
  })

  if (
    conflictReply &&
    chosenCalendar &&
    !exactTime &&
    !recurrence &&
    dateWindow &&
    sameCalendarDay(dateWindow.start, dateWindow.end, profile.timezone)
  ) {
    const anchorDate = dateWindow.start
    const bookAnywayOptions = scheduleCandidateTimesForTitle(title)
      .map((time) => {
        const start = setTime(anchorDate, time, profile.timezone)
        return {
          title,
          start: start.toISOString(),
          end: addMinutes(start, durationMinutes).toISOString(),
          location,
          provider: chosenCalendar.provider,
          calendarId: chosenCalendar.calendarId,
          calendarName: chosenCalendar.calendarLabel,
          dayLabel: formatSmsDate(start, profile.timezone),
          timeLabel: formatSmsTime(start, profile.timezone),
          timeZone: profile.timezone,
          ownerEmail: chosenCalendar.accountEmail || chosenCalendar.accountId || null,
          recurrence: null,
        } satisfies ScheduleOption
      })
      .filter((option) => new Date(option.start).getTime() > Date.now() + 5 * 60_000)
      .slice(0, 3)

    if (bookAnywayOptions.length) {
      const events = await listUpcomingEvents({
        profileId: profile.id,
        startAt: setTime(anchorDate, { hour: 0, minute: 0 }, profile.timezone),
        windowMinutes: 24 * 60,
        maxResults: 50,
        timeZone: profile.timezone,
      })

      const firstOption = bookAnywayOptions[0]
      const firstStart = new Date(firstOption.start)
      const firstEnd = new Date(firstOption.end)
      const pendingInviteConflict = events.find(
        (event) => overlapsOption(event, firstStart, firstEnd) && isPendingInviteConflict(event, profile.email),
      )
      const hardConflict = events.find(
        (event) => overlapsOption(event, firstStart, firstEnd) && !isPendingInviteConflict(event, profile.email),
      )
      const representativeConflict = pendingInviteConflict || hardConflict

      if (representativeConflict) {
        await storeScheduleOptionsPending({
          profileId: profile.id,
          smsFrom,
          options: bookAnywayOptions,
          attendees,
          unresolvedInvitees,
          scheduleRequest: {
            title,
            baseDate: baseDate.toISOString(),
            dateWindow: serializeDateWindow(dateWindow),
            exactTime: exactTime ?? null,
            durationMinutes,
            recurrence: recurrence || null,
            location: location || null,
          },
        })

        return blockedDayNoOpeningReply({
          conflict: representativeConflict,
          pendingInvite: Boolean(pendingInviteConflict),
          options: bookAnywayOptions,
          attendees,
          unresolvedInvitees,
        })
      }
    }
  }

  if (conflictReply) return conflictReply

  return genericNoOpeningReply({
    calendarLabel,
    dateLabel: dateWindow?.label || null,
  })
}

function requestedExactScheduleOption({
  title,
  baseDate,
  exactTime,
  durationMinutes,
  chosenCalendar,
  timeZone,
  location,
}: {
  title: string
  baseDate: Date
  exactTime: { hour: number; minute: number }
  durationMinutes: number
  chosenCalendar: CalendarPlacementOption
  timeZone: string
  location?: string | null
}) {
  const requestedStart = setTime(baseDate, exactTime, timeZone)
  const requestedEnd = addMinutes(requestedStart, durationMinutes)

  return {
    option: {
      title,
      start: requestedStart.toISOString(),
      end: requestedEnd.toISOString(),
      provider: chosenCalendar.provider,
      calendarId: chosenCalendar.calendarId,
      calendarName: chosenCalendar.calendarLabel,
      dayLabel: formatSmsDate(requestedStart, timeZone),
      timeLabel: formatSmsTime(requestedStart, timeZone),
      timeZone,
      recurrence: null,
      location,
    } satisfies ScheduleOption,
    requestedStart,
    requestedEnd,
  }
}

async function maybeConfirmExactScheduleTime({
  profile,
  smsFrom,
  title,
  baseDate,
  exactTime,
  durationMinutes,
  chosenCalendar,
  calendarHint,
  recurrence,
  location,
  attendees,
  unresolvedInvitees,
}: {
  profile: SmsProfile
  smsFrom: string
  title: string
  baseDate: Date
  exactTime: { hour: number; minute: number } | null
  durationMinutes: number
  chosenCalendar: CalendarPlacementOption
  calendarHint?: string
  recurrence?: RecurrenceSpec | null
  location?: string | null
  attendees: Invitee[]
  unresolvedInvitees: string[]
}) {
  if (!exactTime || recurrence) return null

  const { option: requestedOption, requestedStart, requestedEnd } = requestedExactScheduleOption({
    title,
    baseDate,
    exactTime,
    durationMinutes,
    chosenCalendar,
    timeZone: profile.timezone,
    location,
  })

  const overlappingEvents = (await listUpcomingEvents({
    profileId: profile.id,
    startAt: requestedStart,
    windowMinutes: durationMinutes,
    maxResults: 12,
    timeZone: profile.timezone,
  })).filter((event) => overlapsOption(event, requestedStart, requestedEnd))

  const pendingInviteConflict = overlappingEvents.find((event) =>
    isPendingInviteConflict(event, profile.email),
  )
  const hardConflict = overlappingEvents.find(
    (event) => !isPendingInviteConflict(event, profile.email),
  )

  if (hardConflict) {
    const alternatives = await findScheduleOptions({
      profileId: profile.id,
      title,
      baseDate,
      exactTime,
      calendarId: chosenCalendar.calendarId,
      calendarHint: chosenCalendar.calendarLabel || calendarHint,
      durationMinutes,
      recurrence,
      location,
    })

    const options = [requestedOption, ...alternatives].slice(0, 3)

    await storeScheduleOptionsPending({
      profileId: profile.id,
      smsFrom,
      options,
      attendees,
      unresolvedInvitees,
      scheduleRequest: {
        title,
        baseDate: baseDate.toISOString(),
        exactTime,
        durationMinutes,
        recurrence: recurrence || null,
        location: location || null,
      },
    })

    return hardConflictScheduleReply({
      conflict: hardConflict,
      requestedOption,
      alternatives: alternatives.slice(0, 2),
    })
  }

  if (pendingInviteConflict && !hardConflict) {
    const alternatives = await findScheduleOptions({
      profileId: profile.id,
      title,
      baseDate,
      exactTime,
      calendarId: chosenCalendar.calendarId,
      calendarHint: chosenCalendar.calendarLabel || calendarHint,
      durationMinutes,
      recurrence,
      location,
    })

    const options = [requestedOption, ...alternatives].slice(0, 3)

    await storeScheduleOptionsPending({
      profileId: profile.id,
      smsFrom,
      options,
      attendees,
      unresolvedInvitees,
      scheduleRequest: {
        title,
        baseDate: baseDate.toISOString(),
        exactTime,
        durationMinutes,
        recurrence: recurrence || null,
        location: location || null,
      },
    })

    return pendingInviteScheduleReply({
      conflict: pendingInviteConflict,
      requestedOption,
      alternatives: alternatives.slice(0, 2),
    })
  }

  if (hardConflict) return null

  await storeScheduleOptionsPending({
    profileId: profile.id,
    smsFrom,
    options: [requestedOption],
    attendees,
    unresolvedInvitees,
    scheduleRequest: {
      title,
      baseDate: baseDate.toISOString(),
      exactTime,
      durationMinutes,
      recurrence: recurrence || null,
      location: location || null,
    },
  })

  return exactAvailabilityReply({
    option: requestedOption,
    attendees,
    unresolvedInvitees,
  })
}

function sortAgendaEvents(events: EventSummary[]) {
  return [...events].sort((left, right) => {
    const leftTime = new Date(left.start).getTime()
    const rightTime = new Date(right.start).getTime()

    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0
    if (Number.isNaN(leftTime)) return 1
    if (Number.isNaN(rightTime)) return -1
    return leftTime - rightTime
  })
}

function agendaText(day: 'today' | 'tomorrow', events: EventSummary[]) {
  if (!events.length) {
    return day === 'tomorrow'
      ? "Tomorrow's schedule is clear."
      : "You're clear today."
  }

  const heading = day === 'tomorrow' ? "Tomorrow's schedule:" : 'Today:'
  return `${heading}\n${sortAgendaEvents(events)
    .map((event) => `${event.timeLabel} ${event.title} (${event.calendarName})`)
    .join('\n')}`
}

function agendaWindowText(label: string, events: EventSummary[], timeZone?: string) {
  if (!events.length) return `Nothing on your calendar for ${label}.`
  return `${label[0]?.toUpperCase() || ''}${label.slice(1)}:\n${sortAgendaEvents(events)
    .map((event) => `${eventDateLabel(event, timeZone)} ${event.title} (${event.calendarName})`)
    .join('\n')}`
}

function eventLookupText(
  query: string,
  matches: EventSummary[],
  timeZone?: string,
  mode: 'when' | 'where' | 'time' = 'when',
) {
  const cleanedQuery = query.trim()
  if (!matches.length) {
    return `I couldn't find ${cleanedQuery || 'that'} on your upcoming calendar. Try the event name plus a day or time.`
  }

  const topMatches = sortAgendaEvents(matches).slice(0, 3)
  if (topMatches.length === 1) {
    const event = topMatches[0]
    if (mode === 'where') {
      return event.location
        ? `${event.title} is at ${event.location} on ${eventDateLabel(event, timeZone)}.`
        : `${event.title} is ${eventDateLabel(event, timeZone)} on ${event.calendarName}. I don't have a location saved for it.`
    }
    return `${event.title} is ${eventDateLabel(event, timeZone)} on ${event.calendarName}.`
  }

  return `I found a few matches:\n${topMatches
    .map((event, index) => `${index + 1}. ${eventDateLabel(event, timeZone)} ${event.title} (${event.calendarName})`)
    .join('\n')}\nText more of the title, or add the month or day to narrow it down.`
}

function windowMinutes(window: DateWindow) {
  return Math.max(1, Math.ceil((window.end.getTime() - window.start.getTime()) / 60_000))
}

function choose<T>(items: T[] | undefined, choice: number) {
  return items?.[choice - 1] || null
}

function resolveCalendarChoiceFromText(
  text: string,
  calendars: CalendarPlacementOption[] | undefined,
  visibleCount?: number,
) {
  if (!calendars?.length) return null

  const lower = text.trim().toLowerCase()
  const directNumber = lower.match(/^(?:option\s*)?(\d+)$/)
  if (directNumber) {
    if (visibleCount && Number(directNumber[1]) > visibleCount) return null
    const picked = calendars[Number(directNumber[1]) - 1]
    if (picked) return picked
  }

  const normalized = tokenizeText(lower).join(' ')
  if (!normalized) return null

  const exact =
    calendars.find((calendar) => tokenizeText(calendarChoiceDisplayLabel(calendar, calendars)).join(' ') === normalized) ||
    calendars.find((calendar) => tokenizeText(calendar.calendarLabel).join(' ') === normalized) ||
    calendars.find((calendar) => tokenizeText(calendar.calendarName).join(' ') === normalized)
  if (exact) return exact

  const words = tokenizeText(lower)
  return (
    calendars.find((calendar) => {
      const label = tokenizeText(calendar.calendarLabel)
      const source = tokenizeText(calendar.calendarName)
      const display = tokenizeText(calendarChoiceDisplayLabel(calendar, calendars))
      return words.every((word) => label.includes(word) || source.includes(word) || display.includes(word))
    }) || null
  )
}

function isShortAcknowledgement(text: string) {
  const lower = text.trim().toLowerCase()
  return (
    lower.split(/\s+/).length <= 4 &&
    /\b(ok|okay|got it|sounds good|cool|thanks|thank you|perfect|nice)\b/.test(lower)
  )
}

function isSingleScheduleDecline(text: string) {
  return /^(?:no|nope|nah|n|cancel|leave it|do not|don't|dont|not now|never mind|nevermind)[.!]*$/i.test(
    text.trim(),
  )
}

function isCancelPendingRequest(text: string) {
  return /^(?:actually\s+)?(?:cancel that|cancel it|cancel this|never mind|nevermind|scratch that|forget it|drop that|stop that|leave it)[.!]*$/i.test(
    text.trim(),
  )
}

function isPendingEscapeRequest(text: string) {
  return /^(?:start over|start fresh|reset|oops|never mind|nevermind|nvm|forget it|forget that|scratch that|drop it|drop that|leave it)[.!]*$/i.test(
    text.trim(),
  )
}

function pendingScheduleContext(pending: PendingAction, defaultDurationMinutes: number) {
  const request = pending.payload.scheduleRequest
  if (request) {
    return {
      title: request.title,
      exactTime: request.exactTime,
      durationMinutes: request.durationMinutes,
      recurrence: request.recurrence,
      location: request.location || null,
      calendarHint: '',
    }
  }

  const option = pending.payload.options?.[0]
  if (!option) return null

  const start = new Date(option.start).getTime()
  const end = new Date(option.end).getTime()
  return {
    title: option.title.replace(/\s*\(pending\)\s*$/i, ''),
    exactTime: null,
    durationMinutes:
      Number.isFinite(start) && Number.isFinite(end) && end > start
        ? Math.max(15, Math.round((end - start) / 60_000))
        : defaultDurationMinutes,
    recurrence: option.recurrence || null,
    location: option.location || null,
    calendarHint: option.calendarName,
  }
}

function correctionFragment(text: string) {
  const trimmed = text.trim()
  const patterns = [
    /^(?:actually\s+)?(?:i\s+)?(?:meant|mean)\s+(.+)$/i,
    /^(?:actually\s+)?(?:make it|change it to|move it to|do)\s+(.+)$/i,
    /^(?:never mind|nevermind|scratch that|forget that),?\s+(?:schedule|book|add|make it|do it|try|for)?\s*(.+)$/i,
    /^actually\s+(?!cancel\b)(.+)$/i,
  ]

  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    if (match?.[1]?.trim()) return match[1].trim()
  }

  return null
}

function timeForCorrectionText(exactTime: { hour: number; minute: number }) {
  const period = exactTime.hour >= 12 ? 'pm' : 'am'
  const hour = exactTime.hour % 12 || 12
  const minute = exactTime.minute ? `:${String(exactTime.minute).padStart(2, '0')}` : ''
  return `${hour}${minute}${period}`
}

function correctedScheduleIntentFromPending(
  text: string,
  pending: PendingAction,
  defaultDurationMinutes: number,
  timeZone?: string,
) {
  if (
    ![
      'schedule',
      'choose_calendar',
      'external_call_prep',
    ].includes(pending.kind)
  ) {
    return null
  }

  const fragment = correctionFragment(text)
  if (!fragment) return null

  const context = pendingScheduleContext(pending, defaultDurationMinutes)
  if (!context) return null

  let cleanedFragment = fragment
    .replace(/^(?:schedule|book|add|set up)\s+/i, '')
    .replace(/^(?:it|that)\s+/i, '')
    .trim()

  if (!cleanedFragment) return null

  if (context.exactTime && !parseSmsTime(cleanedFragment)) {
    cleanedFragment += ` at ${timeForCorrectionText(context.exactTime)}`
  }

  if (context.calendarHint && !/\bcalendar\b/i.test(cleanedFragment)) {
    cleanedFragment += ` on ${context.calendarHint} calendar`
  }

  const correctedText = `schedule ${context.title} ${cleanedFragment}`
  const intent = parseSmsIntent(correctedText, timeZone)
  return intent.type === 'schedule' ? { text: correctedText, intent } : null
}

function reminderForPending(pending: PendingAction) {
  switch (pending.kind) {
    case 'schedule':
      if ((pending.payload.options || []).length === 1) {
        return 'Reply YES to book it, or NO to leave it.'
      }
      return 'Reply with the option you want, like 1, 2, or 3.'
    case 'invited_reschedule_hold':
    case 'external_call_prep':
      return 'Reply with the option you want, like 1, 2, or 3.'
    case 'choose_calendar':
      return 'Reply with the calendar name or number you want.'
    case 'reschedule':
      if (pending.payload.stage === 'scope') {
        return actionChoiceList([
          'Reply with:',
          '1. Just this one',
          '2. The whole series',
          '3. Keep it',
        ])
      }
      return 'Reply with the option you want, like 1, 2, or 3.'
    case 'select_reschedule_target':
      return 'Reply with which one you mean, like 1, 2, or 3.'
    case 'select_cancel_target':
      if (pending.payload.recentlyCreated) {
        return 'You are set. Say "cancel that" if you want me to remove the event I just booked.'
      }
      return 'Reply with which one to cancel, like 1, 2, or 3.'
    case 'invited_reschedule_action':
      return actionChoiceList([
        'Reply with:',
        '1. Hold a time on my calendar',
        '2. Draft a note to the organizer',
        '3. Keep it',
      ])
    case 'invited_cancel_action':
      if (pending.payload.stage === 'scope') {
        if (!canCancelDirectly(pending.payload.authority)) {
          return actionChoiceList([
            'Reply with:',
            '1. Remove just this one',
            '2. Remove the whole series from my calendar',
            '3. Keep it',
          ])
        }

        return actionChoiceList([
          'Reply with:',
          '1. Just this one',
          '2. The whole series',
          '3. Keep it',
        ])
      }
      return actionChoiceList([
        'Reply with:',
        '1. Remove it from my calendar',
        '2. Draft a message',
        '3. Keep it',
      ])
    case 'resolve_invitees':
      return 'Reply with the missing email, like "Priya priya@company.com", or say "book it without invites."'
    case 'save_business_contact_phone':
      return "Reply with the office number, or say SKIP if you don't want to save it yet."
    default:
      return 'Tell me what you want to do next.'
  }
}

function isInviteeResolutionAbort(text: string) {
  return /^(?:skip|cancel|never mind|nevermind|no invite|no invites)[.!]*$/i.test(text.trim())
}

function resolveInviteesPendingHasContext(pending: PendingAction) {
  return Boolean(
    pending.payload.selectedOption ||
      pending.payload.target ||
      (pending.payload.events && pending.payload.events.length > 0),
  )
}

function shouldClearResolveInviteesPendingForNewRequest(
  text: string,
  pending: PendingAction,
  timeZone?: string,
) {
  if (!resolveInviteesPendingHasContext(pending)) return true
  if (isInviteeResolutionAbort(text)) return false

  const intent = parseSmsIntent(text, timeZone)
  if (intent.type === 'choice' && pending.payload.events?.length) return false

  const unresolvedNames = pending.payload.unresolvedInvitees || []
  if (resolveInviteeFollowUp(text, unresolvedNames).resolved.length) return false

  return ['agenda', 'schedule', 'reschedule', 'cancel', 'lookup'].includes(intent.type)
}

function shouldClearRecentCreatedPendingForIntent(
  text: string,
  intent: ParsedSmsIntent,
) {
  if (isCancelPendingRequest(text)) return false

  if (intent.type === 'unknown' || intent.type === 'choice') return false

  if (intent.type === 'cancel' || intent.type === 'reschedule') {
    return !isGenericEventReference(intent.query)
  }

  return true
}

function eventDateLabel(event: EventSummary, timeZone?: string) {
  const start = new Date(event.start)
  if (Number.isNaN(start.getTime())) return event.timeLabel
  return `${formatSmsDate(start, timeZone)} at ${formatSmsTime(start, timeZone)}`
}

function eventDurationMinutes(event: EventSummary) {
  const start = new Date(event.start).getTime()
  const end = new Date(event.end).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 30
  return Math.max(15, Math.round((end - start) / 60_000))
}

function isRecurringEvent(event: EventSummary) {
  if (event.provider === 'apple') {
    return Boolean(event.recurrence?.length || event.originalStart)
  }

  return Boolean(event.recurringEventId || event.recurrence?.length)
}

async function loadSeriesMaster(profileId: string, target: EventSummary, timeZone?: string) {
  const seriesId = target.recurringEventId || target.id
  const seriesTarget = await getCalendarEvent(profileId, seriesId, target.calendarId, timeZone)
  if (!seriesTarget) return null

  return {
    seriesTarget,
    recurrence: parseGoogleRecurrence(seriesTarget.recurrence),
  }
}

function recurringReschedulePrompt(target: EventSummary) {
  return `${target.title} is part of a repeating series.\nDo you want me to:\n1. Move just this one\n2. Move the whole series\n3. Keep it as is`
}

function canCancelForEveryone(authority: EventAuthority | null | undefined) {
  return authority === 'owned_meeting'
}

function canCancelDirectly(authority: EventAuthority | null | undefined) {
  return authority === 'owned_meeting' || authority === 'personal'
}

function removedFromCalendarText(
  target: EventSummary,
  authority: EventAuthority | null | undefined,
  timeZone?: string,
) {
  const dateText = eventDateLabel(target, timeZone)

  if (authority === 'external_appointment') {
    return `Removed ${target.title} from your calendar on ${dateText}. I did not cancel it with the business.`
  }

  if (authority === 'invited_meeting') {
    return `Removed ${target.title} from your calendar on ${dateText}. I can't cancel it for everyone because you're not the organizer.`
  }

  return `Removed ${target.title} from your calendar on ${dateText}. I can't confirm it was canceled for anyone else.`
}

function removedRecurringText(
  target: EventSummary,
  authority: EventAuthority | null | undefined,
  scope: 'occurrence' | 'series',
) {
  const scopeText = scope === 'series' ? `the whole ${target.title} series` : `this ${target.title} occurrence`

  if (authority === 'external_appointment') {
    return `Removed ${scopeText} from your calendar. I did not cancel it with the business.`
  }

  if (authority === 'invited_meeting') {
    const extra =
      scope === 'series'
        ? "I can't cancel it for everyone because you're not the organizer."
        : "The organizer's series may still exist."
    return `Removed ${scopeText} from your calendar. ${extra}`
  }

  return `Removed ${scopeText} from your calendar. I can't confirm it was canceled for anyone else.`
}

function recurringCancelPrompt(target: EventSummary, authority: EventAuthority | null | undefined) {
  if (canCancelDirectly(authority)) {
    return `${target.title} is part of a repeating series.\nDo you want me to:\n1. Cancel just this one\n2. Cancel the whole series\n3. Keep it`
  }

  const note =
    authority === 'external_appointment'
      ? 'I can remove it from your calendar, but I cannot cancel it with the business.'
      : 'This looks like an invite, so I can only remove it from your calendar.'

  return `${target.title} is part of a repeating series.\n${note}\nDo you want me to:\n1. Remove just this one\n2. Remove the whole series from your calendar\n3. Keep it`
}

function buildCallNote(target: EventSummary, options: ScheduleOption[], timeZone?: string) {
  const bestTimes = options.map((option) => `${option.dayLabel} ${option.timeLabel}`).join(', ')
  return `Need to move ${target.title} from ${eventDateLabel(target, timeZone)}. Best times: ${bestTimes}.`
}

function buildNewAppointmentCallNote(title: string, options: ScheduleOption[]) {
  const bestTimes = options.map((option) => `${option.dayLabel} ${option.timeLabel}`).join(', ')
  return `Need to book ${title}. Best times: ${bestTimes}.`
}

function buildCancelNote(target: EventSummary, timeZone?: string) {
  return `Need to cancel ${target.title} scheduled for ${eventDateLabel(target, timeZone)}.`
}

function looksExternalScheduleRequest(title: string) {
  return looksExternalAppointment({
    id: '',
    title,
    start: '',
    end: '',
    provider: 'google',
    calendarId: '',
    calendarName: '',
    timeLabel: '',
    location: '',
    description: '',
    organizerEmail: '',
    attendeeCount: 0,
  } as EventSummary)
}

function userAlreadyConfirmedServiceBooking(text: string) {
  return /\b(already|office|they|dentist|doctor|barber|salon|vet|mechanic)\s+(booked|scheduled|confirmed|gave me)\b|\b(booked|scheduled|confirmed)\s+(it|with them|with the office)\b/i.test(
    text,
  )
}

function externalAvailabilityWeekdays(title: string) {
  const lower = title.toLowerCase()
  if (/\b(haircut|barber|salon)\b|\bhair\s+cut\b|\bhair appointment\b/.test(lower)) {
    return new Set([1, 2, 3, 4, 5, 6])
  }

  return new Set([1, 2, 3, 4, 5])
}

function sortScheduleOptions(options: ScheduleOption[]) {
  return [...options].sort((left, right) => {
    return new Date(left.start).getTime() - new Date(right.start).getTime()
  })
}

function serializeDateWindow(window: DateWindow | null | undefined) {
  return window
    ? {
        start: window.start.toISOString(),
        end: window.end.toISOString(),
        label: window.label,
      }
    : null
}

function deserializeDateWindow(window: SerializedDateWindow | null | undefined): DateWindow | null {
  if (!window) return null
  return {
    start: new Date(window.start),
    end: new Date(window.end),
    label: window.label,
  }
}

function isWithinWindow(option: ScheduleOption, window: DateWindow | null | undefined) {
  if (!window) return true
  const start = new Date(option.start)
  return start >= window.start && start <= window.end
}

function daysToSearch(baseDate: Date, window: DateWindow | null | undefined, timeZone?: string) {
  if (!window) return 1
  let days = 1
  let cursor = baseDate
  while (cursor < window.end && days < 45) {
    cursor = addDays(cursor, 1, timeZone)
    days += 1
  }
  return days
}

async function findScheduleOptionsAcrossWindow({
  profileId,
  title,
  baseDate,
  exactTime,
  calendarId,
  calendarHint,
  durationMinutes,
  recurrence,
  location,
  dateWindow,
  timeZone,
}: {
  profileId: string
  title: string
  baseDate: Date
  exactTime?: { hour: number; minute: number } | null
  calendarId?: string
  calendarHint?: string
  durationMinutes: number
  recurrence?: RecurrenceSpec | null
  location?: string | null
  dateWindow?: DateWindow | null
  timeZone?: string
}) {
  const collected: ScheduleOption[] = []
  const totalDays = daysToSearch(baseDate, dateWindow, timeZone)

  for (let offset = 0; offset < totalDays && collected.length < 3; offset += 1) {
    const candidateBaseDate = addDays(baseDate, offset, timeZone)
    const dayOptions = await findScheduleOptions({
      profileId,
      title,
      baseDate: candidateBaseDate,
      exactTime,
      calendarId,
      calendarHint,
      durationMinutes,
      recurrence,
      location,
      timeZone,
    })

    for (const option of sortScheduleOptions(dayOptions)) {
      if (isWithinWindow(option, dateWindow)) {
        collected.push(option)
      }
      if (collected.length >= 3) break
    }
  }

  return sortScheduleOptions(collected).slice(0, 3)
}

async function findExternalCallPrepOptions({
  profileId,
  optionTitle,
  availabilityTitle,
  baseDate,
  exactTime,
  calendarId,
  calendarHint,
  dateWindow,
  timeZone,
}: {
  profileId: string
  optionTitle: string
  availabilityTitle: string
  baseDate: Date
  exactTime: { hour: number; minute: number } | null
  calendarId?: string
  calendarHint?: string
  dateWindow?: DateWindow | null
  timeZone?: string
}) {
  const allowedWeekdays = externalAvailabilityWeekdays(availabilityTitle)
  const collected: ScheduleOption[] = []
  const totalDays = dateWindow ? daysToSearch(baseDate, dateWindow, timeZone) : 14

  for (let offset = 0; offset < totalDays && collected.length < 3; offset += 1) {
    const candidateBaseDate = addDays(baseDate, offset, timeZone)

    if (!allowedWeekdays.has(dateTimePartsInTimeZone(candidateBaseDate, timeZone).weekday)) {
      continue
    }

    const dayOptions = await findScheduleOptions({
      profileId,
      title: optionTitle,
      baseDate: candidateBaseDate,
      exactTime,
      calendarId,
      calendarHint,
      durationMinutes: 20,
      timeZone,
    })

    const allowedOptions = sortScheduleOptions(dayOptions).filter(
      (option) =>
        allowedWeekdays.has(dateTimePartsInTimeZone(option.start, timeZone).weekday) &&
        isWithinWindow(option, dateWindow),
    )
    for (const option of allowedOptions) {
      collected.push(option)
      if (collected.length >= 3) break
    }
  }

  return sortScheduleOptions(collected).slice(0, 3)
}

function tokenizeText(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function referencesExternalTarget(
  text: string,
  target?: EventSummary | null,
  businessName?: string | null,
) {
  const lower = text.trim().toLowerCase()
  if (/\b(it|that|appointment|visit|booking)\b/.test(lower)) return true

  const targetTokens = [target?.title, businessName, target?.location]
    .flatMap((value) => tokenizeText(value || ''))
    .filter((token) => token.length > 2)

  return targetTokens.some((token) => lower.includes(token))
}

function confirmsExternalCancellation(
  text: string,
  target?: EventSummary | null,
  businessName?: string | null,
) {
  const lower = text.trim().toLowerCase()
  const referencesTarget = referencesExternalTarget(lower, target, businessName)
  return (
    referencesTarget &&
    /\b(i|we|they)\b/.test(lower) &&
    /\b(called|call|confirmed|finished|done|all set)\b/.test(lower) &&
    /\b(cancel|canceled|cancelled)\b/.test(lower)
  ) ||
    (referencesTarget && /\b(cancel|canceled|cancelled)\s+(it|that|the appointment)?\b/.test(lower)) ||
    (referencesTarget && /\b(it'?s|its)\s+canceled\b/.test(lower))
}

function mentionsOfficeDelay(
  text: string,
  target?: EventSummary | null,
  businessName?: string | null,
) {
  const lower = text.trim().toLowerCase()
  return (
    referencesExternalTarget(lower, target, businessName) &&
    /\b(voicemail|message|no answer|didn'?t answer|didnt answer|couldn'?t reach|couldnt reach|waiting to hear back|call me back|hear back)\b/.test(lower)
  )
}

function mentionsFailedExternalReschedule(
  text: string,
  target?: EventSummary | null,
  businessName?: string | null,
) {
  const lower = text.trim().toLowerCase()
  return (
    referencesExternalTarget(lower, target, businessName) &&
    /\b(couldn'?t do|couldnt do|no openings|no availability|nothing available|didn'?t work|didnt work|not available)\b/.test(lower)
  )
}

function parseExternalFollowUpDate(text: string, timeZone?: string) {
  const lower = text.toLowerCase()
  if (/\btoday\b/.test(lower)) return startOfDay(0, timeZone)
  if (/\btomorrow'?s?\b|\btmrw\b|\btomororws?\b/.test(lower)) return startOfDay(1, timeZone)

  const dayMatch = lower.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)
  if (!dayMatch) return null
  return nextDateForWeekday(weekdayNumbers[dayMatch[1]], timeZone)
}

function parseExternalRescheduleConfirmation(
  text: string,
  target?: EventSummary | null,
  businessName?: string | null,
  timeZone?: string,
) {
  const lower = text.trim().toLowerCase()
  const referencesTarget = referencesExternalTarget(lower, target, businessName)
  const exactTime = parseSmsTime(text)
  const explicitDate = parseExternalFollowUpDate(text, timeZone)
  const mentionsReschedule =
    /\b(reschedule|rescheduled|move|moved|change|changed|rebooked|booked)\b/.test(lower) ||
    /\bthey can do\b/.test(lower) ||
    /\bit is now\b/.test(lower) ||
    /\bnew time\b/.test(lower)
  const hasCallContext = /\b(called|office|they|confirmed)\b/.test(lower)

  if (!referencesTarget || (!mentionsReschedule && !(hasCallContext && exactTime && explicitDate))) {
    return { kind: 'none' as const }
  }

  if (!exactTime || !explicitDate) {
    return { kind: 'needs_details' as const }
  }

  return {
    kind: 'confirmed_reschedule' as const,
    baseDate: explicitDate,
    exactTime,
  }
}

function isBareExternalAppointmentConfirmation(text: string) {
  return /^(?:yes,?\s*)?(?:confirmed|confirm|booked|done|all set|it'?s booked|its booked|it'?s confirmed|its confirmed|they confirmed|office confirmed)[.!]*$/i.test(
    text.trim(),
  )
}

function optionFromExactExternalTime(
  target: EventSummary,
  baseDate: Date,
  exactTime: { hour: number; minute: number },
  timeZone?: string,
): ScheduleOption {
  const start = setTime(baseDate, exactTime, timeZone)
  const end = addMinutes(start, eventDurationMinutes(target))
  return {
    title: target.title,
    start: start.toISOString(),
    end: end.toISOString(),
    provider: target.provider,
    calendarId: target.calendarId,
    calendarName: target.calendarName,
    dayLabel: formatSmsDate(start, timeZone),
    timeLabel: formatSmsTime(start, timeZone),
    timeZone,
    ownerEmail: target.ownerEmail || target.organizerEmail || null,
  }
}

function optionFromHeldExternalAppointment(target: EventSummary, timeZone?: string): ScheduleOption {
  const start = new Date(target.start)
  return {
    title: target.title,
    start: target.start,
    end: target.end,
    provider: target.provider,
    calendarId: target.calendarId,
    calendarName: target.calendarName,
    dayLabel: formatSmsDate(start, timeZone),
    timeLabel: formatSmsTime(start, timeZone),
    timeZone,
    location: target.location || null,
  }
}

function buildOrganizerRescheduleDraft(target: EventSummary, options: ScheduleOption[]) {
  const bestTimes = options.map((option) => `${option.dayLabel} ${option.timeLabel}`).join(', ')
  return `Draft: Hi, I need to move ${target.title}. I can do ${bestTimes}. Let me know what works.`
}

function buildOrganizerCancelDraft(target: EventSummary, timeZone?: string) {
  return `Draft: Hi, I need to decline ${target.title} scheduled for ${eventDateLabel(target, timeZone)}.`
}

const queryNoiseWords = new Set([
  'the',
  'it',
  'that',
  'this',
  'my',
  'one',
  'thing',
  'stuff',
  'event',
  'appointment',
  'meeting',
  'calendar',
  'schedule',
  'time',
  'today',
  'tomorrow',
  'tmrw',
  'upcoming',
  'next',
  'week',
  'month',
])

function queryWords(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((word) => word.length > 1)
    .filter((word) => !queryNoiseWords.has(word))
}

function queryWordVariants(word: string) {
  const variants = [word]
  if (word.endsWith('s') && word.length > 3) variants.push(word.slice(0, -1))
  if (word.endsWith('ies') && word.length > 4) variants.push(`${word.slice(0, -3)}y`)
  return variants
}

function normalizeSearchText(value: string) {
  return tokenizeText(value).join(' ')
}

function containsVariant(text: string, word: string) {
  return queryWordVariants(word).some((variant) => text.includes(variant))
}

function eventMatchScore(event: EventSummary, words: string[], normalizedQuery?: string) {
  if (!words.length) return 0

  const normalizedTitle = normalizeSearchText(event.title)
  const normalizedLocation = normalizeSearchText(event.location)
  const normalizedDescription = normalizeSearchText(event.description)

  let score = 0

  if (normalizedQuery) {
    if (normalizedTitle === normalizedQuery) score += 1000
    else if (normalizedTitle.includes(normalizedQuery)) score += 250

    if (normalizedLocation === normalizedQuery) score += 120
    else if (normalizedLocation.includes(normalizedQuery)) score += 40

    if (normalizedDescription.includes(normalizedQuery)) score += 20
  }

  for (const word of words) {
    if (containsVariant(normalizedTitle, word)) score += 8
    else if (containsVariant(normalizedLocation, word)) score += 3
    else if (containsVariant(normalizedDescription, word)) score += 2
  }

  return score
}

function sortEventsByStart<T extends { start: string }>(events: T[]) {
  return [...events].sort((left, right) => {
    return new Date(left.start).getTime() - new Date(right.start).getTime()
  })
}

function uniqueEvents(events: EventSummary[]) {
  const seen = new Set<string>()
  return events.filter((event) => {
    const key = `${event.id}:${event.start}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function matchingEventsByQuery(events: EventSummary[], query: string) {
  const words = queryWords(query)
  if (!words.length) return []
  const normalizedQuery = normalizeSearchText(query)

  const scored = events
    .map((event) => ({
      event,
      score: eventMatchScore(event, words, normalizedQuery),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      return new Date(left.event.start).getTime() - new Date(right.event.start).getTime()
    })

  return scored.map((item) => item.event)
}

function bestEventByQuery(events: EventSummary[], query: string) {
  const matches = matchingEventsByQuery(events, query)
  if (!matches.length) return null
  if (matches.length === 1) return matches[0]

  const words = queryWords(query)
  const normalizedQuery = normalizeSearchText(query)
  const topScore = eventMatchScore(matches[0], words, normalizedQuery)
  const topMatches = matches.filter((event) => eventMatchScore(event, words, normalizedQuery) === topScore)
  return topMatches.length === 1 ? topMatches[0] : null
}

function inviteeSummary(invitees: Invitee[]) {
  return invitees.map((invitee) => inviteeLabel(invitee)).join(', ')
}

function unresolvedInviteeSummary(names: string[]) {
  return names.join(', ')
}

async function resolveScheduleInvitees(profileId: string, body: string) {
  const parsed = parseInviteesFromText(body)
  const resolvedInvitees = [...parsed.directInvitees]
  const unresolvedNames: string[] = []

  for (const name of parsed.names) {
    const match = await findPersonContact(profileId, name)
    if (match) {
      resolvedInvitees.push({
        email: match.email,
        displayName: match.label,
      })
    } else {
      unresolvedNames.push(name)
    }
  }

  const dedupedInvitees = resolvedInvitees.filter((invitee, index, list) => {
    return list.findIndex((item) => item.email.toLowerCase() === invitee.email.toLowerCase()) === index
  })

  return {
    cleanedText: parsed.cleanedText,
    invitees: dedupedInvitees,
    unresolvedNames,
  }
}

async function saveInviteeContacts(profileId: string, invitees: Invitee[]) {
  for (const invitee of invitees) {
    if (!invitee.displayName) continue
    await saveOrUpdatePersonContact({
      profileId,
      label: invitee.displayName,
      email: invitee.email,
      aliases: buildPersonAliases([invitee.displayName, invitee.email]),
    })
  }
}

async function resolveExistingEventInvitees(profileId: string, request: ExistingEventInviteRequest) {
  const resolvedInvitees = [...request.directInvitees]
  const unresolvedNames: string[] = []

  for (const name of request.names) {
    const match = await findPersonContact(profileId, name)
    if (match) {
      resolvedInvitees.push({
        email: match.email,
        displayName: match.label,
      })
    } else {
      unresolvedNames.push(name)
    }
  }

  const dedupedInvitees = resolvedInvitees.filter((invitee, index, list) => {
    return list.findIndex((item) => item.email.toLowerCase() === invitee.email.toLowerCase()) === index
  })

  return {
    eventQuery: request.eventQuery,
    invitees: dedupedInvitees,
    unresolvedNames,
  }
}

function inviteTargetChoiceList(events: EventSummary[], timeZone: string) {
  return events
    .map((event, index) => `${index + 1}. ${eventDateLabel(event, timeZone)} ${event.title} (${event.calendarName})`)
    .join('\n')
}

async function inviteExistingEventTarget({
  profile,
  target,
  attendees,
  unresolvedInvitees,
}: {
  profile: SmsProfile
  target: EventSummary
  attendees: Invitee[]
  unresolvedInvitees: string[]
}) {
  await saveInviteeContacts(profile.id, attendees)

  if (!providerCanSendInvites(target.provider)) {
    return `${calendarProviderName(target.provider)} Calendar does not send invite emails through Manoa yet, so I cannot add invitees to ${target.title}. If you schedule it on Google, I can send the invite.`
  }

  if (unresolvedInvitees.length) {
    return `I can invite ${attendees.length ? `${inviteeSummary(attendees)}, but I still` : 'them, but I'} need email${
      unresolvedInvitees.length > 1 ? 's' : ''
    } for ${unresolvedInviteeSummary(unresolvedInvitees)}.\nReply like "Sam sam@company.com" or say "skip."`
  }

  if (!attendees.length) {
    return `Who should I invite to ${target.title}? Reply with a name and email, like "Sam sam@company.com."`
  }

  try {
    await addInviteesToCalendarEvent(profile.id, target, attendees)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/403|forbidden|read.?only|not allowed|permission/i.test(message)) {
      return `I found ${target.title}, but ${target.calendarName} will not let Manoa add invitees to it.`
    }

    throw error
  }

  return `I invited ${inviteeSummary(attendees)} to ${target.title} on ${eventDateLabel(
    target,
    profile.timezone,
  )}.`
}

function findEventByQuery(events: EventSummary[], query: string) {
  return bestEventByQuery(events, query)
}

function isGenericEventReference(query: string) {
  const normalized = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return (
    !queryWords(query).length ||
    /^(?:it|that|this|event|calendar event|that event|this event|the event|my event|time)$/.test(
      normalized,
    )
  )
}

function recentEventFromPending(pending: PendingAction | null | undefined) {
  if (pending?.kind !== 'select_cancel_target' || !pending.payload.recentlyCreated) return null
  return pending.payload.events?.[0] || null
}

function eventContextFromPending(pending: PendingAction | null | undefined) {
  if (!pending) return null

  if (pending.kind === 'reschedule') {
    return pending.payload.target || null
  }

  if (
    pending.kind === 'invited_reschedule_action' ||
    pending.kind === 'invited_reschedule_hold' ||
    pending.kind === 'invited_cancel_action' ||
    pending.kind === 'external_call_prep' ||
    pending.kind === 'external_cancel_confirm' ||
    pending.kind === 'external_reschedule_confirm' ||
    pending.kind === 'save_business_contact_phone'
  ) {
    return pending.payload.target || null
  }

  if (pending.kind === 'select_reschedule_target') {
    return pending.payload.events?.length === 1 ? pending.payload.events[0] : null
  }

  return recentEventFromPending(pending)
}

function contextualEventTarget(pending: PendingAction | null | undefined, query: string) {
  if (!isGenericEventReference(query)) return null
  return eventContextFromPending(pending)
}

function rescheduleBaseDateForTarget({
  requestedBaseDate,
  explicitDateRequested,
  exactTime,
  target,
  timeZone,
}: {
  requestedBaseDate?: Date | string | null
  explicitDateRequested?: boolean
  exactTime?: { hour: number; minute: number } | null
  target?: EventSummary | null
  timeZone?: string
}) {
  if (requestedBaseDate && explicitDateRequested) return new Date(requestedBaseDate)
  if (exactTime && target?.start) return new Date(target.start)
  if (requestedBaseDate) return new Date(requestedBaseDate)
  return new Date(Date.now() + 24 * 60 * 60_000)
}

function agendaDayForBaseDate(baseDate: Date, timeZone?: string) {
  return sameCalendarDay(baseDate, startOfDay(0, timeZone), timeZone) ? 'today' : 'tomorrow'
}

async function searchUpcomingEvents(profileId: string, timeZone?: string) {
  return listUpcomingEvents({
    profileId,
    startAt: startOfDay(0, timeZone),
    windowMinutes: 365 * 24 * 60,
    maxResults: 250,
    timeZone,
  })
}

async function cancelCalendarTarget({
  profile,
  target,
  smsFrom,
}: {
  profile: SmsProfile
  target: EventSummary
  smsFrom: string
}) {
  try {
    const { authority } = await classifyTargetEvent(profile, target)

    if (isRecurringEvent(target)) {
      return prepareRecurringCancelScope({
        profileId: profile.id,
        smsFrom,
        target,
        authority,
      })
    }

    await deleteCalendarEvent(
      profile.id,
      target.id,
      target.calendarId,
      authority === 'owned_meeting' ? 'all' : 'none',
    )
    await clearPendingRemindersForEvent(profile.id, target.id)

    if (canCancelForEveryone(authority)) {
      return `Done. I canceled ${target.title} on ${eventDateLabel(target, profile.timezone)} and sent the update.`
    }

    return authority === 'personal'
      ? `Done. I canceled ${target.title} on ${eventDateLabel(target, profile.timezone)}.`
      : removedFromCalendarText(target, authority, profile.timezone)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/403|forbidden|read.?only|not allowed|permission/i.test(message)) {
      return `I found ${target.title}, but that calendar will not let Manoa cancel it. Remove it in ${target.calendarName}, or turn off read-only calendars in Manoa.`
    }

    if (/400|bad request|rejected/i.test(message)) {
      return `I found ${target.title}, but ${target.calendarName} rejected the cancel request. Try removing it directly from that calendar.`
    }

    return `I found ${target.title}, but I could not cancel it from Manoa yet. Try removing it directly from ${target.calendarName}.`
  }
}

async function profileForSender(sender: string) {
  const dashboardProfileId = profileIdFromDashboardSender(sender)
  const queryColumn = dashboardProfileId ? 'id' : 'phone_e164'
  const queryValue = dashboardProfileId || sender

  const result = await supabaseAdmin
    .from('profiles')
    .select('id,email,phone_e164,timezone,default_event_duration_minutes,phone_confirmed_at,sms_opted_out_at')
    .eq(queryColumn, queryValue)
    .maybeSingle<{
      id: string
      email: string
      phone_e164: string | null
      timezone: string
      default_event_duration_minutes: number
      phone_confirmed_at: string | null
      sms_opted_out_at: string | null
    }>()

  let profile = result.data
  if (result.error && isMissingDefaultDurationColumnError(result.error)) {
    const fallback = await supabaseAdmin
      .from('profiles')
      .select('id,email,phone_e164,timezone,phone_confirmed_at,sms_opted_out_at')
      .eq(queryColumn, queryValue)
      .maybeSingle<{
        id: string
        email: string
        phone_e164: string | null
        timezone: string
        phone_confirmed_at: string | null
        sms_opted_out_at: string | null
      }>()

    if (fallback.error) throw fallback.error
    if (!fallback.data) return null
    profile = {
      ...fallback.data,
      default_event_duration_minutes: 30,
    }
  } else if (result.error) {
    throw result.error
  }

  if (!profile) return null

  if (!dashboardProfileId && !profile.phone_confirmed_at) {
    await supabaseAdmin
      .from('profiles')
      .update({
        phone_confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', profile.id)
  }

  const { data: subscription, error: subscriptionError } = await supabaseAdmin
    .from('subscriptions')
    .select('status')
    .eq('profile_id', profile.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ status: string }>()

  if (subscriptionError) throw subscriptionError

  return {
    ...profile,
    subscriptionStatus: subscription?.status || 'missing',
  } satisfies SmsProfile
}

async function logSms({
  profileId,
  from,
  body,
  direction,
  twilioMessageSid,
}: {
  profileId?: string
  from: string
  body: string
  direction: 'inbound' | 'outbound'
  twilioMessageSid?: string
}) {
  await supabaseAdmin.from('sms_messages').insert({
    profile_id: profileId || null,
    from_e164: from,
    body,
    direction,
    twilio_message_sid: twilioMessageSid || null,
  })
}

async function loadPendingAction(
  profileId: string,
  smsFrom: string,
  options?: { excludeKinds?: PendingKind[]; onlyKind?: PendingKind },
) {
  let query = supabaseAdmin
    .from('pending_actions')
    .select('id,kind,payload')
    .eq('profile_id', profileId)
    .eq('sms_from', smsFrom)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)

  if (options?.onlyKind) {
    query = query.eq('kind', options.onlyKind)
  }

  if (options?.excludeKinds?.length) {
    query = query.not('kind', 'in', `(${options.excludeKinds.join(',')})`)
  }

  const { data, error } = await query.maybeSingle<PendingAction>()

  if (error) throw error
  return data
}

async function storePendingAction({
  profileId,
  smsFrom,
  kind,
  payload,
}: {
  profileId: string
  smsFrom: string
  kind: PendingKind
  payload: PendingPayload
}) {
  let supersede = supabaseAdmin
    .from('pending_actions')
    .update({ status: 'superseded' })
    .eq('profile_id', profileId)
    .eq('sms_from', smsFrom)
    .eq('status', 'pending')

  if (backgroundPendingKinds.includes(kind)) {
    supersede = supersede.eq('kind', kind)
  } else {
    supersede = supersede.not('kind', 'in', `(${backgroundPendingKinds.join(',')})`)
  }

  await supersede

  const expiresAt = new Date(Date.now() + 20 * 60_000).toISOString()
  const { error } = await supabaseAdmin.from('pending_actions').insert({
    profile_id: profileId,
    sms_from: smsFrom,
    kind,
    payload,
    expires_at: expiresAt,
    status: 'pending',
  })

  if (error) throw error
}

async function clearPendingAction(id: string) {
  const { error } = await supabaseAdmin
    .from('pending_actions')
    .update({ status: 'completed' })
    .eq('id', id)

  if (error) throw error
}

async function markSmsOptOut(profileId: string, optedOut: boolean) {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      sms_opted_out_at: optedOut ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profileId)

  if (error) throw error
}

async function clearPendingRemindersForEvent(profileId: string, calendarEventId?: string | null) {
  if (!calendarEventId) return

  const { error } = await supabaseAdmin
    .from('reminders')
    .update({
      status: 'canceled',
      updated_at: new Date().toISOString(),
    })
    .eq('profile_id', profileId)
    .eq('calendar_event_id', calendarEventId)
    .eq('status', 'pending')

  if (error) throw error
}

async function queueReminderForEvent({
  profileId,
  phoneE164,
  calendarEventId,
  calendarId,
  title,
  start,
  leadMinutes = 30,
  timeZone,
}: {
  profileId: string
  phoneE164?: string | null
  calendarEventId?: string | null
  calendarId?: string | null
  title: string
  start: string
  leadMinutes?: number
  timeZone?: string
}) {
  if (!phoneE164) return

  const startsAt = new Date(start)
  if (Number.isNaN(startsAt.getTime())) return

  const dueAt = new Date(startsAt.getTime() - leadMinutes * 60_000)
  if (dueAt.getTime() <= Date.now()) return

  await clearPendingRemindersForEvent(profileId, calendarEventId)
  const { error } = await supabaseAdmin.from('reminders').insert({
    profile_id: profileId,
    phone_e164: phoneE164,
    calendar_event_id: calendarEventId || null,
    calendar_id: calendarId || null,
    event_starts_at: startsAt.toISOString(),
    due_at: dueAt.toISOString(),
    body: `Reminder: ${title} starts at ${formatSmsTime(startsAt, timeZone)}.`,
    status: 'pending',
  })

  if (error) throw error
}

async function maybeQueueReminderForOption({
  profile,
  option,
  calendarEventId,
  calendarId,
  title,
  leadMinutes,
}: {
  profile: SmsProfile
  option: ScheduleOption
  calendarEventId?: string | null
  calendarId?: string | null
  title?: string
  leadMinutes?: number
}) {
  if (option.recurrence) return

  await queueReminderForEvent({
    profileId: profile.id,
    phoneE164: profile.phone_e164,
    calendarEventId: calendarEventId || null,
    calendarId: calendarId || option.calendarId,
    title: title || option.title,
    start: option.start,
    leadMinutes,
    timeZone: profile.timezone,
  })
}

async function classifyTargetEvent(
  profile: SmsProfile,
  target: EventSummary,
): Promise<{ authority: EventAuthority; contact: BusinessContact | null }> {
  const contact = await inferBusinessContact({
    profileId: profile.id,
    query: target.title,
    location: target.location,
    description: target.description,
  })

  return {
    authority: classifyEventAuthority({
      event: target,
      profileEmail: profile.email,
      businessContact: contact,
    }),
    contact,
  }
}

async function prepareExternalCallPrep({
  profile,
  smsFrom,
  target,
  baseDate,
  exactTime,
  contact,
}: {
  profile: SmsProfile
  smsFrom: string
  target: EventSummary
  baseDate: Date
  exactTime: { hour: number; minute: number } | null
  contact?: BusinessContact | null
}) {
  const inferredContact =
    contact ||
    (await inferBusinessContact({
      profileId: profile.id,
      query: target.title,
      location: target.location,
      description: target.description,
    }))

  const businessName = inferredContact?.label || target.title
  const options = await findExternalCallPrepOptions({
    profileId: profile.id,
    optionTitle: `Call ${businessName} to reschedule`,
    availabilityTitle: target.title,
    baseDate,
    exactTime,
    calendarHint: 'Personal',
    timeZone: profile.timezone,
  })

  if (!options.length) {
    return `I found ${target.title}, but I could not find a good time for the call. Try another day or time.`
  }

  const callNote = buildCallNote(target, options, profile.timezone)
  await storePendingAction({
    profileId: profile.id,
    smsFrom,
    kind: 'external_call_prep',
    payload: {
      target,
      options,
      businessName,
      phoneE164: inferredContact?.phone_e164 || null,
      callNote,
      requestedBaseDate: baseDate.toISOString(),
      exactTime,
      authority: 'external_appointment',
    },
  })

  let reply = `I can't change ${target.title} with the office by text, but I can get you ready to call.\nHere are your next openings:\n${callPrepOptionList(options)}\nReply 1, 2, or 3 and I'll hold that time for your call.`

  if (inferredContact?.phone_e164) {
    reply += `\nOffice number: ${inferredContact.phone_e164}.`
  }

  reply += `\nCall note: ${callNote}`
  return reply
}

async function prepareExternalScheduleCallPrep({
  profile,
  smsFrom,
  title,
  baseDate,
  exactTime,
  durationMinutes,
  dateWindow,
  chosenCalendar,
}: {
  profile: SmsProfile
  smsFrom: string
  title: string
  baseDate: Date
  exactTime: { hour: number; minute: number } | null
  durationMinutes: number
  dateWindow?: DateWindow | null
  chosenCalendar?: CalendarPlacementOption | null
}) {
  const inferredContact = await inferBusinessContact({
    profileId: profile.id,
    query: title,
    location: '',
    description: '',
  })

  const businessName = inferredContact?.label || title
  const optionTitle = `${title} (pending)`
  const search = async (searchBaseDate: Date, searchWindow?: DateWindow | null) =>
    findExternalCallPrepOptions({
      profileId: profile.id,
      optionTitle,
      availabilityTitle: title,
      baseDate: searchBaseDate,
      exactTime,
      calendarId: chosenCalendar?.calendarId,
      calendarHint: chosenCalendar?.calendarLabel || 'Personal',
      dateWindow: searchWindow,
      timeZone: profile.timezone,
    })

  let options = await search(baseDate, dateWindow)
  let widenedFrom: string | null = null

  if (!options.length && dateWindow?.label === 'this week') {
    options = await search(addDays(dateWindow.end, 1, profile.timezone), null)
    widenedFrom = dateWindow.label
  }

  if (!options.length) {
    return `I could not find a good opening${dateWindow?.label ? ` for ${dateWindow.label}` : ''} for ${title}. Try a specific weekday or a different calendar.`
  }

  const callNote = buildNewAppointmentCallNote(title, options)
  await storePendingAction({
    profileId: profile.id,
    smsFrom,
    kind: 'external_call_prep',
    payload: {
      options,
      businessName,
      phoneE164: inferredContact?.phone_e164 || null,
      callNote,
      authority: 'external_appointment',
      scheduleRequest: {
        title,
        baseDate: baseDate.toISOString(),
        exactTime,
        durationMinutes,
        recurrence: null,
      },
    },
  })

  const replyLine =
    options.length >= 3 ? 'Reply 1, 2, or 3.' : options.length === 2 ? 'Reply 1 or 2.' : 'Reply 1.'
  let reply = widenedFrom
    ? `I did not find any remaining ${widenedFrom} openings for ${title}, so I checked next week.\nI can hold one of these while you call:\n${callPrepOptionList(options)}\n${replyLine}\nAfter the office books it, reply CONFIRMED. If they give a different time, text that time.`
    : `I can hold one of these while you call to book ${title}:\n${callPrepOptionList(options)}\n${replyLine}\nAfter the office books it, reply CONFIRMED. If they give a different time, text that time.`

  if (inferredContact?.phone_e164) {
    reply += `\nOffice number: ${inferredContact.phone_e164}.`
  }
  return reply
}

async function prepareInvitedReschedule({
  profile,
  smsFrom,
  target,
  baseDate,
  exactTime,
}: {
  profile: SmsProfile
  smsFrom: string
  target: EventSummary
  baseDate: Date
  exactTime: { hour: number; minute: number } | null
}) {
  await storePendingAction({
    profileId: profile.id,
    smsFrom,
    kind: 'invited_reschedule_action',
    payload: {
      target,
      requestedBaseDate: baseDate.toISOString(),
      exactTime,
      authority: 'invited_meeting',
    },
  })

  return `I can't move ${target.title} for everyone from your side.\nDo you want me to:\n1. Hold a new time on my calendar only\n2. Draft a message to the organizer\n3. Keep it and add a reminder`
}

async function prepareInvitedCancel({
  profileId,
  smsFrom,
  target,
}: {
  profileId: string
  smsFrom: string
  target: EventSummary
}) {
  await storePendingAction({
    profileId,
    smsFrom,
    kind: 'invited_cancel_action',
    payload: {
      target,
      authority: 'invited_meeting',
    },
  })

  return `I can't cancel ${target.title} for everyone because you're not the organizer.\nDo you want me to:\n1. Remove it from my calendar only\n2. Draft a decline message\n3. Keep it`
}

async function prepareRecurringRescheduleScope({
  profileId,
  smsFrom,
  target,
  authority,
  baseDate,
  exactTime,
}: {
  profileId: string
  smsFrom: string
  target: EventSummary
  authority: EventAuthority
  baseDate: Date
  exactTime: { hour: number; minute: number } | null
}) {
  await storePendingAction({
    profileId,
    smsFrom,
    kind: 'reschedule',
    payload: {
      target,
      authority,
      requestedBaseDate: baseDate.toISOString(),
      exactTime,
      stage: 'scope',
    },
  })

  return recurringReschedulePrompt(target)
}

async function prepareRecurringCancelScope({
  profileId,
  smsFrom,
  target,
  authority,
}: {
  profileId: string
  smsFrom: string
  target: EventSummary
  authority: EventAuthority
}) {
  await storePendingAction({
    profileId,
    smsFrom,
    kind: 'invited_cancel_action',
    payload: {
      target,
      authority,
      stage: 'scope',
    },
  })

  return recurringCancelPrompt(target, authority)
}

async function handleSaveBusinessPhoneReply({
  profile,
  from,
  body,
  pending,
}: {
  profile: SmsProfile
  from: string
  body: string
  pending: PendingAction
}) {
  const lower = body.trim().toLowerCase()
  if (lower === 'skip') {
    await clearPendingAction(pending.id)
    return 'Okay. I will not save a business number yet.'
  }

  const phone = extractPhoneFromText(body)
  if (!phone) {
    return "Reply with the office phone number, or send SKIP if you don't want to save it yet."
  }

  const businessName = pending.payload.businessName || pending.payload.target?.title || 'Office'
  const aliases = buildBusinessAliases([
    businessName,
    pending.payload.target?.title,
    pending.payload.target?.location,
  ])

  await saveOrUpdateBusinessContact({
    profileId: profile.id,
    label: businessName,
    phoneE164: phone,
    category: looksExternalAppointment(pending.payload.target || ({
      title: businessName,
      location: '',
      description: '',
      start: '',
      end: '',
      id: '',
      calendarId: '',
      calendarName: '',
      timeLabel: '',
      organizerEmail: '',
      attendeeCount: 0,
    } as EventSummary))
      ? 'appointment'
      : 'business',
    notes: 'Saved by SMS during external appointment flow',
    aliases,
  })

  if (pending.payload.followUpKind === 'external_cancel_confirm') {
    await storePendingAction({
      profileId: profile.id,
      smsFrom: from,
      kind: 'external_cancel_confirm',
      payload: {
        target: pending.payload.target,
        businessName,
        phoneE164: phone,
        callNote: pending.payload.callNote,
        authority: 'external_appointment',
      },
    })
    await clearPendingAction(pending.id)
    return `Saved ${businessName} as ${phone} for next time.\nWhen the office confirms the cancellation, text something like "I called and canceled it" and I'll clear it from your calendar.`
  }

  if (pending.payload.followUpKind === 'external_reschedule_confirm') {
    const isNewExternalAppointment =
      Boolean(pending.payload.holdEventId) &&
      pending.payload.target?.id === pending.payload.holdEventId

    await storePendingAction({
      profileId: profile.id,
      smsFrom: from,
      kind: 'external_reschedule_confirm',
      payload: {
        target: pending.payload.target,
        businessName,
        phoneE164: phone,
        callNote: pending.payload.callNote,
        authority: 'external_appointment',
        holdEventId: pending.payload.holdEventId || null,
        holdCalendarId: pending.payload.holdCalendarId || null,
      },
    })
    await clearPendingAction(pending.id)
    return isNewExternalAppointment
      ? `Saved ${businessName} as ${phone} for next time.\nWhen the office confirms the time, text something like "They booked it for Tuesday at 2pm" and I'll add it to your calendar.\nYou can keep texting me other things in the meantime.`
      : `Saved ${businessName} as ${phone} for next time.\nWhen the office confirms the new time, text something like "They moved it to Tuesday at 2pm" and I'll update your calendar.\nYou can keep texting me other things in the meantime.`
  }

  await clearPendingAction(pending.id)

  return `Saved ${businessName} as ${phone} for next time.`
}

async function handleResolveInviteesReply({
  profile,
  from,
  body,
  pending,
}: {
  profile: SmsProfile
  from: string
  body: string
  pending: PendingAction
}) {
  const option = pending.payload.selectedOption
  const lower = body.trim().toLowerCase()
  const existingInvitees = pending.payload.attendees || []
  const unresolvedNames = pending.payload.unresolvedInvitees || []
  const eventChoice = parseSmsIntent(body, profile.timezone)

  if (pending.payload.events?.length && !pending.payload.target) {
    const target = eventChoice.type === 'choice'
      ? choose(pending.payload.events, eventChoice.choice)
      : null

    if (!target) {
      return `Which event should I add them to?\n${inviteTargetChoiceList(
        pending.payload.events,
        profile.timezone,
      )}\nReply 1, 2, or 3.`
    }

    await clearPendingAction(pending.id)

    if (unresolvedNames.length && providerCanSendInvites(target.provider)) {
      await storePendingAction({
        profileId: profile.id,
        smsFrom: from,
        kind: 'resolve_invitees',
        payload: {
          target,
          attendees: existingInvitees,
          unresolvedInvitees: unresolvedNames,
        },
      })

      return `I can add them to ${target.title}, but I still need email${
        unresolvedNames.length > 1 ? 's' : ''
      } for ${unresolvedInviteeSummary(unresolvedNames)}.\nReply like "Sam sam@company.com" or say "skip."`
    }

    return inviteExistingEventTarget({
      profile,
      target,
      attendees: existingInvitees,
      unresolvedInvitees: unresolvedNames,
    })
  }

  if (pending.payload.target && !option) {
    const target = pending.payload.target

    if (isInviteeResolutionAbort(lower)) {
      await clearPendingAction(pending.id)
      return `Okay. I did not add anyone to ${target.title}.`
    }

    const resolution = resolveInviteeFollowUp(body, unresolvedNames)
    if (!resolution.resolved.length) {
      return `I still need email${unresolvedNames.length > 1 ? 's' : ''} for ${unresolvedInviteeSummary(
        unresolvedNames,
      )}.\nReply like "Sam sam@company.com" or say "skip."`
    }

    await saveInviteeContacts(profile.id, resolution.resolved)

    const mergedInvitees = [...existingInvitees]
    for (const invitee of resolution.resolved) {
      if (mergedInvitees.some((item) => item.email.toLowerCase() === invitee.email.toLowerCase())) {
        continue
      }
      mergedInvitees.push(invitee)
    }

    if (resolution.unresolvedNames.length) {
      await storePendingAction({
        profileId: profile.id,
        smsFrom: from,
        kind: 'resolve_invitees',
        payload: {
          target,
          attendees: mergedInvitees,
          unresolvedInvitees: resolution.unresolvedNames,
        },
      })

      return `Got ${inviteeSummary(resolution.resolved)}.\nI still need email${
        resolution.unresolvedNames.length > 1 ? 's' : ''
      } for ${unresolvedInviteeSummary(resolution.unresolvedNames)}.`
    }

    await clearPendingAction(pending.id)
    return inviteExistingEventTarget({
      profile,
      target,
      attendees: mergedInvitees,
      unresolvedInvitees: [],
    })
  }

  if (!option) {
    return 'Send the scheduling request again and I will set it up.'
  }

  if (
    /\b(skip|just book it|book it anyway|without invites|without invite|no invites|dont invite|don't invite)\b/.test(
      lower,
    )
  ) {
    const eventAttendees = attendeesForCalendarEvent(option, existingInvitees)
    const created = await createCalendarEvent(profile.id, {
      ...option,
      attendees: eventAttendees,
    })
    await maybeQueueReminderForOption({
      profile,
      option,
      calendarEventId: created.id || null,
      calendarId: option.calendarId,
      title: option.title,
    })
    await clearPendingAction(pending.id)
    await storeRecentCreatedEvent({
      profileId: profile.id,
      smsFrom: from,
      option: { ...option, attendees: eventAttendees },
      eventId: created.id || null,
      organizerEmail: profile.email,
    })

    if (existingInvitees.length) {
      return `${bookingText(option)}\n${inviteOutcomeLine(option, existingInvitees)}\nI did not invite ${unresolvedInviteeSummary(unresolvedNames)} yet.`
    }

    return `${bookingText(option)}\nI did not invite ${unresolvedInviteeSummary(unresolvedNames)} because I still need their email.`
  }

  const resolution = resolveInviteeFollowUp(body, unresolvedNames)
  if (!resolution.resolved.length) {
    return `I still need email${unresolvedNames.length > 1 ? 's' : ''} for ${unresolvedInviteeSummary(
      unresolvedNames,
    )}.\nReply like "Sam sam@company.com, Priya priya@company.com" or say "book it without invites."`
  }

  for (const invitee of resolution.resolved) {
    if (!invitee.displayName) continue
    await saveOrUpdatePersonContact({
      profileId: profile.id,
      label: invitee.displayName,
      email: invitee.email,
      aliases: buildPersonAliases([invitee.displayName, invitee.email]),
    })
  }

  const mergedInvitees = [...existingInvitees]
  for (const invitee of resolution.resolved) {
    if (mergedInvitees.some((item) => item.email.toLowerCase() === invitee.email.toLowerCase())) {
      continue
    }
    mergedInvitees.push(invitee)
  }

  if (resolution.unresolvedNames.length) {
    await storePendingAction({
      profileId: profile.id,
      smsFrom: from,
      kind: 'resolve_invitees',
      payload: {
        selectedOption: option,
        attendees: mergedInvitees,
        unresolvedInvitees: resolution.unresolvedNames,
      },
    })

    return `Got ${inviteeSummary(resolution.resolved)}.\nI still need email${
      resolution.unresolvedNames.length > 1 ? 's' : ''
    } for ${unresolvedInviteeSummary(resolution.unresolvedNames)}.`
  }

  const eventAttendees = attendeesForCalendarEvent(option, mergedInvitees)
  const created = await createCalendarEvent(profile.id, {
    ...option,
    attendees: eventAttendees,
  })
  await maybeQueueReminderForOption({
    profile,
    option,
    calendarEventId: created.id || null,
    calendarId: option.calendarId,
    title: option.title,
  })
  await clearPendingAction(pending.id)
  await storeRecentCreatedEvent({
    profileId: profile.id,
    smsFrom: from,
    option: { ...option, attendees: eventAttendees },
    eventId: created.id || null,
    organizerEmail: profile.email,
  })

  return `${bookingText(option)}\n${inviteOutcomeLine(option, mergedInvitees)}`
}

async function storeScheduleOptionsPending({
  profileId,
  smsFrom,
  options,
  attendees,
  unresolvedInvitees,
  scheduleRequest,
}: {
  profileId: string
  smsFrom: string
  options: ScheduleOption[]
  attendees: Invitee[]
  unresolvedInvitees: string[]
  scheduleRequest?: PendingPayload['scheduleRequest']
}) {
  await storePendingAction({
    profileId,
    smsFrom,
    kind: 'schedule',
    payload: {
      options,
      attendees,
      unresolvedInvitees,
      scheduleRequest,
    },
  })
}

function scheduleOptionsReply({
  options,
  recurrence,
  attendees,
  unresolvedInvitees,
}: {
  options: ScheduleOption[]
  recurrence: RecurrenceSpec | null
  attendees: Invitee[]
  unresolvedInvitees: string[]
}) {
  const replyLine =
    options.length >= 3 ? 'Reply 1, 2, or 3.' : options.length === 2 ? 'Reply 1 or 2.' : 'Reply 1.'
  let reply = `I found these${recurrence ? ' starting' : ''} times:\n${optionList(options)}\n${replyLine}`
  const recurring = recurrenceLine(options)
  if (recurring) {
    reply += `\n${recurring}`
  }
  if (attendees.length) {
    reply += `\nReady to invite: ${inviteeSummary(attendees)}.`
  }
  if (unresolvedInvitees.length) {
    reply += `\nI still need email${unresolvedInvitees.length > 1 ? 's' : ''} for ${unresolvedInviteeSummary(
      unresolvedInvitees,
    )}.`
  }

  return reply
}

async function handleChoice({
  profile,
  smsFrom,
  body = '',
  choice,
  pending,
}: {
  profile: SmsProfile
  smsFrom: string
  body?: string
  choice: number
  pending: PendingAction
}) {
  if (pending.kind === 'choose_calendar') {
    const visibleChoiceCount = pending.payload.visibleCalendarChoiceCount || pending.payload.calendarChoices?.length || 0
    const pickedCalendar =
      choice <= visibleChoiceCount ? choose(pending.payload.calendarChoices, choice) : null
    const scheduleRequest = pending.payload.scheduleRequest
    if (!pickedCalendar || !scheduleRequest) return 'Reply with the calendar name or number you want.'

    if (looksExternalScheduleRequest(scheduleRequest.title) && !scheduleRequest.serviceConfirmed) {
      return prepareExternalScheduleCallPrep({
        profile,
        smsFrom,
        title: scheduleRequest.title,
        baseDate: new Date(scheduleRequest.baseDate),
        exactTime: scheduleRequest.exactTime,
        durationMinutes: scheduleRequest.durationMinutes,
        dateWindow: deserializeDateWindow(scheduleRequest.dateWindow),
        chosenCalendar: pickedCalendar,
      })
    }

    const attendees = pending.payload.attendees || []
    const unresolvedInvitees = pending.payload.unresolvedInvitees || []

    const exactReply = await maybeConfirmExactScheduleTime({
      profile,
      smsFrom,
      title: scheduleRequest.title,
      baseDate: new Date(scheduleRequest.baseDate),
      exactTime: scheduleRequest.exactTime,
      durationMinutes: scheduleRequest.durationMinutes,
      chosenCalendar: pickedCalendar,
      recurrence: scheduleRequest.recurrence,
      location: scheduleRequest.location || null,
      attendees,
      unresolvedInvitees,
    })

    if (exactReply) return exactReply

    const options = await findScheduleOptionsAcrossWindow({
      profileId: profile.id,
      title: scheduleRequest.title,
      baseDate: new Date(scheduleRequest.baseDate),
      exactTime: scheduleRequest.exactTime,
      calendarId: pickedCalendar.calendarId,
      durationMinutes: scheduleRequest.durationMinutes,
      recurrence: scheduleRequest.recurrence,
      location: scheduleRequest.location || null,
      dateWindow: deserializeDateWindow(scheduleRequest.dateWindow),
      timeZone: profile.timezone,
    })

    if (!options.length) {
      return noOpeningScheduleReply({
        profile,
        smsFrom,
        title: scheduleRequest.title,
        baseDate: new Date(scheduleRequest.baseDate),
        exactTime: scheduleRequest.exactTime,
        durationMinutes: scheduleRequest.durationMinutes,
        dateWindow: deserializeDateWindow(scheduleRequest.dateWindow),
        chosenCalendar: pickedCalendar,
        location: scheduleRequest.location || null,
        recurrence: scheduleRequest.recurrence,
        attendees,
        unresolvedInvitees,
        calendarLabel: pickedCalendar.calendarLabel,
      })
    }

    await storeScheduleOptionsPending({
      profileId: profile.id,
      smsFrom,
      options,
      attendees,
      unresolvedInvitees,
      scheduleRequest,
    })

    return scheduleOptionsReply({
      options,
      recurrence: scheduleRequest.recurrence,
      attendees,
      unresolvedInvitees,
    })
  }

  if (pending.kind === 'schedule') {
    const option = choose(pending.payload.options, choice)
    if (!option) return 'Reply with 1, 2, or 3.'

    const attendees = pending.payload.attendees || []
    const unresolvedInvitees = pending.payload.unresolvedInvitees || []

    if (unresolvedInvitees.length) {
      const resolution = resolveInviteeFollowUp(body, unresolvedInvitees)
      if (resolution.resolved.length) {
        for (const invitee of resolution.resolved) {
          if (!invitee.displayName) continue
          await saveOrUpdatePersonContact({
            profileId: profile.id,
            label: invitee.displayName,
            email: invitee.email,
            aliases: buildPersonAliases([invitee.displayName, invitee.email]),
          })
        }

        const mergedInvitees = [...attendees]
        for (const invitee of resolution.resolved) {
          if (mergedInvitees.some((item) => item.email.toLowerCase() === invitee.email.toLowerCase())) {
            continue
          }
          mergedInvitees.push(invitee)
        }

        if (resolution.unresolvedNames.length) {
          await storePendingAction({
            profileId: profile.id,
            smsFrom,
            kind: 'resolve_invitees',
            payload: {
              selectedOption: option,
              attendees: mergedInvitees,
              unresolvedInvitees: resolution.unresolvedNames,
            },
          })

          return `Got ${inviteeSummary(resolution.resolved)}.\nI still need email${
            resolution.unresolvedNames.length > 1 ? 's' : ''
          } for ${unresolvedInviteeSummary(resolution.unresolvedNames)}.`
        }

        const eventAttendees = attendeesForCalendarEvent(option, mergedInvitees)
        const created = await createCalendarEvent(profile.id, {
          ...option,
          attendees: eventAttendees,
        })
        await maybeQueueReminderForOption({
          profile,
          option,
          calendarEventId: created.id || null,
          calendarId: option.calendarId,
          title: option.title,
        })
        await clearPendingAction(pending.id)
        await storeRecentCreatedEvent({
          profileId: profile.id,
          smsFrom,
          option: { ...option, attendees: eventAttendees },
          eventId: created.id || null,
          organizerEmail: profile.email,
        })

        return `${bookingText(option)}\n${inviteOutcomeLine(option, mergedInvitees)}\nI'll remind you before it starts.`
      }

      await storePendingAction({
        profileId: profile.id,
        smsFrom,
        kind: 'resolve_invitees',
        payload: {
          selectedOption: option,
          attendees,
          unresolvedInvitees,
        },
      })

      return `I can send the invite, but I still need email${
        unresolvedInvitees.length > 1 ? 's' : ''
      } for ${unresolvedInviteeSummary(unresolvedInvitees)}.\nReply like "Sam sam@company.com" or say "book it without invites."`
    }

    const eventAttendees = attendeesForCalendarEvent(option, attendees)
    const created = await createCalendarEvent(profile.id, {
      ...option,
      attendees: eventAttendees,
    })
    await maybeQueueReminderForOption({
      profile,
      option,
      calendarEventId: created.id || null,
      calendarId: option.calendarId,
      title: option.title,
    })
    await clearPendingAction(pending.id)
    await storeRecentCreatedEvent({
      profileId: profile.id,
      smsFrom,
      option: { ...option, attendees: eventAttendees },
      eventId: created.id || null,
      organizerEmail: profile.email,
    })

    if (attendees.length) {
      return `${bookingText(option)}\n${inviteOutcomeLine(option, attendees)}\nI'll remind you before it starts.`
    }

    return `${bookingText(option)}\nI'll remind you before it starts.`
  }

  if (pending.kind === 'select_reschedule_target') {
    const event = choose(pending.payload.events, choice)
    if (!event) return 'Reply with 1, 2, or 3 for the meeting you want to move.'

    const { authority, contact } = await classifyTargetEvent(profile, event)
    const baseDate = rescheduleBaseDateForTarget({
      requestedBaseDate: pending.payload.requestedBaseDate || null,
      explicitDateRequested: Boolean(pending.payload.requestedBaseDate),
      exactTime: pending.payload.exactTime || null,
      target: event,
      timeZone: profile.timezone,
    })

    if (authority === 'external_appointment') {
      return prepareExternalCallPrep({
        profile,
        smsFrom,
        target: event,
        baseDate,
        exactTime: pending.payload.exactTime || null,
        contact,
      })
    }

    if (authority === 'invited_meeting' || authority === 'unknown') {
      return prepareInvitedReschedule({
        profile,
        smsFrom,
        target: event,
        baseDate,
        exactTime: pending.payload.exactTime || null,
      })
    }

    if (isRecurringEvent(event)) {
      return prepareRecurringRescheduleScope({
        profileId: profile.id,
        smsFrom,
        target: event,
        authority,
        baseDate,
        exactTime: pending.payload.exactTime || null,
      })
    }

    const options = await findScheduleOptions({
      profileId: profile.id,
      title: event.title,
      baseDate,
      exactTime: pending.payload.exactTime || null,
      calendarHint: event.calendarName,
      durationMinutes: eventDurationMinutes(event),
      location: event.location || null,
    })

    if (!options.length) {
      return `I found ${event.title}, but I could not find an opening to move it. Try another day or time.`
    }

    await storePendingAction({
      profileId: profile.id,
      smsFrom,
      kind: 'reschedule',
      payload: { target: event, options, authority },
    })

    return `I can move ${event.title} to one of these:\n${optionList(options)}\nReply 1, 2, or 3.`
  }

  if (pending.kind === 'select_cancel_target') {
    if (pending.payload.recentlyCreated) {
      return 'That event is already booked. Say "cancel that" if you want me to remove it.'
    }

    const event = choose(pending.payload.events, choice)
    if (!event) return 'Reply with 1, 2, or 3 for the event you want to cancel.'
    const reply = await cancelCalendarTarget({ profile, target: event, smsFrom })
    await clearPendingAction(pending.id)
    return reply
  }

  if (pending.kind === 'reschedule') {
    const target = pending.payload.target
    if (!target) return 'Reply with 1, 2, or 3.'

    if (pending.payload.stage === 'scope') {
      if (choice === 1) {
        const baseDate = pending.payload.requestedBaseDate
          ? new Date(pending.payload.requestedBaseDate)
          : new Date(Date.now() + 24 * 60 * 60_000)

        const options = await findScheduleOptions({
          profileId: profile.id,
          title: target.title,
          baseDate,
          exactTime: pending.payload.exactTime || null,
          calendarHint: target.calendarName,
          durationMinutes: eventDurationMinutes(target),
          location: target.location || null,
        })

        if (!options.length) {
          return `I found ${target.title}, but I could not find an opening to move it. Try another day or time.`
        }

        await storePendingAction({
          profileId: profile.id,
          smsFrom,
          kind: 'reschedule',
          payload: {
            target,
            options,
            authority: pending.payload.authority,
            stage: 'options',
            scope: 'single',
          },
        })

        return `I can move just this ${target.title} to:\n${optionList(options)}\nReply 1, 2, or 3.`
      }

      if (choice === 2) {
        const series = await loadSeriesMaster(profile.id, target, profile.timezone)
        if (!series?.seriesTarget || !series.recurrence) {
          return `I can move just this occurrence by text, but ${target.title} uses a custom repeat pattern I can't safely change yet.\n${actionChoiceList([
            'Reply with:',
            '1. Move just this one',
            '3. Keep it as is',
          ])}`
        }

        const baseDate = pending.payload.requestedBaseDate
          ? new Date(pending.payload.requestedBaseDate)
          : new Date(Date.now() + 24 * 60 * 60_000)

        const options = await findScheduleOptions({
          profileId: profile.id,
          title: series.seriesTarget.title,
          baseDate,
          exactTime: pending.payload.exactTime || null,
          calendarHint: series.seriesTarget.calendarName,
          durationMinutes: eventDurationMinutes(series.seriesTarget),
          recurrence: series.recurrence,
          location: series.seriesTarget.location || null,
        })

        if (!options.length) {
          return `I found ${target.title}, but I could not find an opening to move the whole series. Try another day or time.`
        }

        await storePendingAction({
          profileId: profile.id,
          smsFrom,
          kind: 'reschedule',
          payload: {
            target,
            seriesTarget: series.seriesTarget,
            recurrence: series.recurrence,
            options,
            authority: pending.payload.authority,
            stage: 'options',
            scope: 'series',
          },
        })

        let reply = `I can move the whole series to:\n${optionList(options)}\nReply 1, 2, or 3.`
        const recurring = recurrenceLine(options)
        if (recurring) {
          reply += `\n${recurring}`
        }
        return reply
      }

      if (choice === 3) {
        await clearPendingAction(pending.id)
        return `Okay. I left ${target.title} where it is.`
      }

      return 'Reply with 1, 2, or 3.'
    }

    const option = choose(pending.payload.options, choice)
    if (!option || !target) return 'Reply with 1, 2, or 3.'

    const sendUpdates = pending.payload.authority === 'owned_meeting' ? 'all' : 'none'
    if (pending.payload.scope === 'series' && pending.payload.seriesTarget && pending.payload.recurrence) {
      await updateCalendarEvent(
        profile.id,
        pending.payload.seriesTarget.id,
        {
          ...option,
          title: pending.payload.seriesTarget.title,
          calendarId: pending.payload.seriesTarget.calendarId,
          calendarName: pending.payload.seriesTarget.calendarName,
          recurrence: pending.payload.recurrence,
        },
        sendUpdates,
      )
      await clearPendingRemindersForEvent(profile.id, target.id)
      await clearPendingRemindersForEvent(profile.id, pending.payload.seriesTarget.id)
      await clearPendingAction(pending.id)

      if (pending.payload.authority === 'owned_meeting') {
        return `Moved the whole ${target.title} series to ${option.dayLabel} at ${option.timeLabel} and sent the update.`
      }

      return `Moved the whole ${target.title} series to ${option.dayLabel} at ${option.timeLabel}.`
    }

    await updateCalendarEvent(profile.id, target.id, option, sendUpdates)
    await maybeQueueReminderForOption({
      profile,
      option,
      calendarEventId: target.id,
      calendarId: target.calendarId,
      title: option.title,
    })
    await clearPendingAction(pending.id)

    if (pending.payload.authority === 'owned_meeting') {
      return `Moved ${target.title} to ${option.dayLabel} at ${option.timeLabel} and sent the update.`
    }

    return `Moved ${target.title} to ${option.dayLabel} at ${option.timeLabel}.`
  }

  if (pending.kind === 'invited_reschedule_action') {
    const target = pending.payload.target
    if (!target) return 'Send the request again and I will pick it up.'

    if (choice === 1) {
      const baseDate = pending.payload.requestedBaseDate
        ? new Date(pending.payload.requestedBaseDate)
        : new Date(Date.now() + 24 * 60 * 60_000)

      const options = await findScheduleOptions({
        profileId: profile.id,
        title: `Tentative: ${target.title}`,
        baseDate,
        exactTime: pending.payload.exactTime || null,
        calendarHint: 'Personal',
        durationMinutes: eventDurationMinutes(target),
        location: target.location || null,
      })

      if (!options.length) {
        return `I could not find a clean hold time for ${target.title}. Try another day or time.`
      }

      await storePendingAction({
        profileId: profile.id,
        smsFrom,
        kind: 'invited_reschedule_hold',
        payload: {
          target,
          options,
          authority: 'invited_meeting',
        },
      })

      return `I can hold one of these times on your calendar while you coordinate with the organizer:\n${optionList(options)}\nReply 1, 2, or 3.`
    }

    if (choice === 2) {
      const baseDate = pending.payload.requestedBaseDate
        ? new Date(pending.payload.requestedBaseDate)
        : new Date(Date.now() + 24 * 60 * 60_000)
      const options = await findScheduleOptions({
        profileId: profile.id,
        title: target.title,
        baseDate,
        exactTime: pending.payload.exactTime || null,
        calendarHint: target.calendarName,
        durationMinutes: eventDurationMinutes(target),
        location: target.location || null,
      })
      await clearPendingAction(pending.id)
      return buildOrganizerRescheduleDraft(target, options.slice(0, 3))
    }

    if (choice === 3) {
      await queueReminderForEvent({
        profileId: profile.id,
        phoneE164: profile.phone_e164,
        calendarEventId: target.id,
        calendarId: target.calendarId,
        title: target.title,
        start: target.start,
        timeZone: profile.timezone,
      })
      await clearPendingAction(pending.id)
      return `Okay. I left ${target.title} alone and will remind you before it starts.`
    }

    return 'Reply with 1, 2, or 3.'
  }

  if (pending.kind === 'invited_reschedule_hold') {
    const option = choose(pending.payload.options, choice)
    const target = pending.payload.target
    if (!option || !target) return 'Reply with 1, 2, or 3.'

    const created = await createCalendarEvent(profile.id, option)
    await maybeQueueReminderForOption({
      profile,
      option,
      calendarEventId: created.id || null,
      calendarId: option.calendarId,
      title: option.title,
      leadMinutes: 15,
    })
    await clearPendingAction(pending.id)
    await storeRecentCreatedEvent({
      profileId: profile.id,
      smsFrom,
      option,
      eventId: created.id || null,
      organizerEmail: profile.email,
    })

    return `Held ${option.dayLabel} at ${option.timeLabel} on your calendar for ${target.title}. The organizer still needs to confirm the real meeting move.`
  }

  if (pending.kind === 'invited_cancel_action') {
    const target = pending.payload.target
    if (!target) return 'Send the cancel request again and I will pick it up.'

    if (pending.payload.stage === 'scope') {
      const sendUpdates = pending.payload.authority === 'owned_meeting' ? 'all' : 'none'

      if (!isRecurringEvent(target)) {
        if (choice === 1 || choice === 2) {
          await deleteCalendarEvent(profile.id, target.id, target.calendarId, sendUpdates)
          await clearPendingRemindersForEvent(profile.id, target.id)
          await clearPendingAction(pending.id)
          if (pending.payload.authority === 'owned_meeting') {
            return `Canceled ${target.title} and sent the update.`
          }

          if (pending.payload.authority === 'personal') {
            return `Canceled ${target.title}.`
          }

          return removedFromCalendarText(target, pending.payload.authority, profile.timezone)
        }

        if (choice === 3) {
          await clearPendingAction(pending.id)
          return `Okay. I left ${target.title} on your calendar.`
        }

        return 'Reply with 1, 2, or 3.'
      }

      if (choice === 1) {
        await deleteCalendarEvent(profile.id, target.id, target.calendarId, sendUpdates)
        await clearPendingRemindersForEvent(profile.id, target.id)
        await clearPendingAction(pending.id)
        if (pending.payload.authority === 'owned_meeting') {
          return `Canceled this ${target.title} occurrence and sent the update.`
        }

        if (pending.payload.authority === 'personal') {
          return `Canceled just this ${target.title} occurrence.`
        }

        return removedRecurringText(target, pending.payload.authority, 'occurrence')
      }

      if (choice === 2) {
        const series = await loadSeriesMaster(profile.id, target, profile.timezone)
        const seriesTarget = series?.seriesTarget
        if (!seriesTarget) {
          return `I couldn't find the full ${target.title} series right now.\n${actionChoiceList([
            'Reply with:',
            canCancelDirectly(pending.payload.authority)
              ? '1. Cancel just this occurrence'
              : '1. Remove just this occurrence',
            '3. Keep it',
          ])}`
        }

        await deleteCalendarEvent(profile.id, seriesTarget.id, seriesTarget.calendarId, sendUpdates)
        await clearPendingRemindersForEvent(profile.id, target.id)
        await clearPendingRemindersForEvent(profile.id, seriesTarget.id)
        await clearPendingAction(pending.id)
        if (pending.payload.authority === 'owned_meeting') {
          return `Canceled the whole ${target.title} series and sent the update.`
        }

        if (pending.payload.authority === 'personal') {
          return `Canceled the whole ${target.title} series.`
        }

        return removedRecurringText(target, pending.payload.authority, 'series')
      }

      if (choice === 3) {
        await clearPendingAction(pending.id)
        return `Okay. I left ${target.title} on your calendar.`
      }

      return 'Reply with 1, 2, or 3.'
    }

    if (choice === 1) {
      await deleteCalendarEvent(profile.id, target.id, target.calendarId, 'none')
      await clearPendingRemindersForEvent(profile.id, target.id)
      await clearPendingAction(pending.id)
      return removedFromCalendarText(target, pending.payload.authority, profile.timezone)
    }

    if (choice === 2) {
      await clearPendingAction(pending.id)
      return buildOrganizerCancelDraft(target, profile.timezone)
    }

    if (choice === 3) {
      await clearPendingAction(pending.id)
      return `Okay. I left ${target.title} on your calendar.`
    }

    return 'Reply with 1, 2, or 3.'
  }

  if (pending.kind === 'external_call_prep') {
    const option = choose(pending.payload.options, choice)
    const target = pending.payload.target
    const requestedSchedule = pending.payload.scheduleRequest
    const requestedTitle = requestedSchedule?.title || pending.payload.businessName || target?.title || 'appointment'
    if (!option) return 'Reply with 1, 2, or 3.'

    const created = await createCalendarEvent(profile.id, option)
    await maybeQueueReminderForOption({
      profile,
      option,
      calendarEventId: created.id || null,
      calendarId: option.calendarId,
      title: option.title,
      leadMinutes: 15,
    })

    const businessName = pending.payload.businessName || requestedTitle
    const followUpTarget =
      target ||
      ({
        id: created.id || '',
        title: requestedTitle,
        start: option.start,
        end: addMinutes(
          new Date(option.start),
          requestedSchedule?.durationMinutes || profile.default_event_duration_minutes,
        ).toISOString(),
        provider: option.provider,
        calendarId: option.calendarId,
        calendarName: option.calendarName,
        timeLabel: formatSmsTime(new Date(option.start), profile.timezone),
        location: '',
        description: '',
        organizerEmail: '',
        attendeeCount: 0,
      } satisfies EventSummary)
    const callNote =
      pending.payload.callNote ||
      (target
        ? buildCallNote(target, [option], profile.timezone)
        : buildNewAppointmentCallNote(requestedTitle, [option]))
    const knownPhone = pending.payload.phoneE164 || null
    const isNewAppointment = !target

    if (knownPhone) {
      await clearPendingAction(pending.id)
      await storePendingAction({
        profileId: profile.id,
        smsFrom,
        kind: 'external_reschedule_confirm',
        payload: {
          target: followUpTarget,
          businessName,
          phoneE164: knownPhone,
          callNote,
          authority: 'external_appointment',
          holdEventId: created.id || null,
          holdCalendarId: option.calendarId,
        },
      })
      await storeRecentCreatedEvent({
        profileId: profile.id,
        smsFrom,
        option,
        eventId: created.id || null,
        organizerEmail: profile.email,
      })
      return isNewAppointment
        ? `Held ${option.dayLabel} at ${option.timeLabel} as ${requestedTitle} (pending).\nOffice number: ${knownPhone}.\nAfter the office books it, reply CONFIRMED. If they give a different time, text that time.`
        : `Held ${option.dayLabel} at ${option.timeLabel} for your call about ${target.title}.\nOffice number: ${knownPhone}.\nCall note: ${callNote}\nWhen the office confirms the new time, text something like "They moved it to Tuesday at 2pm" and I'll update your calendar.\nYou can keep texting me other things in the meantime.`
    }

    if (isNewAppointment) {
      await clearPendingAction(pending.id)
      await storePendingAction({
        profileId: profile.id,
        smsFrom,
        kind: 'external_reschedule_confirm',
        payload: {
          target: followUpTarget,
          businessName,
          phoneE164: null,
          callNote,
          authority: 'external_appointment',
          holdEventId: created.id || null,
          holdCalendarId: option.calendarId,
        },
      })
      await storeRecentCreatedEvent({
        profileId: profile.id,
        smsFrom,
        option,
        eventId: created.id || null,
        organizerEmail: profile.email,
      })
      return `Held ${option.dayLabel} at ${option.timeLabel} as ${requestedTitle} (pending).\nAfter the office books it, reply CONFIRMED. If they give a different time, text that time.`
    }

    await storePendingAction({
      profileId: profile.id,
      smsFrom,
      kind: 'save_business_contact_phone',
      payload: {
        target: followUpTarget,
        businessName,
        callNote,
        authority: 'external_appointment',
        followUpKind: 'external_reschedule_confirm',
        holdEventId: created.id || null,
        holdCalendarId: option.calendarId,
      },
    })

    return isNewAppointment
      ? `Held ${option.dayLabel} at ${option.timeLabel} for your call to book ${requestedTitle}.\nI don't have the office number yet. Reply with it and I'll save it for next time.\nCall note: ${callNote}\nWhen the office confirms the new time, text something like "They booked it for Tuesday at 2pm" and I'll add it to your calendar.`
      : `Held ${option.dayLabel} at ${option.timeLabel} for your call about ${target.title}.\nI don't have the office number yet. Reply with it and I'll save it for next time.\nCall note: ${callNote}\nWhen the office confirms the new time, text something like "They moved it to Tuesday at 2pm" and I'll update your calendar.`
  }

  if (pending.kind === 'save_business_contact_phone') {
    return "Reply with the office phone number, or send SKIP if you don't want to save it yet."
  }

  return 'I lost track of that request. Send it again?'
}

export async function handleIncomingSms({
  from,
  body,
  twilioMessageSid,
}: {
  from: string
  body: string
  twilioMessageSid?: string
}) {
  const dashboardProfileId = profileIdFromDashboardSender(from)
  const isDashboardConsole = Boolean(dashboardProfileId)
  const profile = await profileForSender(from)
  await logSms({ profileId: profile?.id, from, body, direction: 'inbound', twilioMessageSid })

  const lowerBody = body.trim().toLowerCase()

  if (!isDashboardConsole && stopWords.has(lowerBody)) {
    if (profile) {
      await markSmsOptOut(profile.id, true)
    }
    const reply = "You won't receive Manoa texts anymore. Reply START to turn them back on."
    await logSms({ profileId: profile?.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (!isDashboardConsole && startWords.has(lowerBody)) {
    if (!profile) {
      const reply = "I don't recognize this number yet. Sign up for Manoa first, then text START from this phone."
      await logSms({ from, body: reply, direction: 'outbound' })
      return reply
    }

    await markSmsOptOut(profile.id, false)
    const reply = 'Manoa texts are back on.'
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (lowerBody === 'help') {
    const reply = profile
      ? 'Manoa can schedule, reschedule, cancel, and send your agenda. Reply STOP to opt out or START to opt back in.'
      : 'Sign up for Manoa first, then text this number from your saved phone.'
    await logSms({ profileId: profile?.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (!profile) {
    const reply = "I don't recognize this number yet. Sign up for Manoa first, then text START from this phone."
    await logSms({ from, body: reply, direction: 'outbound' })
    return reply
  }

  if (profile.sms_opted_out_at && !isDashboardConsole) {
    const reply = 'You are currently opted out. Reply START to turn Manoa texts back on.'
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (!activeSubscriptionStatuses.has(profile.subscriptionStatus)) {
    const reply = 'Your Manoa subscription is not active yet. Finish checkout, then text me again.'
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (!(await hasConnectedCalendar(profile.id))) {
    const reply = 'Your subscription is active. Connect Google, Outlook, or Apple from your setup page, then text me again.'
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  const externalCancelPending = await loadPendingAction(profile.id, from, {
    onlyKind: 'external_cancel_confirm',
  })
  if (
    externalCancelPending?.payload.target &&
    confirmsExternalCancellation(
      body,
      externalCancelPending.payload.target,
      externalCancelPending.payload.businessName,
    )
  ) {
    const target = externalCancelPending.payload.target
    await deleteCalendarEvent(profile.id, target.id, target.calendarId, 'none')
    await clearPendingRemindersForEvent(profile.id, target.id)
    await clearPendingAction(externalCancelPending.id)
    const reply = `Removed ${target.title} from your calendar.\nIf you want, I can help you add a follow-up appointment next.`
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (
    externalCancelPending?.payload.target &&
    mentionsOfficeDelay(
      body,
      externalCancelPending.payload.target,
      externalCancelPending.payload.businessName,
    )
  ) {
    const target = externalCancelPending.payload.target
    const reply = `Okay. I left ${target.title} on your calendar.\nWhen the office confirms the cancellation, text me and I'll clear it.`
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  const externalReschedulePending = await loadPendingAction(profile.id, from, {
    onlyKind: 'external_reschedule_confirm',
  })
  if (externalReschedulePending?.payload.target) {
    const target = externalReschedulePending.payload.target
    const isNewExternalAppointment =
      Boolean(externalReschedulePending.payload.holdEventId) &&
      externalReschedulePending.payload.target.id === externalReschedulePending.payload.holdEventId

    if (isNewExternalAppointment && isBareExternalAppointmentConfirmation(body)) {
      const option = optionFromHeldExternalAppointment(target, profile.timezone)
      await updateCalendarEvent(profile.id, target.id, option, 'none')
      await queueReminderForEvent({
        profileId: profile.id,
        phoneE164: profile.phone_e164,
        calendarEventId: target.id,
        calendarId: target.calendarId,
        title: target.title,
        start: target.start,
        timeZone: profile.timezone,
      })
      await clearPendingAction(externalReschedulePending.id)
      const reply = `Great. I marked ${target.title} as confirmed for ${option.dayLabel} at ${option.timeLabel}.`
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    if (
      mentionsOfficeDelay(
        body,
        target,
        externalReschedulePending.payload.businessName,
      ) ||
      mentionsFailedExternalReschedule(
        body,
        target,
        externalReschedulePending.payload.businessName,
      )
    ) {
      if (externalReschedulePending.payload.holdEventId) {
        await deleteCalendarEvent(
          profile.id,
          externalReschedulePending.payload.holdEventId,
          externalReschedulePending.payload.holdCalendarId || target.calendarId,
          'none',
        )
        await clearPendingRemindersForEvent(profile.id, externalReschedulePending.payload.holdEventId)
      }

      const reply = mentionsFailedExternalReschedule(
        body,
        target,
        externalReschedulePending.payload.businessName,
      )
        ? isNewExternalAppointment
          ? `Okay. I cleared the temporary call hold for ${target.title}.\nIf the office offers another time later, text me the new day and time and I'll add it to your calendar.`
          : `Okay. I cleared the temporary call hold and left ${target.title} where it was.\nIf the office offers another time later, text me the new day and time and I'll update your calendar.`
        : isNewExternalAppointment
          ? `Okay. I cleared the temporary call hold for ${target.title}.\nWhen the office gets back to you with a new time, text me and I'll add it to your calendar.`
          : `Okay. I cleared the temporary call hold and left ${target.title} where it was.\nWhen the office gets back to you with a new time, text me and I'll update your calendar.`
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    const followUp = parseExternalRescheduleConfirmation(
      body,
      target,
      externalReschedulePending.payload.businessName,
      profile.timezone,
    )

    if (followUp.kind === 'confirmed_reschedule') {
      const option = optionFromExactExternalTime(
        target,
        followUp.baseDate,
        followUp.exactTime,
        profile.timezone,
      )
      await updateCalendarEvent(profile.id, target.id, option, 'none')
      await queueReminderForEvent({
        profileId: profile.id,
        phoneE164: profile.phone_e164,
        calendarEventId: target.id,
        calendarId: target.calendarId,
        title: target.title,
        start: option.start,
        timeZone: profile.timezone,
      })

      if (externalReschedulePending.payload.holdEventId && !isNewExternalAppointment) {
        await deleteCalendarEvent(
          profile.id,
          externalReschedulePending.payload.holdEventId,
          externalReschedulePending.payload.holdCalendarId || option.calendarId,
          'none',
        )
        await clearPendingRemindersForEvent(profile.id, externalReschedulePending.payload.holdEventId)
      }

      await clearPendingAction(externalReschedulePending.id)
      const reply = isNewExternalAppointment
        ? `Added ${target.title} for ${option.dayLabel} at ${option.timeLabel} on your calendar.\nI turned the temporary call hold into the real appointment.`
        : `Updated ${target.title} to ${option.dayLabel} at ${option.timeLabel} on your calendar.\nI also cleared the call hold.`
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    if (followUp.kind === 'needs_details') {
      const reply = isNewExternalAppointment
        ? `Tell me the day and time the office confirmed for ${target.title}, like "They booked it for Tuesday at 2pm."`
        : `Tell me the new day and time the office confirmed for ${target.title}, like "They moved it to Tuesday at 2pm."`
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }
  }

  const pending = await loadPendingAction(profile.id, from, {
    excludeKinds: backgroundPendingKinds,
  })

  let activePending = pending
  let intentBody = body
  let intentOverride: ParsedSmsIntent | null = null

  if (activePending && isCancelPendingRequest(body)) {
    const recentEvent =
      activePending.payload.recentlyCreated && activePending.kind === 'select_cancel_target'
        ? activePending.payload.events?.[0] || null
        : null
    const heldEvent =
      activePending.kind === 'save_business_contact_phone' && activePending.payload.holdEventId
        ? activePending.payload.target || null
        : null
    const targetToCancel = recentEvent || heldEvent

    if (targetToCancel) {
      const oldPendingId = activePending.id
      const reply = await cancelCalendarTarget({ profile, target: targetToCancel, smsFrom: from })
      await clearPendingAction(oldPendingId)
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    await clearPendingAction(activePending.id)
    const reply = 'Okay. I dropped that request.'
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  const correctedSchedule = activePending
    ? correctedScheduleIntentFromPending(
        body,
        activePending,
        profile.default_event_duration_minutes,
        profile.timezone,
      )
    : null

  if (activePending && correctedSchedule) {
    await clearPendingAction(activePending.id)
    activePending = null
    intentBody = correctedSchedule.text
    intentOverride = correctedSchedule.intent
  }

  if (activePending && isPendingEscapeRequest(body)) {
    await clearPendingAction(activePending.id)
    const reply = 'Got it, starting fresh. What would you like to do?'
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (activePending?.kind === 'save_business_contact_phone') {
    const reply = await handleSaveBusinessPhoneReply({ profile, from, body, pending: activePending })
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (activePending?.kind === 'resolve_invitees') {
    if (shouldClearResolveInviteesPendingForNewRequest(body, activePending, profile.timezone)) {
      await clearPendingAction(activePending.id)
      activePending = null
    } else {
      const reply = await handleResolveInviteesReply({ profile, from, body, pending: activePending })
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }
  }

  if (activePending?.kind === 'choose_calendar') {
    const pickedCalendar = resolveCalendarChoiceFromText(
      body,
      activePending.payload.calendarChoices,
      activePending.payload.visibleCalendarChoiceCount,
    )
    if (pickedCalendar && activePending.payload.scheduleRequest) {
      const scheduleRequest = activePending.payload.scheduleRequest
      const attendees = activePending.payload.attendees || []
      const unresolvedInvitees = activePending.payload.unresolvedInvitees || []

      if (looksExternalScheduleRequest(scheduleRequest.title) && !scheduleRequest.serviceConfirmed) {
        const reply = await prepareExternalScheduleCallPrep({
          profile,
          smsFrom: from,
          title: scheduleRequest.title,
          baseDate: new Date(scheduleRequest.baseDate),
          exactTime: scheduleRequest.exactTime,
          durationMinutes: scheduleRequest.durationMinutes,
          dateWindow: deserializeDateWindow(scheduleRequest.dateWindow),
          chosenCalendar: pickedCalendar,
        })
        await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
        return reply
      }

      const exactReply = await maybeConfirmExactScheduleTime({
        profile,
        smsFrom: from,
        title: scheduleRequest.title,
        baseDate: new Date(scheduleRequest.baseDate),
        exactTime: scheduleRequest.exactTime,
        durationMinutes: scheduleRequest.durationMinutes,
        chosenCalendar: pickedCalendar,
        recurrence: scheduleRequest.recurrence,
        location: scheduleRequest.location || null,
        attendees,
        unresolvedInvitees,
      })

      if (exactReply) {
        await logSms({ profileId: profile.id, from, body: exactReply, direction: 'outbound' })
        return exactReply
      }

      const options = await findScheduleOptionsAcrossWindow({
        profileId: profile.id,
        title: scheduleRequest.title,
        baseDate: new Date(scheduleRequest.baseDate),
        exactTime: scheduleRequest.exactTime,
        calendarId: pickedCalendar.calendarId,
        durationMinutes: scheduleRequest.durationMinutes,
        recurrence: scheduleRequest.recurrence,
        location: scheduleRequest.location || null,
        dateWindow: deserializeDateWindow(scheduleRequest.dateWindow),
        timeZone: profile.timezone,
      })

      if (!options.length) {
        const reply = await noOpeningScheduleReply({
          profile,
          smsFrom: from,
          title: scheduleRequest.title,
          baseDate: new Date(scheduleRequest.baseDate),
          exactTime: scheduleRequest.exactTime,
          durationMinutes: scheduleRequest.durationMinutes,
          dateWindow: deserializeDateWindow(scheduleRequest.dateWindow),
          chosenCalendar: pickedCalendar,
          location: scheduleRequest.location || null,
          recurrence: scheduleRequest.recurrence,
          attendees,
          unresolvedInvitees,
          calendarLabel: pickedCalendar.calendarLabel,
        })
        await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
        return reply
      }

      await storeScheduleOptionsPending({
        profileId: profile.id,
        smsFrom: from,
        options,
        attendees,
        unresolvedInvitees,
        scheduleRequest,
      })

      const reply = scheduleOptionsReply({
        options,
        recurrence: scheduleRequest.recurrence,
        attendees,
        unresolvedInvitees,
      })
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }
  }

  if (
    activePending?.kind === 'schedule' &&
    (activePending.payload.options || []).length === 1 &&
    isSingleScheduleDecline(body)
  ) {
    await clearPendingAction(activePending.id)
    const reply = 'Okay. I left it off your calendar.'
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (activePending?.kind === 'schedule' && (activePending.payload.options || []).length === 1) {
    const confirmedChoice = resolvePendingChoice(body, activePending, profile.timezone)
    const inviteeEmailFollowUp = isInviteeEmailFollowUp(
      body,
      activePending.payload.unresolvedInvitees || [],
    )
    if (confirmedChoice === 1 || inviteeEmailFollowUp) {
      const reply = await handleChoice({
        profile,
        smsFrom: from,
        body,
        choice: 1,
        pending: activePending,
      })
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }
  }

  if (activePending && isShortAcknowledgement(body)) {
    const reply = reminderForPending(activePending)
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  const existingEventInviteRequest = parseExistingEventInviteRequest(intentBody)
  if (existingEventInviteRequest) {
    const inviteeContext = await resolveExistingEventInvitees(profile.id, existingEventInviteRequest)
    const contextualTarget = contextualEventTarget(activePending, inviteeContext.eventQuery)

    if (contextualTarget) {
      if (inviteeContext.unresolvedNames.length && providerCanSendInvites(contextualTarget.provider)) {
        await storePendingAction({
          profileId: profile.id,
          smsFrom: from,
          kind: 'resolve_invitees',
          payload: {
            target: contextualTarget,
            attendees: inviteeContext.invitees,
            unresolvedInvitees: inviteeContext.unresolvedNames,
          },
        })

        const reply = `I can add them to ${contextualTarget.title}, but I still need email${
          inviteeContext.unresolvedNames.length > 1 ? 's' : ''
        } for ${unresolvedInviteeSummary(
          inviteeContext.unresolvedNames,
        )}.\nReply like "Sam sam@company.com" or say "skip."`
        await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
        return reply
      }

      const reply = await inviteExistingEventTarget({
        profile,
        target: contextualTarget,
        attendees: inviteeContext.invitees,
        unresolvedInvitees: inviteeContext.unresolvedNames,
      })
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    const events = await searchUpcomingEvents(profile.id, profile.timezone)
    const matches = matchingEventsByQuery(events, inviteeContext.eventQuery).slice(0, 3)

    if (matches.length > 1) {
      await storePendingAction({
        profileId: profile.id,
        smsFrom: from,
        kind: 'resolve_invitees',
        payload: {
          events: matches,
          attendees: inviteeContext.invitees,
          unresolvedInvitees: inviteeContext.unresolvedNames,
        },
      })

      const reply = `Which event should I add them to?\n${inviteTargetChoiceList(
        matches,
        profile.timezone,
      )}\nReply 1, 2, or 3.`
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    if (matches.length === 1) {
      const target = matches[0]

      if (inviteeContext.unresolvedNames.length && providerCanSendInvites(target.provider)) {
        await storePendingAction({
          profileId: profile.id,
          smsFrom: from,
          kind: 'resolve_invitees',
          payload: {
            target,
            attendees: inviteeContext.invitees,
            unresolvedInvitees: inviteeContext.unresolvedNames,
          },
        })

        const reply = `I found ${target.title} on ${eventDateLabel(
          target,
          profile.timezone,
        )}, but I still need email${inviteeContext.unresolvedNames.length > 1 ? 's' : ''} for ${unresolvedInviteeSummary(
          inviteeContext.unresolvedNames,
        )}.\nReply like "Sam sam@company.com" or say "skip."`
        await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
        return reply
      }

      const reply = await inviteExistingEventTarget({
        profile,
        target,
        attendees: inviteeContext.invitees,
        unresolvedInvitees: inviteeContext.unresolvedNames,
      })
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }
  }

  let aiConversation: AiConversationTurn[] = []
  if (!intentOverride) {
    try {
      aiConversation = await listSmsAiIntentContext(profile.id, body)
    } catch (error) {
      console.error('Could not load SMS AI context', error)
    }
  }

  const aiIntent = intentOverride ? null : await parseSmsIntentWithAI(intentBody, profile.timezone, aiConversation)
  const usedAiIntent = Boolean(aiIntent && aiIntent.type !== 'unknown')
  const intent: ParsedSmsIntent = intentOverride
    ? intentOverride
    : usedAiIntent && aiIntent
      ? aiIntent
      : parseSmsIntent(intentBody, profile.timezone)

  if (
    activePending?.kind === 'select_cancel_target' &&
    activePending.payload.recentlyCreated &&
    shouldClearRecentCreatedPendingForIntent(body, intent)
  ) {
    await clearPendingAction(activePending.id)
    activePending = null
  }

  const pendingChoice = activePending ? resolvePendingChoice(body, activePending, profile.timezone) : null

  if (activePending && (intent.type === 'choice' || pendingChoice)) {
    const reply = await handleChoice({
      profile,
      smsFrom: from,
      body,
      choice: intent.type === 'choice' ? intent.choice : (pendingChoice as number),
      pending: activePending,
    })
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (intent.type === 'lookup') {
    const dateWindow =
      intent.dateWindow ||
      {
        start: startOfDay(0, profile.timezone),
        end: addDays(startOfDay(0, profile.timezone), 365, profile.timezone),
        label: 'upcoming',
      }
    const events = await listUpcomingEvents({
      profileId: profile.id,
      startAt: dateWindow.start,
      windowMinutes: windowMinutes(dateWindow),
      maxResults: 250,
      timeZone: profile.timezone,
    })
    const reply = eventLookupText(
      intent.query,
      matchingEventsByQuery(events, intent.query),
      profile.timezone,
      intent.mode,
    )
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (intent.type === 'agenda') {
    if (intent.dateWindow || intent.label === 'coming up') {
      const dateWindow =
        intent.dateWindow ||
        {
          start: new Date(),
          end: addDays(startOfDay(0, profile.timezone), 14, profile.timezone),
          label: 'coming up',
        }
      const events = await listUpcomingEvents({
        profileId: profile.id,
        startAt: dateWindow.start,
        windowMinutes: windowMinutes(dateWindow),
        maxResults: 20,
        timeZone: profile.timezone,
      })
      const reply = agendaWindowText(dateWindow.label, events, profile.timezone)
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    const events = await listAgenda(profile.id, intent.day, profile.timezone)
    const reply = agendaText(intent.day, events)
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (intent.type === 'schedule') {
    const inviteeContext = await resolveScheduleInvitees(profile.id, intentBody)
    const cleanedIntent =
      !usedAiIntent && inviteeContext.cleanedText && inviteeContext.cleanedText !== intentBody
        ? parseSmsIntent(inviteeContext.cleanedText, profile.timezone)
        : intent
    const scheduleIntent =
      cleanedIntent.type === 'schedule'
        ? cleanedIntent
        : intent
    const scheduleDurationMinutes =
      scheduleIntent.durationMinutes ?? profile.default_event_duration_minutes

    const placement = await resolveCalendarPlacement(profile.id, scheduleIntent.calendarHint)
    if (!placement.bookingCalendars.length) {
      const reply = 'I can see your calendars, but none are set to accept new events yet. Update your calendar settings in the dashboard first.'
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    const needsCalendarChoice =
      placement.matches.length > 1 ||
      (placement.genericHint && placement.bookingCalendars.length > 1) ||
      (!placement.genericHint && placement.matches.length === 0 && placement.bookingCalendars.length > 1)

    if (needsCalendarChoice) {
      const calendarChoices = prioritizedCalendarChoices(
        placement.matches.length > 1
          ? placement.matches
          : placement.bookingCalendars,
      )
      const choicePrompt = calendarChoiceReply({
        heading:
          placement.matches.length === 0 && !placement.genericHint
            ? `I couldn't tell which calendar "${scheduleIntent.calendarHint}" means. Which calendar should I use?`
            : 'Which calendar should I put that on?',
        calendars: calendarChoices,
      })

      await storePendingAction({
        profileId: profile.id,
        smsFrom: from,
        kind: 'choose_calendar',
        payload: {
          calendarChoices,
          visibleCalendarChoiceCount: choicePrompt.visibleCount,
          attendees: inviteeContext.invitees,
          unresolvedInvitees: inviteeContext.unresolvedNames,
          scheduleRequest: {
            title: scheduleIntent.title,
            baseDate: scheduleIntent.baseDate.toISOString(),
            dateWindow: serializeDateWindow(scheduleIntent.dateWindow),
            exactTime: scheduleIntent.exactTime,
            durationMinutes: scheduleDurationMinutes,
            recurrence: scheduleIntent.recurrence,
            location: scheduleIntent.location,
            serviceConfirmed: userAlreadyConfirmedServiceBooking(intentBody),
          },
        },
      })

      const reply = choicePrompt.reply
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    const chosenCalendar =
      placement.matches[0] ||
      placement.bookingCalendars[0]

    if (looksExternalScheduleRequest(scheduleIntent.title) && !userAlreadyConfirmedServiceBooking(intentBody)) {
      const reply = await prepareExternalScheduleCallPrep({
        profile,
        smsFrom: from,
        title: scheduleIntent.title,
        baseDate: scheduleIntent.baseDate,
        exactTime: scheduleIntent.exactTime,
        durationMinutes: scheduleDurationMinutes,
        dateWindow: scheduleIntent.dateWindow,
        chosenCalendar,
      })
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    if (scheduleIntent.exactTime && !scheduleIntent.recurrence && chosenCalendar) {
      const reply = await maybeConfirmExactScheduleTime({
        profile,
        smsFrom: from,
        title: scheduleIntent.title,
        baseDate: scheduleIntent.baseDate,
        exactTime: scheduleIntent.exactTime,
        durationMinutes: scheduleDurationMinutes,
        chosenCalendar,
        calendarHint: scheduleIntent.calendarHint,
        recurrence: scheduleIntent.recurrence,
        location: scheduleIntent.location,
        attendees: inviteeContext.invitees,
        unresolvedInvitees: inviteeContext.unresolvedNames,
      })

      if (reply) {
        await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
        return reply
      }
    }

    const options = await findScheduleOptionsAcrossWindow({
      profileId: profile.id,
      title: scheduleIntent.title,
      baseDate: scheduleIntent.baseDate,
      exactTime: scheduleIntent.exactTime,
      calendarId: chosenCalendar?.calendarId,
      calendarHint: chosenCalendar?.calendarLabel || scheduleIntent.calendarHint,
      durationMinutes: scheduleDurationMinutes,
      recurrence: scheduleIntent.recurrence,
      location: scheduleIntent.location,
      dateWindow: scheduleIntent.dateWindow,
      timeZone: profile.timezone,
    })

    if (!options.length) {
      const reply = await noOpeningScheduleReply({
        profile,
        smsFrom: from,
        title: scheduleIntent.title,
        baseDate: scheduleIntent.baseDate,
        exactTime: scheduleIntent.exactTime,
        durationMinutes: scheduleDurationMinutes,
        dateWindow: scheduleIntent.dateWindow,
        chosenCalendar,
        location: scheduleIntent.location,
        recurrence: scheduleIntent.recurrence,
        attendees: inviteeContext.invitees,
        unresolvedInvitees: inviteeContext.unresolvedNames,
        calendarLabel: chosenCalendar?.calendarLabel || null,
      })
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    await storeScheduleOptionsPending({
      profileId: profile.id,
      smsFrom: from,
      options,
      attendees: inviteeContext.invitees,
      unresolvedInvitees: inviteeContext.unresolvedNames,
      scheduleRequest: {
        title: scheduleIntent.title,
        baseDate: scheduleIntent.baseDate.toISOString(),
        dateWindow: serializeDateWindow(scheduleIntent.dateWindow),
        exactTime: scheduleIntent.exactTime,
        durationMinutes: scheduleDurationMinutes,
        recurrence: scheduleIntent.recurrence,
        location: scheduleIntent.location,
        serviceConfirmed: userAlreadyConfirmedServiceBooking(intentBody),
      },
    })

    const reply = scheduleOptionsReply({
      options,
      recurrence: scheduleIntent.recurrence,
      attendees: inviteeContext.invitees,
      unresolvedInvitees: inviteeContext.unresolvedNames,
    })
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (intent.type === 'reschedule') {
    const preferredDay = agendaDayForBaseDate(intent.baseDate, profile.timezone)
    const fallbackDay = preferredDay === 'today' ? 'tomorrow' : 'today'
    const preferredEvents = await listAgenda(profile.id, preferredDay, profile.timezone)
    const fallbackEvents = await listAgenda(profile.id, fallbackDay, profile.timezone)
    const upcomingEvents = await searchUpcomingEvents(profile.id, profile.timezone)
    const nearbyEvents = sortEventsByStart([...preferredEvents, ...fallbackEvents])
    const candidateEvents = sortEventsByStart(uniqueEvents([...nearbyEvents, ...upcomingEvents]))
    const target =
      contextualEventTarget(activePending, intent.query) ||
      findEventByQuery(preferredEvents, intent.query) ||
      findEventByQuery(nearbyEvents, intent.query) ||
      findEventByQuery(candidateEvents, intent.query)

    if (!target) {
      const matchedUpcomingEvents = matchingEventsByQuery(candidateEvents, intent.query)
      const topEvents = (matchedUpcomingEvents.length ? matchedUpcomingEvents : candidateEvents).slice(0, 3)
      if (!topEvents.length) {
        const reply = "I don't see anything to move there."
        await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
        return reply
      }

      await storePendingAction({
        profileId: profile.id,
        smsFrom: from,
        kind: 'select_reschedule_target',
        payload: {
          events: topEvents,
          requestedBaseDate: intent.dateWindow ? intent.baseDate.toISOString() : undefined,
          exactTime: intent.exactTime,
        },
      })

      const reply = `Which one should I move?\n${topEvents
        .map((event, index) => `${index + 1}. ${event.timeLabel} ${event.title}`)
        .join('\n')}\nReply 1, 2, or 3.`
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    const { authority, contact } = await classifyTargetEvent(profile, target)
    const rescheduleBaseDate = rescheduleBaseDateForTarget({
      requestedBaseDate: intent.baseDate,
      explicitDateRequested: Boolean(intent.dateWindow),
      exactTime: intent.exactTime,
      target,
      timeZone: profile.timezone,
    })

    if (authority === 'external_appointment') {
      const reply = await prepareExternalCallPrep({
        profile,
        smsFrom: from,
        target,
        baseDate: rescheduleBaseDate,
        exactTime: intent.exactTime,
        contact,
      })
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    if (authority === 'invited_meeting' || authority === 'unknown') {
      const reply = await prepareInvitedReschedule({
        profile,
        smsFrom: from,
        target,
        baseDate: rescheduleBaseDate,
        exactTime: intent.exactTime,
      })
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    if (isRecurringEvent(target)) {
      const reply = await prepareRecurringRescheduleScope({
        profileId: profile.id,
        smsFrom: from,
        target,
        authority,
        baseDate: rescheduleBaseDate,
        exactTime: intent.exactTime,
      })
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    const options = await findScheduleOptions({
      profileId: profile.id,
      title: target.title,
      baseDate: rescheduleBaseDate,
      exactTime: intent.exactTime,
      calendarHint: target.calendarName,
      durationMinutes: eventDurationMinutes(target),
      location: target.location || null,
    })

    if (!options.length) {
      const reply = `I found ${target.title}, but I could not find an opening to move it. Try another day or time.`
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    await storePendingAction({
      profileId: profile.id,
      smsFrom: from,
      kind: 'reschedule',
      payload: { target, options, authority },
    })

    const reply = `I can move ${target.title} to:\n${optionList(options)}\nReply 1, 2, or 3.`
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (intent.type === 'cancel') {
    const events = await searchUpcomingEvents(profile.id, profile.timezone)
    const matches = matchingEventsByQuery(events, intent.query)
    if (!matches.length) {
      const reply = "I couldn't find that event. Try the event name plus a day or time, like: cancel haircut Wednesday."
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    if (matches.length > 1) {
      const topEvents = matches.slice(0, 3)
      await storePendingAction({
        profileId: profile.id,
        smsFrom: from,
        kind: 'select_cancel_target',
        payload: { events: topEvents },
      })
      const reply = `Which one should I cancel?\n${topEvents
        .map((event, index) => `${index + 1}. ${eventDateLabel(event, profile.timezone)} ${event.title}`)
        .join('\n')}\nReply 1, 2, or 3.`
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    const reply = await cancelCalendarTarget({ profile, target: matches[0], smsFrom: from })
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  const reply = activePending
    ? `I didn't quite follow that. You can say things like "schedule a call Thursday at 2pm" or "what's on my calendar today?"\nIf you want to drop the current request and start fresh, say "start over."`
    : `I didn't quite follow that. You can say things like "schedule a call Thursday at 2pm" or "what's on my calendar today?"`
  await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
  return reply
}
