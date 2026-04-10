import {
  addMinutes,
  formatSmsDate,
  formatSmsTime,
  nextDateForWeekday,
  overlaps,
  setTime,
  startOfDay,
} from '../calendar/dates'
import { recurrenceSummary, type RecurrenceSpec } from '../calendar/recurrence'
import {
  classifyEventAuthority,
  looksExternalAppointment,
  type EventAuthority,
} from '../eventAuthority'
import {
  inviteeLabel,
  parseInviteesFromText,
  resolveInviteeFollowUp,
  type Invitee,
} from './invitees'
import { resolvePendingChoice } from './pendingChoice'
import { parseSmsIntent, parseSmsTime, type ParsedSmsIntent } from './parser'

export type SimulatorMessage = {
  role: 'user' | 'manoa'
  text: string
}

export type SimulatorEvent = {
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

export type SimulatorOption = {
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

type SimulatorBusinessContact = {
  label: string
  phoneE164: string
  aliases: string[]
}

type SimulatorPersonContact = {
  label: string
  email: string
  aliases: string[]
}

type PendingKind =
  | 'schedule'
  | 'resolve_invitees'
  | 'reschedule'
  | 'select_reschedule_target'
  | 'invited_reschedule_action'
  | 'invited_reschedule_hold'
  | 'invited_cancel_action'
  | 'external_call_prep'
  | 'external_cancel_confirm'
  | 'external_reschedule_confirm'
  | 'save_business_contact_phone'

type PendingPayload = {
  options?: SimulatorOption[]
  selectedOption?: SimulatorOption
  events?: SimulatorEvent[]
  target?: SimulatorEvent
  businessName?: string
  phoneE164?: string | null
  callNote?: string
  requestedBaseDate?: string
  exactTime?: { hour: number; minute: number } | null
  authority?: EventAuthority
  followUpKind?: PendingKind | null
  holdEventId?: string | null
  holdCalendarId?: string | null
  attendees?: Invitee[]
  unresolvedInvitees?: string[]
}

export type SimulatorPending = {
  kind: PendingKind
  payload: PendingPayload
}

export type SimulatorDebug = {
  intent: string
  branch: string
  matchedEvent?: string
  authority?: EventAuthority
  understoodBy?: 'AI' | 'Fallback parser'
  notes: string[]
}

export type SimulatorState = {
  recognized: boolean
  subscriptionActive: boolean
  calendarConnected: boolean
  smsEnabled: boolean
  profile: {
    email: string
    phoneE164: string
  }
  messages: SimulatorMessage[]
  todayEvents: SimulatorEvent[]
  tomorrowEvents: SimulatorEvent[]
  businessContacts: SimulatorBusinessContact[]
  peopleContacts: SimulatorPersonContact[]
  pending: SimulatorPending | null
  backgroundPending: SimulatorPending | null
  lastDebug: SimulatorDebug | null
  nextId: number
}

type SimulatorResult = {
  state: SimulatorState
  reply: string
  debug: SimulatorDebug
}

const stopWords = new Set(['stop', 'stopall', 'unsubscribe', 'cancelall', 'end', 'quit'])
const startWords = new Set(['start', 'unstop'])
const weekdayNumbers: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

function normalizePhone(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return ''

  const digits = trimmed.replace(/[^\d]/g, '')
  if (trimmed.startsWith('+')) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

function extractPhone(text: string) {
  const match = text.match(
    /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/,
  )
  if (!match) return null

  const normalized = normalizePhone(match[0])
  return normalized.length >= 8 ? normalized : null
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function createSeedEvent({
  id,
  dayOffset,
  hour,
  minute,
  durationMinutes,
  title,
  calendarName,
  organizerEmail = '',
  attendeeCount = 0,
  location = '',
  description = '',
}: {
  id: string
  dayOffset: 0 | 1
  hour: number
  minute: number
  durationMinutes: number
  title: string
  calendarName: string
  organizerEmail?: string
  attendeeCount?: number
  location?: string
  description?: string
}): SimulatorEvent {
  const start = setTime(startOfDay(dayOffset), { hour, minute })
  const end = addMinutes(start, durationMinutes)

  return {
    id,
    title,
    start: start.toISOString(),
    end: end.toISOString(),
    calendarId: 'primary',
    calendarName,
    timeLabel: formatSmsTime(start),
    location,
    description,
    organizerEmail,
    attendeeCount,
  }
}

export function createInitialSimulatorState(): SimulatorState {
  return {
    recognized: true,
    subscriptionActive: true,
    calendarConnected: true,
    smsEnabled: true,
    profile: {
      email: 'justin@example.com',
      phoneE164: '+17155551234',
    },
    messages: [
      {
        role: 'manoa',
        text:
          'Internal preview is on. Try: book budget review with Sam and Priya Tuesday at 2pm, what does tomorrow look like, reschedule my dentist appointment, or STOP.',
      },
    ],
    todayEvents: [
      createSeedEvent({
        id: 'evt-1',
        dayOffset: 0,
        hour: 9,
        minute: 0,
        durationMinutes: 30,
        title: 'Team standup',
        calendarName: 'Work',
        organizerEmail: 'justin@example.com',
        attendeeCount: 4,
      }),
      createSeedEvent({
        id: 'evt-2',
        dayOffset: 0,
        hour: 13,
        minute: 30,
        durationMinutes: 45,
        title: 'Dentist cleaning',
        calendarName: 'Personal',
        location: 'Patel Dental, (312) 555-0189',
        description: 'Routine cleaning',
      }),
      createSeedEvent({
        id: 'evt-3',
        dayOffset: 0,
        hour: 16,
        minute: 0,
        durationMinutes: 30,
        title: 'School pickup',
        calendarName: 'Family',
      }),
    ],
    tomorrowEvents: [
      createSeedEvent({
        id: 'evt-4',
        dayOffset: 1,
        hour: 10,
        minute: 0,
        durationMinutes: 60,
        title: 'Budget review',
        calendarName: 'Work',
        organizerEmail: 'boss@example.com',
        attendeeCount: 3,
      }),
      createSeedEvent({
        id: 'evt-5',
        dayOffset: 1,
        hour: 15,
        minute: 0,
        durationMinutes: 60,
        title: 'Client review',
        calendarName: 'Work',
        organizerEmail: 'justin@example.com',
        attendeeCount: 5,
      }),
      createSeedEvent({
        id: 'evt-6',
        dayOffset: 1,
        hour: 17,
        minute: 30,
        durationMinutes: 50,
        title: 'Therapy intake',
        calendarName: 'Personal',
        location: 'Lakeside Therapy',
        description: 'New patient intake',
      }),
    ],
    businessContacts: [
      {
        label: 'Dentist',
        phoneE164: '+13125550189',
        aliases: ['patel dental', 'dentist', 'cleaning'],
      },
    ],
    peopleContacts: [
      {
        label: 'Sam',
        email: 'sam@company.com',
        aliases: ['sam', 'sam lee'],
      },
      {
        label: 'Alex',
        email: 'alex@company.com',
        aliases: ['alex', 'alex kim'],
      },
    ],
    pending: null,
    backgroundPending: null,
    lastDebug: null,
    nextId: 100,
  }
}

function addMessage(state: SimulatorState, role: 'user' | 'manoa', text: string) {
  return {
    ...state,
    messages: [...state.messages, { role, text }],
  }
}

function describeIntent(intent: ParsedSmsIntent) {
  switch (intent.type) {
    case 'choice':
      return `choice ${intent.choice}`
    case 'agenda':
      return `agenda ${intent.day}`
    case 'schedule':
      return `${intent.recurrence ? 'recurring ' : ''}schedule ${intent.title}`
    case 'reschedule':
      return `reschedule ${intent.query}`
    case 'cancel':
      return `cancel ${intent.query}`
    default:
      return 'unknown'
  }
}

function optionList(options: SimulatorOption[]) {
  return options
    .map((option, index) => `${index + 1}. ${option.dayLabel} at ${option.timeLabel} on ${option.calendarName}`)
    .join('\n')
}

function callPrepOptionList(options: SimulatorOption[]) {
  return options
    .map((option, index) => `${index + 1}. ${option.dayLabel} at ${option.timeLabel}`)
    .join('\n')
}

function recurrenceLine(options: SimulatorOption[]) {
  const firstOption = options[0]
  const summary = recurrenceSummary(firstOption?.recurrence, firstOption?.start || '')
  return summary || null
}

function bookingText(option: SimulatorOption) {
  const summary = recurrenceSummary(option.recurrence, option.start)
  if (summary) {
    return `Booked ${option.title} starting ${option.dayLabel} at ${option.timeLabel}.\n${summary}`
  }

  return `Booked ${option.title} for ${option.dayLabel} at ${option.timeLabel}.`
}

function agendaText(day: 'today' | 'tomorrow', events: SimulatorEvent[]) {
  if (!events.length) {
    return day === 'tomorrow' ? "Tomorrow's schedule is clear." : "You're clear today."
  }

  const heading = day === 'tomorrow' ? "Tomorrow's schedule:" : 'Today:'
  return `${heading}\n${events.map((event) => `${event.timeLabel} ${event.title} (${event.calendarName})`).join('\n')}`
}

function eventDateLabel(event: SimulatorEvent) {
  const start = new Date(event.start)
  return `${formatSmsDate(start)} at ${formatSmsTime(start)}`
}

function eventDurationMinutes(event: SimulatorEvent) {
  const start = new Date(event.start).getTime()
  const end = new Date(event.end).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 30
  return Math.max(15, Math.round((end - start) / 60_000))
}

function findEventsForDay(state: SimulatorState, day: 'today' | 'tomorrow') {
  return day === 'today' ? state.todayEvents : state.tomorrowEvents
}

function dayForDate(date: Date): 'today' | 'tomorrow' {
  return date.toDateString() === startOfDay(0).toDateString() ? 'today' : 'tomorrow'
}

function replaceEventsForDay(state: SimulatorState, day: 'today' | 'tomorrow', events: SimulatorEvent[]) {
  return day === 'today' ? { ...state, todayEvents: events } : { ...state, tomorrowEvents: events }
}

function choose<T>(items: T[] | undefined, choice: number) {
  return items?.[choice - 1] || null
}

function isShortAcknowledgement(text: string) {
  const lower = text.trim().toLowerCase()
  return (
    lower.split(/\s+/).length <= 4 &&
    /\b(ok|okay|got it|sounds good|cool|thanks|thank you|perfect|nice)\b/.test(lower)
  )
}

function reminderForPending(pending: SimulatorPending) {
  switch (pending.kind) {
    case 'schedule':
    case 'reschedule':
    case 'invited_reschedule_hold':
    case 'external_call_prep':
      return 'Reply with the option you want, like 1, 2, or 3.'
    case 'select_reschedule_target':
      return 'Reply with which one you mean, like 1, 2, or 3.'
    case 'invited_reschedule_action':
      return 'Reply 1 to hold a time, 2 for a draft to the organizer, or 3 to keep it.'
    case 'invited_cancel_action':
      return 'Reply 1 to remove it from your calendar, 2 for a draft message, or 3 to keep it.'
    case 'resolve_invitees':
      return 'Reply with the missing email, like "Priya priya@company.com", or say "book it without invites."'
    case 'save_business_contact_phone':
      return "Reply with the office number, or say SKIP if you don't want to save it yet."
    default:
      return 'Tell me what you want to do next.'
  }
}

function contactMatches(contact: SimulatorBusinessContact, query: string) {
  const queryWords = tokenize(query)
  if (!queryWords.length) return false

  const haystacks = [contact.label, ...contact.aliases].map((value) => value.toLowerCase())
  return (
    queryWords.some((word) => haystacks.some((value) => value.includes(word))) ||
    haystacks.some((value) => queryWords.every((word) => value.includes(word)))
  )
}

function inferBusinessContact(state: SimulatorState, event: SimulatorEvent) {
  const saved =
    state.businessContacts.find((contact) =>
      contactMatches(contact, [event.title, event.location, event.description].join(' ')),
    ) || null
  if (saved) {
    return {
      label: saved.label,
      phone_e164: saved.phoneE164,
    }
  }

  const inferredPhone = extractPhone(`${event.description}\n${event.location}`)
  if (!inferredPhone) return null

  return {
    label: event.title,
    phone_e164: inferredPhone,
  }
}

export function classifySimulatorEvent(state: SimulatorState, event: SimulatorEvent): EventAuthority {
  return classifyEventAuthority({
    event,
    profileEmail: state.profile.email,
    businessContact: inferBusinessContact(state, event)
      ? ({
          id: '',
          profile_id: '',
          label: event.title,
          phone_e164: inferBusinessContact(state, event)?.phone_e164 || '',
          category: 'business',
          notes: null,
          aliases: null,
        } as never)
      : null,
  })
}

function findEventByQuery(events: SimulatorEvent[], query: string) {
  return bestEventByQuery(events, query)
}

function findScheduleOptions({
  state,
  title,
  baseDate,
  exactTime,
  calendarHint,
  durationMinutes = 30,
  recurrence = null,
}: {
  state: SimulatorState
  title: string
  baseDate: Date
  exactTime?: { hour: number; minute: number } | null
  calendarHint?: string
  durationMinutes?: number
  recurrence?: RecurrenceSpec | null
}) {
  const day = dayForDate(baseDate)
  const events = findEventsForDay(state, day)
  const busy = events.map((event) => ({
    start: new Date(event.start),
    end: new Date(event.end),
  }))

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

  return candidateStarts
    .map((start) => ({
      start,
      end: addMinutes(start, durationMinutes),
    }))
    .filter((candidate) => !overlaps(candidate, busy))
    .slice(0, 3)
    .map<SimulatorOption>((candidate) => ({
      title,
      start: candidate.start.toISOString(),
      end: candidate.end.toISOString(),
      calendarId: 'primary',
      calendarName: calendarHint || 'Google Calendar',
      dayLabel: formatSmsDate(candidate.start),
      timeLabel: formatSmsTime(candidate.start),
      recurrence,
    }))
}

function buildCallNote(target: SimulatorEvent, options: SimulatorOption[]) {
  const bestTimes = options.map((option) => `${option.dayLabel} ${option.timeLabel}`).join(', ')
  return `Need to move ${target.title} from ${eventDateLabel(target)}. Best times: ${bestTimes}.`
}

function buildCancelNote(target: SimulatorEvent) {
  return `Need to cancel ${target.title} scheduled for ${eventDateLabel(target)}.`
}

function referencesExternalTarget(
  text: string,
  target?: SimulatorEvent | null,
  businessName?: string | null,
) {
  const lower = text.trim().toLowerCase()
  if (/\b(it|that|appointment|visit|booking)\b/.test(lower)) return true

  const targetTokens = [target?.title, businessName, target?.location]
    .flatMap((value) => tokenize(value || ''))
    .filter((token) => token.length > 2)

  return targetTokens.some((token) => lower.includes(token))
}

function confirmsExternalCancellation(
  text: string,
  target?: SimulatorEvent | null,
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
  target?: SimulatorEvent | null,
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
  target?: SimulatorEvent | null,
  businessName?: string | null,
) {
  const lower = text.trim().toLowerCase()
  return (
    referencesExternalTarget(lower, target, businessName) &&
    /\b(couldn'?t do|couldnt do|no openings|no availability|nothing available|didn'?t work|didnt work|not available)\b/.test(lower)
  )
}

function parseExternalFollowUpDate(text: string) {
  const lower = text.toLowerCase()
  if (/\btoday\b/.test(lower)) return startOfDay(0)
  if (/\btomorrow'?s?\b|\btmrw\b|\btomororws?\b/.test(lower)) return startOfDay(1)

  const dayMatch = lower.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)
  if (!dayMatch) return null
  return nextDateForWeekday(weekdayNumbers[dayMatch[1]])
}

function parseExternalRescheduleConfirmation(
  text: string,
  target?: SimulatorEvent | null,
  businessName?: string | null,
) {
  const lower = text.trim().toLowerCase()
  const referencesTarget = referencesExternalTarget(lower, target, businessName)
  const exactTime = parseSmsTime(text)
  const explicitDate = parseExternalFollowUpDate(text)
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

function buildOrganizerRescheduleDraft(target: SimulatorEvent, options: SimulatorOption[]) {
  const bestTimes = options.map((option) => `${option.dayLabel} ${option.timeLabel}`).join(', ')
  return `Draft: Hi, I need to move ${target.title}. I can do ${bestTimes}. Let me know what works.`
}

function buildOrganizerCancelDraft(target: SimulatorEvent) {
  return `Draft: Hi, I need to decline ${target.title} scheduled for ${eventDateLabel(target)}.`
}

const queryNoiseWords = new Set([
  'the',
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
])

function queryWords(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((word) => !queryNoiseWords.has(word))
}

function eventMatchScore(event: SimulatorEvent, words: string[]) {
  if (!words.length) return 0
  const haystack = [event.title, event.location, event.description].join(' ').toLowerCase()
  return words.reduce((score, word) => (haystack.includes(word) ? score + 1 : score), 0)
}

function sortEventsByStart<T extends { start: string }>(events: T[]) {
  return [...events].sort((left, right) => {
    return new Date(left.start).getTime() - new Date(right.start).getTime()
  })
}

function matchingEventsByQuery(events: SimulatorEvent[], query: string) {
  const words = queryWords(query)
  if (!words.length) return []

  const scored = events
    .map((event) => ({
      event,
      score: eventMatchScore(event, words),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      return new Date(left.event.start).getTime() - new Date(right.event.start).getTime()
    })

  return scored.map((item) => item.event)
}

function bestEventByQuery(events: SimulatorEvent[], query: string) {
  const matches = matchingEventsByQuery(events, query)
  if (!matches.length) return null
  if (matches.length === 1) return matches[0]

  const words = queryWords(query)
  const topScore = eventMatchScore(matches[0], words)
  const topMatches = matches.filter((event) => eventMatchScore(event, words) === topScore)
  return topMatches.length === 1 ? topMatches[0] : null
}

function inviteeSummary(invitees: Invitee[]) {
  return invitees.map((invitee) => inviteeLabel(invitee)).join(', ')
}

function unresolvedInviteeSummary(names: string[]) {
  return names.join(', ')
}

function resolveScheduleInvitees(state: SimulatorState, body: string) {
  const parsed = parseInviteesFromText(body)
  const resolvedInvitees = [...parsed.directInvitees]
  const unresolvedNames: string[] = []

  for (const name of parsed.names) {
    const match = state.peopleContacts.find((contact) => contactMatches({
      label: contact.label,
      phoneE164: '',
      aliases: contact.aliases,
    }, name))

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

function withPending(state: SimulatorState, pending: SimulatorPending | null) {
  return { ...state, pending }
}

function withBackgroundPending(state: SimulatorState, backgroundPending: SimulatorPending | null) {
  return { ...state, backgroundPending }
}

function addCalendarEventFromOptionDetailed(state: SimulatorState, option: SimulatorOption) {
  const start = new Date(option.start)
  const event: SimulatorEvent = {
    id: `evt-${state.nextId}`,
    title: option.title,
    start: option.start,
    end: option.end,
    calendarId: option.calendarId,
    calendarName: option.calendarName,
    timeLabel: formatSmsTime(start),
    location: '',
    description: recurrenceSummary(option.recurrence, option.start) || '',
    organizerEmail: state.profile.email,
    attendeeCount: option.attendees?.length || 0,
  }

  const day = dayForDate(start)
  const nextState = replaceEventsForDay(state, day, [...findEventsForDay(state, day), event])
  return { state: { ...nextState, nextId: state.nextId + 1 }, event }
}

function addCalendarEventFromOption(state: SimulatorState, option: SimulatorOption) {
  return addCalendarEventFromOptionDetailed(state, option).state
}

function moveCalendarEvent(state: SimulatorState, target: SimulatorEvent, option: SimulatorOption) {
  const targetDay = dayForDate(new Date(target.start))
  const withoutTarget = replaceEventsForDay(
    state,
    targetDay,
    findEventsForDay(state, targetDay).filter((event) => event.id !== target.id),
  )

  const movedEvent: SimulatorEvent = {
    ...target,
    start: option.start,
    end: option.end,
    calendarName: option.calendarName,
    calendarId: option.calendarId,
    timeLabel: formatSmsTime(new Date(option.start)),
  }

  const nextDay = dayForDate(new Date(option.start))
  return replaceEventsForDay(withoutTarget, nextDay, [...findEventsForDay(withoutTarget, nextDay), movedEvent])
}

function optionFromExactExternalTime(
  target: SimulatorEvent,
  baseDate: Date,
  exactTime: { hour: number; minute: number },
): SimulatorOption {
  const start = setTime(baseDate, exactTime)
  const end = addMinutes(start, eventDurationMinutes(target))
  return {
    title: target.title,
    start: start.toISOString(),
    end: end.toISOString(),
    calendarId: target.calendarId,
    calendarName: target.calendarName,
    dayLabel: formatSmsDate(start),
    timeLabel: formatSmsTime(start),
  }
}

function removeCalendarEvent(state: SimulatorState, target: SimulatorEvent) {
  const day = dayForDate(new Date(target.start))
  return replaceEventsForDay(
    state,
    day,
    findEventsForDay(state, day).filter((event) => event.id !== target.id),
  )
}

function removeCalendarEventById(state: SimulatorState, eventId: string) {
  return {
    ...state,
    todayEvents: state.todayEvents.filter((event) => event.id !== eventId),
    tomorrowEvents: state.tomorrowEvents.filter((event) => event.id !== eventId),
  }
}

function prepareExternalCallPrep(
  state: SimulatorState,
  target: SimulatorEvent,
  baseDate: Date,
  exactTime: { hour: number; minute: number } | null,
) {
  const contact = inferBusinessContact(state, target)
  const businessName = contact?.label || target.title
  const options = findScheduleOptions({
    state,
    title: `Call ${businessName} to reschedule`,
    baseDate,
    exactTime,
    calendarHint: 'Personal',
    durationMinutes: 20,
  })

  if (!options.length) {
    return {
      state,
      reply: `I found ${target.title}, but I could not find a good time for the call. Try another day or time.`,
      authority: 'external_appointment' as EventAuthority,
    }
  }

  const callNote = buildCallNote(target, options)
  const nextState = withPending(state, {
    kind: 'external_call_prep',
    payload: {
      target,
      options,
      businessName,
      phoneE164: contact?.phone_e164 || null,
      callNote,
      requestedBaseDate: baseDate.toISOString(),
      exactTime,
      authority: 'external_appointment',
    },
  })

  let reply = `I can't change ${target.title} with the office by text, but I can get you ready to call.\nHere are your next openings:\n${callPrepOptionList(options)}\nReply 1, 2, or 3 and I'll hold that time for your call.`

  if (contact?.phone_e164) {
    reply += `\nOffice number: ${contact.phone_e164}.`
  }

  reply += `\nCall note: ${callNote}`
  return {
    state: nextState,
    reply,
    authority: 'external_appointment' as EventAuthority,
  }
}

function handleChoice(state: SimulatorState, choice: number): SimulatorResult {
  const pending = state.pending
  if (!pending) {
    return finalizeTurn(
      state,
      'I can schedule, reschedule, cancel, or send your agenda. Try: 9am meeting Tuesday on work calendar.',
      {
        intent: `choice ${choice}`,
        branch: 'No pending action',
        notes: ['The agent only treats 1, 2, or 3 as choices when it is waiting on a previous step.'],
      },
    )
  }

  if (pending.kind === 'schedule') {
    const option = choose(pending.payload.options, choice)
    if (!option) {
      return finalizeTurn(state, 'Reply with 1, 2, or 3.', {
        intent: `choice ${choice}`,
        branch: 'Schedule choice',
        notes: ['The selected option was out of range.'],
      })
    }

    const attendees = pending.payload.attendees || []
    const unresolvedInvitees = pending.payload.unresolvedInvitees || []

    if (unresolvedInvitees.length) {
      const nextState = withPending(state, {
        kind: 'resolve_invitees',
        payload: {
          selectedOption: option,
          attendees,
          unresolvedInvitees,
        },
      })

      return finalizeTurn(nextState, `I can send the invite, but I still need email${
        unresolvedInvitees.length > 1 ? 's' : ''
      } for ${unresolvedInviteeSummary(unresolvedInvitees)}.\nReply like "Priya priya@company.com" or say "book it without invites."`, {
        intent: `choice ${choice}`,
        branch: 'Need invitee emails',
        notes: ['The time is picked, but the simulator still needs one or more attendee emails before it can send invites.'],
      })
    }

    const nextState = withPending(
      addCalendarEventFromOption(state, {
        ...option,
        attendees,
      }),
      null,
    )
    return finalizeTurn(nextState, attendees.length
      ? `${bookingText(option)}\nI invited ${inviteeSummary(attendees)} and I'll remind you before it starts.`
      : `${bookingText(option)}\nI'll remind you before it starts.`, {
      intent: `choice ${choice}`,
      branch: 'Booked scheduled option',
      notes: ['The simulator created a calendar event from the pending schedule options.'],
    })
  }

  if (pending.kind === 'select_reschedule_target') {
    const event = choose(pending.payload.events, choice)
    if (!event) {
      return finalizeTurn(state, 'Reply with 1, 2, or 3 for the meeting you want to move.', {
        intent: `choice ${choice}`,
        branch: 'Select reschedule target',
        notes: ['The selected event was out of range.'],
      })
    }

    const authority = classifySimulatorEvent(state, event)
    if (authority === 'external_appointment') {
      const prepared = prepareExternalCallPrep(state, event, startOfDay(1), null)
      return finalizeTurn(prepared.state, prepared.reply, {
        intent: `choice ${choice}`,
        branch: 'Reschedule target selected',
        matchedEvent: event.title,
        authority,
        notes: ['The event was classified as an external appointment, so Manoa prepared the call instead of pretending it moved the office booking.'],
      })
    }

    if (authority === 'invited_meeting' || authority === 'unknown') {
      const nextState = withPending(state, {
        kind: 'invited_reschedule_action',
        payload: {
          target: event,
          requestedBaseDate: startOfDay(1).toISOString(),
          exactTime: null,
          authority: 'invited_meeting',
        },
      })

      return finalizeTurn(nextState, `I can't move ${event.title} for everyone from your side.\nDo you want me to:\n1. Hold a new time on my calendar only\n2. Draft a message to the organizer\n3. Keep it and add a reminder`, {
        intent: `choice ${choice}`,
        branch: 'Invited meeting reschedule decision',
        matchedEvent: event.title,
        authority,
        notes: ['The event was not owned by the user, so Manoa offered safe next steps instead of moving it for everyone.'],
      })
    }

    const options = findScheduleOptions({
      state,
      title: event.title,
      baseDate: startOfDay(1),
      exactTime: null,
      calendarHint: event.calendarName,
      durationMinutes: eventDurationMinutes(event),
    })

    const nextState = withPending(state, {
      kind: 'reschedule',
      payload: {
        target: event,
        options,
        authority,
      },
    })

    return finalizeTurn(nextState, `I can move ${event.title} to one of these:\n${optionList(options)}\nReply 1, 2, or 3.`, {
      intent: `choice ${choice}`,
      branch: 'Reschedule options prepared',
      matchedEvent: event.title,
      authority,
      notes: ['The event was safe to move directly, so Manoa prepared new time choices.'],
    })
  }

  if (pending.kind === 'reschedule') {
    const option = choose(pending.payload.options, choice)
    const target = pending.payload.target
    if (!option || !target) {
      return finalizeTurn(state, 'Reply with 1, 2, or 3.', {
        intent: `choice ${choice}`,
        branch: 'Reschedule choice',
        notes: ['The simulator lost track of the target or option.'],
      })
    }

    const movedState = withPending(moveCalendarEvent(state, target, option), null)
    const sentUpdate = pending.payload.authority === 'owned_meeting'
    return finalizeTurn(
      movedState,
      sentUpdate
        ? `Moved ${target.title} to ${option.dayLabel} at ${option.timeLabel} and sent the update.`
        : `Moved ${target.title} to ${option.dayLabel} at ${option.timeLabel}.`,
      {
        intent: `choice ${choice}`,
        branch: 'Event rescheduled',
        matchedEvent: target.title,
        authority: pending.payload.authority,
        notes: [
          sentUpdate
            ? 'Because the user owns this meeting, the simulator shows the attendee update path.'
            : 'Because this is not an owned meeting with attendees, the simulator moved only the calendar event.',
        ],
      },
    )
  }

  if (pending.kind === 'invited_reschedule_action') {
    const target = pending.payload.target
    if (!target) {
      return finalizeTurn(state, 'Send the request again and I will pick it up.', {
        intent: `choice ${choice}`,
        branch: 'Invited meeting action',
        notes: ['The simulator lost the target meeting.'],
      })
    }

    if (choice === 1) {
      const options = findScheduleOptions({
        state,
        title: `Tentative: ${target.title}`,
        baseDate: pending.payload.requestedBaseDate
          ? new Date(pending.payload.requestedBaseDate)
          : startOfDay(1),
        exactTime: pending.payload.exactTime || null,
        calendarHint: 'Personal',
        durationMinutes: eventDurationMinutes(target),
      })

      const nextState = withPending(state, {
        kind: 'invited_reschedule_hold',
        payload: {
          target,
          options,
          authority: 'invited_meeting',
        },
      })

      return finalizeTurn(nextState, `I can hold one of these times on your calendar while you coordinate with the organizer:\n${optionList(options)}\nReply 1, 2, or 3.`, {
        intent: `choice ${choice}`,
        branch: 'Invited meeting hold options',
        matchedEvent: target.title,
        authority: 'invited_meeting',
        notes: ['This keeps the real meeting untouched and only creates a personal hold once you choose a slot.'],
      })
    }

    if (choice === 2) {
      const options = findScheduleOptions({
        state,
        title: target.title,
        baseDate: pending.payload.requestedBaseDate
          ? new Date(pending.payload.requestedBaseDate)
          : startOfDay(1),
        exactTime: pending.payload.exactTime || null,
        calendarHint: target.calendarName,
        durationMinutes: eventDurationMinutes(target),
      })
      const nextState = withPending(state, null)
      return finalizeTurn(nextState, buildOrganizerRescheduleDraft(target, options.slice(0, 3)), {
        intent: `choice ${choice}`,
        branch: 'Organizer draft',
        matchedEvent: target.title,
        authority: 'invited_meeting',
        notes: ['The simulator drafted a message instead of moving a meeting you do not own.'],
      })
    }

    if (choice === 3) {
      const nextState = withPending(state, null)
      return finalizeTurn(nextState, `Okay. I left ${target.title} alone and will remind you before it starts.`, {
        intent: `choice ${choice}`,
        branch: 'Keep invited meeting',
        matchedEvent: target.title,
        authority: 'invited_meeting',
        notes: ['The user chose not to move the invited meeting.'],
      })
    }
  }

  if (pending.kind === 'invited_reschedule_hold') {
    const option = choose(pending.payload.options, choice)
    const target = pending.payload.target
    if (!option || !target) {
      return finalizeTurn(state, 'Reply with 1, 2, or 3.', {
        intent: `choice ${choice}`,
        branch: 'Invited hold selection',
        notes: ['The selected hold option was out of range.'],
      })
    }

    const nextState = withPending(addCalendarEventFromOption(state, option), null)
    return finalizeTurn(nextState, `Held ${option.dayLabel} at ${option.timeLabel} on your calendar for ${target.title}. The organizer still needs to confirm the real meeting move.`, {
      intent: `choice ${choice}`,
      branch: 'Tentative hold created',
      matchedEvent: target.title,
      authority: 'invited_meeting',
      notes: ['A personal hold was created instead of changing the original invited meeting.'],
    })
  }

  if (pending.kind === 'invited_cancel_action') {
    const target = pending.payload.target
    if (!target) {
      return finalizeTurn(state, 'Send the cancel request again and I will pick it up.', {
        intent: `choice ${choice}`,
        branch: 'Invited cancel action',
        notes: ['The simulator lost the target meeting.'],
      })
    }

    if (choice === 1) {
      const nextState = withPending(removeCalendarEvent(state, target), null)
      return finalizeTurn(nextState, `Removed ${target.title} from your calendar. I did not cancel it for everyone.`, {
        intent: `choice ${choice}`,
        branch: 'Remove invited meeting locally',
        matchedEvent: target.title,
        authority: 'invited_meeting',
        notes: ['This is the safe local-only cancellation path.'],
      })
    }

    if (choice === 2) {
      const nextState = withPending(state, null)
      return finalizeTurn(nextState, buildOrganizerCancelDraft(target), {
        intent: `choice ${choice}`,
        branch: 'Decline draft',
        matchedEvent: target.title,
        authority: 'invited_meeting',
        notes: ['The simulator drafted a decline instead of canceling for everyone.'],
      })
    }

    if (choice === 3) {
      const nextState = withPending(state, null)
      return finalizeTurn(nextState, `Okay. I left ${target.title} on your calendar.`, {
        intent: `choice ${choice}`,
        branch: 'Keep invited meeting',
        matchedEvent: target.title,
        authority: 'invited_meeting',
        notes: ['No changes were made.'],
      })
    }
  }

  if (pending.kind === 'external_call_prep') {
    const option = choose(pending.payload.options, choice)
    const target = pending.payload.target
    if (!option || !target) {
      return finalizeTurn(state, 'Reply with 1, 2, or 3.', {
        intent: `choice ${choice}`,
        branch: 'External appointment hold',
        notes: ['The selected call-prep slot was out of range.'],
      })
    }

    const holdCreated = addCalendarEventFromOptionDetailed(state, option)
    const holdState = holdCreated.state
    const callNote = pending.payload.callNote || buildCallNote(target, [option])
    const knownPhone = pending.payload.phoneE164 || null

    if (knownPhone) {
      const nextState = withBackgroundPending(
        withPending(holdState, null),
        {
          kind: 'external_reschedule_confirm',
          payload: {
            target,
            businessName: pending.payload.businessName || target.title,
            phoneE164: knownPhone,
            callNote,
            authority: 'external_appointment',
            holdEventId: holdCreated.event.id,
            holdCalendarId: option.calendarId,
          },
        },
      )
      return finalizeTurn(nextState, `Held ${option.dayLabel} at ${option.timeLabel} for your call about ${target.title}.\nOffice number: ${knownPhone}.\nCall note: ${callNote}\nWhen the office confirms the new time, text something like "They moved it to Tuesday at 2pm" and I'll update your calendar.\nYou can keep texting me other things in the meantime.`, {
        intent: `choice ${choice}`,
        branch: 'External call hold created',
        matchedEvent: target.title,
        authority: 'external_appointment',
        notes: ['A hold was created for the call, and the office number was already known.'],
      })
    }

    const nextState = withPending(holdState, {
      kind: 'save_business_contact_phone',
      payload: {
        target,
        businessName: pending.payload.businessName || target.title,
        callNote,
        authority: 'external_appointment',
        followUpKind: 'external_reschedule_confirm',
        holdEventId: holdCreated.event.id,
        holdCalendarId: option.calendarId,
      },
    })

    return finalizeTurn(nextState, `Held ${option.dayLabel} at ${option.timeLabel} for your call about ${target.title}.\nI don't have the office number yet. Reply with it and I'll save it for next time.\nCall note: ${callNote}\nWhen the office confirms the new time, text something like "They moved it to Tuesday at 2pm" and I'll update your calendar.`, {
      intent: `choice ${choice}`,
      branch: 'External call hold created',
      matchedEvent: target.title,
      authority: 'external_appointment',
      notes: ['A hold was created, but the simulator still needs the office number for future runs.'],
    })
  }

  if (pending.kind === 'external_cancel_confirm') {
    const target = pending.payload.target
    if (!target) {
      return finalizeTurn(state, 'Send the cancel request again and I will pick it up.', {
        intent: `choice ${choice}`,
        branch: 'External cancellation follow-up',
        notes: ['The simulator lost the target appointment.'],
      })
    }

    return finalizeTurn(state, `Once the office confirms the cancellation, text something like "I called and canceled it" and I'll clear ${target.title} from your calendar.`, {
      intent: `choice ${choice}`,
      branch: 'External cancellation follow-up',
      matchedEvent: target.title,
      authority: 'external_appointment',
      notes: ['This branch expects a natural-language confirmation, not a numbered choice.'],
    })
  }

  if (pending.kind === 'external_reschedule_confirm') {
    const target = pending.payload.target
    if (!target) {
      return finalizeTurn(state, 'Send the reschedule request again and I will pick it up.', {
        intent: `choice ${choice}`,
        branch: 'External reschedule follow-up',
        notes: ['The simulator lost the target appointment.'],
      })
    }

    return finalizeTurn(state, `When the office confirms the new time, text something like "They moved it to Tuesday at 2pm" and I'll update ${target.title} on your calendar.`, {
      intent: `choice ${choice}`,
      branch: 'External reschedule follow-up',
      matchedEvent: target.title,
      authority: 'external_appointment',
      notes: ['This branch expects a natural-language follow-up with the confirmed day and time.'],
    })
  }

  return finalizeTurn(state, 'I lost track of that request. Send it again?', {
    intent: `choice ${choice}`,
    branch: 'Lost pending state',
    notes: ['The simulator reached a pending branch it could not finish.'],
  })
}

function finalizeTurn(state: SimulatorState, reply: string, debug: SimulatorDebug): SimulatorResult {
  const nextState = addMessage({ ...state, lastDebug: debug }, 'manoa', reply)
  return {
    state: nextState,
    reply,
    debug,
  }
}

function runSimulatorTurnCore(
  state: SimulatorState,
  body: string,
  intent: ParsedSmsIntent,
): SimulatorResult {
  let nextState = addMessage(state, 'user', body)
  const lowerBody = body.trim().toLowerCase()

  if (stopWords.has(lowerBody)) {
    nextState = { ...nextState, smsEnabled: false, pending: null }
    return finalizeTurn(nextState, "You won't receive Manoa texts anymore. Reply START to turn them back on.", {
      intent: 'STOP',
      branch: 'Compliance command',
      notes: ['The simulator turned SMS off for this profile.'],
    })
  }

  if (startWords.has(lowerBody)) {
    if (!nextState.recognized) {
      return finalizeTurn(nextState, "I don't recognize this number yet. Sign up for Manoa first, then text START from this phone.", {
        intent: 'START',
        branch: 'Unknown number',
        notes: ['The number must already belong to a profile before START works.'],
      })
    }

    nextState = { ...nextState, smsEnabled: true }
    return finalizeTurn(nextState, 'Manoa texts are back on.', {
      intent: 'START',
      branch: 'Compliance command',
      notes: ['The simulator turned SMS back on for this profile.'],
    })
  }

  if (lowerBody === 'help') {
    return finalizeTurn(
      nextState,
      nextState.recognized
        ? 'Manoa can schedule, reschedule, cancel, and send your agenda. Reply STOP to opt out or START to opt back in.'
        : 'Sign up for Manoa first, then text this number from your saved phone.',
      {
        intent: 'HELP',
        branch: 'Help command',
        notes: ['This is the compliance help path.'],
      },
    )
  }

  if (!nextState.recognized) {
    return finalizeTurn(nextState, "I don't recognize this number yet. Sign up for Manoa first, then text START from this phone.", {
      intent: 'profile lookup',
      branch: 'Unknown number gate',
      notes: ['The backend always checks the sender phone number first.'],
    })
  }

  if (!nextState.smsEnabled) {
    return finalizeTurn(nextState, 'You are currently opted out. Reply START to turn Manoa texts back on.', {
      intent: 'opt-out status',
      branch: 'Opt-out gate',
      notes: ['The profile is currently opted out, so normal actions are blocked.'],
    })
  }

  if (!nextState.subscriptionActive) {
    return finalizeTurn(nextState, 'Your Manoa subscription is not active yet. Finish checkout, then text me again.', {
      intent: 'subscription check',
      branch: 'Subscription gate',
      notes: ['The backend blocks SMS actions until the subscription is active or trialing.'],
    })
  }

  if (!nextState.calendarConnected) {
    return finalizeTurn(nextState, 'Your subscription is active. Connect Google Calendar from your signup success page, then text me again.', {
      intent: 'calendar check',
      branch: 'Calendar gate',
      notes: ['The backend refuses scheduling actions until a calendar is connected.'],
    })
  }

  if (nextState.pending?.kind === 'save_business_contact_phone') {
    const phone = extractPhone(body)
    if (!phone) {
      return finalizeTurn(nextState, "Reply with the office phone number, or send SKIP if you don't want to save it yet.", {
        intent: 'save office number',
        branch: 'Business phone follow-up',
        matchedEvent: nextState.pending.payload.target?.title,
        authority: 'external_appointment',
        notes: ['The simulator is waiting on a phone number to save for next time.'],
      })
    }

    const businessName =
      nextState.pending.payload.businessName || nextState.pending.payload.target?.title || 'Office'
    const baseState = {
      ...nextState,
      businessContacts: [
        ...nextState.businessContacts.filter(
          (contact) => contact.label.toLowerCase() !== businessName.toLowerCase(),
        ),
        {
          label: businessName,
          phoneE164: phone,
          aliases: tokenize(businessName),
        },
      ],
    }

    if (nextState.pending.payload.followUpKind === 'external_cancel_confirm') {
      const savedState = withPending(baseState, {
        kind: 'save_business_contact_phone',
        payload: {
          ...nextState.pending.payload,
        },
      })
      const withSavedNumber = withBackgroundPending(
        {
          ...savedState,
          pending: null,
        },
        {
          kind: 'external_cancel_confirm',
          payload: {
            target: nextState.pending.payload.target,
            businessName,
            phoneE164: phone,
            callNote: nextState.pending.payload.callNote,
            authority: 'external_appointment',
          },
        },
      )

      return finalizeTurn(withSavedNumber, `Saved ${businessName} as ${phone} for next time.\nWhen the office confirms the cancellation, text something like "I called and canceled it" and I'll clear it from your calendar.\nYou can keep texting me other things in the meantime.`, {
        intent: 'save office number',
        branch: 'Business phone saved',
        matchedEvent: nextState.pending.payload.target?.title,
        authority: 'external_appointment',
        notes: ['The office number was saved and the simulator is now waiting for cancellation confirmation.'],
      })
    }

    if (nextState.pending.payload.followUpKind === 'external_reschedule_confirm') {
      const savedState = withBackgroundPending(
        {
          ...baseState,
          pending: null,
        },
        {
          kind: 'external_reschedule_confirm',
          payload: {
            target: nextState.pending.payload.target,
            businessName,
            phoneE164: phone,
            callNote: nextState.pending.payload.callNote,
            authority: 'external_appointment',
            holdEventId: nextState.pending.payload.holdEventId || null,
            holdCalendarId: nextState.pending.payload.holdCalendarId || null,
          },
        },
      )

      return finalizeTurn(savedState, `Saved ${businessName} as ${phone} for next time.\nWhen the office confirms the new time, text something like "They moved it to Tuesday at 2pm" and I'll update your calendar.\nYou can keep texting me other things in the meantime.`, {
        intent: 'save office number',
        branch: 'Business phone saved',
        matchedEvent: nextState.pending.payload.target?.title,
        authority: 'external_appointment',
        notes: ['The office number was saved and the simulator is now waiting for the confirmed new appointment time.'],
      })
    }

    const savedState = withPending(baseState, null)

    return finalizeTurn(savedState, `Saved ${businessName} as ${phone} for next time.`, {
      intent: 'save office number',
      branch: 'Business phone saved',
      matchedEvent: nextState.pending.payload.target?.title,
      authority: 'external_appointment',
      notes: ['The office number was stored in the simulator memory layer.'],
    })
  }

  if (nextState.pending?.kind === 'resolve_invitees') {
    const option = nextState.pending.payload.selectedOption
    if (!option) {
      return finalizeTurn(nextState, 'Send the scheduling request again and I will set it up.', {
        intent: 'resolve invitees',
        branch: 'Missing selected option',
        notes: ['The simulator lost the selected schedule option while waiting on invitee emails.'],
      })
    }

    const lower = body.trim().toLowerCase()
    const existingInvitees = nextState.pending.payload.attendees || []
    const unresolvedNames = nextState.pending.payload.unresolvedInvitees || []

    if (
      /\b(skip|just book it|book it anyway|without invites|without invite|no invites|dont invite|don't invite)\b/.test(
        lower,
      )
    ) {
      const bookedState = withPending(
        addCalendarEventFromOption(nextState, {
          ...option,
          attendees: existingInvitees,
        }),
        null,
      )
      return finalizeTurn(
        bookedState,
        existingInvitees.length
          ? `${bookingText(option)}\nI invited ${inviteeSummary(existingInvitees)}.\nI did not invite ${unresolvedInviteeSummary(unresolvedNames)} yet.`
          : `${bookingText(option)}\nI did not invite ${unresolvedInviteeSummary(unresolvedNames)} because I still need their email.`,
        {
          intent: 'resolve invitees',
          branch: 'Book without unresolved invites',
          notes: ['The simulator booked the event and skipped any invitees whose email was still missing.'],
        },
      )
    }

    const resolution = resolveInviteeFollowUp(body, unresolvedNames)
    if (!resolution.resolved.length) {
      return finalizeTurn(nextState, `I still need email${
        unresolvedNames.length > 1 ? 's' : ''
      } for ${unresolvedInviteeSummary(unresolvedNames)}.\nReply like "Sam sam@company.com" or say "book it without invites."`, {
        intent: 'resolve invitees',
        branch: 'Need invitee emails',
        notes: ['The reply did not include enough email information to finish the invites.'],
      })
    }

    const mergedInvitees = [...existingInvitees]
    for (const invitee of resolution.resolved) {
      if (mergedInvitees.some((item) => item.email.toLowerCase() === invitee.email.toLowerCase())) {
        continue
      }
      mergedInvitees.push(invitee)
    }

    let updatedState: SimulatorState = {
      ...nextState,
      peopleContacts: [
        ...nextState.peopleContacts,
        ...resolution.resolved
          .filter((invitee) => invitee.displayName)
          .map((invitee) => ({
            label: invitee.displayName as string,
            email: invitee.email,
            aliases: [invitee.displayName as string, invitee.email],
          })),
      ],
    }

    if (resolution.unresolvedNames.length) {
      updatedState = withPending(updatedState, {
        kind: 'resolve_invitees',
        payload: {
          selectedOption: option,
          attendees: mergedInvitees,
          unresolvedInvitees: resolution.unresolvedNames,
        },
      })

      return finalizeTurn(updatedState, `Got ${inviteeSummary(resolution.resolved)}.\nI still need email${
        resolution.unresolvedNames.length > 1 ? 's' : ''
      } for ${unresolvedInviteeSummary(resolution.unresolvedNames)}.`, {
        intent: 'resolve invitees',
        branch: 'Partially resolved invitees',
        notes: ['The simulator saved the contacts it could and kept waiting on the remaining email addresses.'],
      })
    }

    updatedState = withPending(
      addCalendarEventFromOption(updatedState, {
        ...option,
        attendees: mergedInvitees,
      }),
      null,
    )

    return finalizeTurn(updatedState, `${bookingText(option)}\nI invited ${inviteeSummary(
      mergedInvitees,
    )}.`, {
      intent: 'resolve invitees',
      branch: 'Booked with invitees',
      notes: ['The simulator collected the missing emails, saved them, and booked the meeting with invites.'],
    })
  }

  if (nextState.backgroundPending?.kind === 'external_cancel_confirm') {
    const target = nextState.backgroundPending.payload.target
    if (target && confirmsExternalCancellation(body, target, nextState.backgroundPending.payload.businessName)) {
      const clearedState = withBackgroundPending(removeCalendarEvent(nextState, target), null)
      return finalizeTurn(clearedState, `Removed ${target.title} from your calendar.\nIf you want, I can help you add a follow-up appointment next.`, {
        intent: 'external cancel confirmation',
        branch: 'External cancellation confirmed',
        matchedEvent: target.title,
        authority: 'external_appointment',
        notes: ['The office confirmed the cancellation, so the simulator cleared the calendar event.'],
      })
    }

    if (target && mentionsOfficeDelay(body, target, nextState.backgroundPending.payload.businessName)) {
      return finalizeTurn(nextState, `Okay. I left ${target.title} on your calendar.\nWhen the office confirms the cancellation, text me and I'll clear it.`, {
        intent: 'external cancel confirmation',
        branch: 'Waiting on office confirmation',
        matchedEvent: target.title,
        authority: 'external_appointment',
        notes: ['The office has not confirmed the cancellation yet, so Manoa keeps the appointment on the calendar.'],
      })
    }
  }

  if (nextState.backgroundPending?.kind === 'external_reschedule_confirm') {
    const target = nextState.backgroundPending.payload.target
    if (
      target &&
      (mentionsOfficeDelay(body, target, nextState.backgroundPending.payload.businessName) ||
        mentionsFailedExternalReschedule(body, target, nextState.backgroundPending.payload.businessName))
    ) {
      let updatedState = nextState
      if (nextState.backgroundPending.payload.holdEventId) {
        updatedState = removeCalendarEventById(updatedState, nextState.backgroundPending.payload.holdEventId)
      }

      return finalizeTurn(
        updatedState,
        mentionsFailedExternalReschedule(body, target, nextState.backgroundPending.payload.businessName)
          ? `Okay. I cleared the temporary call hold and left ${target.title} where it was.\nIf the office offers another time later, text me the new day and time and I'll update your calendar.`
          : `Okay. I cleared the temporary call hold and left ${target.title} where it was.\nWhen the office gets back to you with a new time, text me and I'll update your calendar.`,
        {
          intent: 'external reschedule confirmation',
          branch: 'Waiting on office callback',
          matchedEvent: target.title,
          authority: 'external_appointment',
          notes: ['The real-world call did not produce a confirmed new time yet, so Manoa cleared the temporary hold and kept the original appointment.'],
        },
      )
    }

    const followUp = parseExternalRescheduleConfirmation(
      body,
      target,
      nextState.backgroundPending.payload.businessName,
    )
    if (target && followUp.kind === 'confirmed_reschedule') {
      const option = optionFromExactExternalTime(target, followUp.baseDate, followUp.exactTime)
      let movedState = withBackgroundPending(moveCalendarEvent(nextState, target, option), null)

      if (nextState.backgroundPending.payload.holdEventId) {
        movedState = removeCalendarEventById(movedState, nextState.backgroundPending.payload.holdEventId)
      }

      return finalizeTurn(movedState, `Updated ${target.title} to ${option.dayLabel} at ${option.timeLabel} on your calendar.\nI also cleared the call hold.`, {
        intent: 'external reschedule confirmation',
        branch: 'External reschedule confirmed',
        matchedEvent: target.title,
        authority: 'external_appointment',
        notes: ['The office confirmed a new time, so the simulator updated the appointment and cleared the temporary call hold.'],
      })
    }

    if (followUp.kind === 'needs_details' && target) {
      return finalizeTurn(nextState, `Tell me the new day and time the office confirmed for ${target.title}, like "They moved it to Tuesday at 2pm."`, {
        intent: 'external reschedule confirmation',
        branch: 'Need new appointment details',
        matchedEvent: target.title,
        authority: 'external_appointment',
        notes: ['The follow-up sounded like a reschedule, but it did not include a clear day and time.'],
      })
    }
  }

  const pendingChoice = nextState.pending ? resolvePendingChoice(body, nextState.pending) : null

  if (nextState.pending && isShortAcknowledgement(body) && !pendingChoice) {
    return finalizeTurn(nextState, reminderForPending(nextState.pending), {
      intent: describeIntent(intent),
      branch: 'Pending reminder',
      notes: ['The message looked like a short acknowledgement, so Manoa reminded the user what it was waiting for.'],
    })
  }

  if (intent.type === 'choice' || pendingChoice) {
    return handleChoice(nextState, intent.type === 'choice' ? intent.choice : (pendingChoice as number))
  }

  if (intent.type === 'agenda') {
    const events = findEventsForDay(nextState, intent.day)
    return finalizeTurn(nextState, agendaText(intent.day, events), {
      intent: describeIntent(intent),
      branch: 'Agenda response',
      notes: [`The simulator read the ${intent.day} agenda from the connected calendar state.`],
    })
  }

  if (intent.type === 'schedule') {
    const inviteeContext = resolveScheduleInvitees(nextState, body)
    const cleanedIntent =
      inviteeContext.cleanedText && inviteeContext.cleanedText !== body
        ? parseSmsIntent(inviteeContext.cleanedText)
        : intent
    const scheduleIntent =
      cleanedIntent.type === 'schedule'
        ? cleanedIntent
        : intent

    const options = findScheduleOptions({
      state: nextState,
      title: scheduleIntent.title,
      baseDate: scheduleIntent.baseDate,
      exactTime: scheduleIntent.exactTime,
      calendarHint: scheduleIntent.calendarHint,
      durationMinutes: scheduleIntent.durationMinutes,
      recurrence: scheduleIntent.recurrence,
    })

    if (!options.length) {
      return finalizeTurn(nextState, 'I could not find an opening there. Try another day or time.', {
        intent: describeIntent(intent),
        branch: 'Schedule search',
        notes: ['The simulated calendar was busy for the requested time window.'],
      })
    }

    const pendingState = withPending(nextState, {
      kind: 'schedule',
      payload: {
        options,
        attendees: inviteeContext.invitees,
        unresolvedInvitees: inviteeContext.unresolvedNames,
      },
    })
    let reply = `I found these${scheduleIntent.recurrence ? ' starting' : ''} times:\n${optionList(
      options,
    )}\nReply 1, 2, or 3.`
    const recurring = recurrenceLine(options)
    if (recurring) {
      reply += `\n${recurring}`
    }
    if (inviteeContext.invitees.length) {
      reply += `\nReady to invite: ${inviteeSummary(inviteeContext.invitees)}.`
    }
    if (inviteeContext.unresolvedNames.length) {
      reply += `\nI still need email${
        inviteeContext.unresolvedNames.length > 1 ? 's' : ''
      } for ${unresolvedInviteeSummary(inviteeContext.unresolvedNames)}.`
    }
    return finalizeTurn(pendingState, reply, {
      intent: describeIntent(intent),
      branch: 'Schedule options prepared',
      notes: ['The real parser ran, then the simulator looked for open time blocks in the calendar state.'],
    })
  }

  if (intent.type === 'reschedule') {
    const preferredDay = dayForDate(intent.baseDate)
    const fallbackDay = preferredDay === 'today' ? 'tomorrow' : 'today'
    const preferredEvents = findEventsForDay(nextState, preferredDay)
    const fallbackEvents = findEventsForDay(nextState, fallbackDay)
    const nearbyEvents = sortEventsByStart([...preferredEvents, ...fallbackEvents])
    const target =
      findEventByQuery(preferredEvents, intent.query) || findEventByQuery(nearbyEvents, intent.query)

    if (!target) {
      const matchedNearbyEvents = matchingEventsByQuery(nearbyEvents, intent.query)
      const topEvents = (matchedNearbyEvents.length ? matchedNearbyEvents : nearbyEvents).slice(0, 3)
      if (!topEvents.length) {
        return finalizeTurn(nextState, "I don't see anything to move there.", {
          intent: describeIntent(intent),
          branch: 'Reschedule search',
          notes: ['There were no matching events in the requested day bucket.'],
        })
      }

      const pendingState = withPending(nextState, {
        kind: 'select_reschedule_target',
        payload: { events: topEvents },
      })

      return finalizeTurn(
        pendingState,
        `Which one should I move?\n${topEvents.map((event, index) => `${index + 1}. ${event.timeLabel} ${event.title}`).join('\n')}\nReply 1, 2, or 3.`,
        {
          intent: describeIntent(intent),
          branch: 'Need target clarification',
          notes: ['The query was too vague, so the simulator asked which event to move.'],
        },
      )
    }

    const authority = classifySimulatorEvent(nextState, target)

    if (authority === 'external_appointment') {
      const prepared = prepareExternalCallPrep(nextState, target, intent.baseDate, intent.exactTime)
      return finalizeTurn(prepared.state, prepared.reply, {
        intent: describeIntent(intent),
        branch: 'External appointment reschedule',
        matchedEvent: target.title,
        authority,
        notes: ['This uses the safe doctor/business path: prepare the call instead of pretending the office changed the appointment.'],
      })
    }

    if (authority === 'invited_meeting' || authority === 'unknown') {
      const pendingState = withPending(nextState, {
        kind: 'invited_reschedule_action',
        payload: {
          target,
          requestedBaseDate: intent.baseDate.toISOString(),
          exactTime: intent.exactTime,
          authority: 'invited_meeting',
        },
      })
      return finalizeTurn(pendingState, `I can't move ${target.title} for everyone from your side.\nDo you want me to:\n1. Hold a new time on my calendar only\n2. Draft a message to the organizer\n3. Keep it and add a reminder`, {
        intent: describeIntent(intent),
        branch: 'Invited meeting reschedule',
        matchedEvent: target.title,
        authority,
        notes: ['The event was classified as invited, so Manoa offered safe follow-up actions.'],
      })
    }

    const options = findScheduleOptions({
      state: nextState,
      title: target.title,
      baseDate: intent.baseDate,
      exactTime: intent.exactTime,
      calendarHint: target.calendarName,
      durationMinutes: eventDurationMinutes(target),
    })

    const pendingState = withPending(nextState, {
      kind: 'reschedule',
      payload: {
        target,
        options,
        authority,
      },
    })

    return finalizeTurn(pendingState, `I can move ${target.title} to:\n${optionList(options)}\nReply 1, 2, or 3.`, {
      intent: describeIntent(intent),
      branch: 'Direct reschedule',
      matchedEvent: target.title,
      authority,
      notes: ['The event was safe to move directly, so the simulator offered new times.'],
    })
  }

  if (intent.type === 'cancel') {
    const events = findEventsForDay(nextState, 'today')
    const target = findEventByQuery(events, intent.query)
    if (!target) {
      return finalizeTurn(nextState, 'Which event should I cancel? Try: cancel dentist.', {
        intent: describeIntent(intent),
        branch: 'Cancel search',
        notes: ['The cancel query did not match a current event.'],
      })
    }

    const authority = classifySimulatorEvent(nextState, target)
    if (authority === 'external_appointment') {
      const contact = inferBusinessContact(nextState, target)
      let reply = `I haven't canceled ${target.title} with the office.`
      nextState = contact?.phone_e164
        ? withBackgroundPending(nextState, {
            kind: 'external_cancel_confirm',
            payload: {
              target,
              businessName: contact?.label || target.title,
              phoneE164: contact.phone_e164,
              callNote: buildCancelNote(target),
              authority,
            },
          })
        : withPending(nextState, {
            kind: 'save_business_contact_phone',
            payload: {
              target,
              businessName: target.title,
              callNote: buildCancelNote(target),
              authority,
              followUpKind: 'external_cancel_confirm',
            },
          })
      if (contact?.phone_e164) {
        reply += `\nOffice number: ${contact.phone_e164}.`
      } else {
        reply += "\nI don't have the office number yet. Reply with it and I'll save it for next time."
      }
      reply += `\nCall note: ${buildCancelNote(target)}`
      reply += `\nWhen the office confirms, text something like "I called and canceled it" and I'll clear it from your calendar.\nYou can keep texting me other things in the meantime.`
      return finalizeTurn(nextState, reply, {
        intent: describeIntent(intent),
        branch: 'External appointment cancel',
        matchedEvent: target.title,
        authority,
        notes: ['Manoa refuses to fake an office cancellation and instead prepares the user to contact the office.'],
      })
    }

    if (authority === 'invited_meeting' || authority === 'unknown') {
      const pendingState = withPending(nextState, {
        kind: 'invited_cancel_action',
        payload: {
          target,
          authority: 'invited_meeting',
        },
      })
      return finalizeTurn(pendingState, `I can't cancel ${target.title} for everyone from your side.\nDo you want me to:\n1. Remove it from my calendar only\n2. Draft a decline message\n3. Keep it`, {
        intent: describeIntent(intent),
        branch: 'Invited meeting cancel',
        matchedEvent: target.title,
        authority,
        notes: ['The event is invited, so Manoa offered the safe local-only and draft paths.'],
      })
    }

    const removedState = withPending(removeCalendarEvent(nextState, target), null)
    return finalizeTurn(
      removedState,
      authority === 'owned_meeting'
        ? `Canceled ${target.title} and sent the update.`
        : `Canceled ${target.title}.`,
      {
        intent: describeIntent(intent),
        branch: 'Direct cancel',
        matchedEvent: target.title,
        authority,
        notes: [
          authority === 'owned_meeting'
            ? 'Because the user owns the meeting, the simulator used the attendee-update path.'
            : 'Because this was a personal event, the simulator removed it directly.',
        ],
      },
    )
  }

  return finalizeTurn(nextState, 'I can schedule, reschedule, cancel, or send your agenda. Try: 9am meeting Tuesday on work calendar.', {
    intent: describeIntent(intent),
    branch: 'Fallback help',
    notes: ['The parser did not find a supported action in that message.'],
  })
}

export function runSimulatorTurn(
  state: SimulatorState,
  body: string,
  options?: { intent?: ParsedSmsIntent; understoodBy?: 'AI' | 'Fallback parser' },
): SimulatorResult {
  const intent = options?.intent || parseSmsIntent(body)
  const understoodBy = options?.understoodBy || 'Fallback parser'
  const result = runSimulatorTurnCore(state, body, intent)

  return {
    ...result,
    debug: {
      ...result.debug,
      understoodBy,
    },
    state: {
      ...result.state,
      lastDebug: result.state.lastDebug
        ? {
            ...result.state.lastDebug,
            understoodBy,
          }
        : result.state.lastDebug,
    },
  }
}

export function getPendingChoices(state: SimulatorState) {
  const pending = state.pending
  if (!pending) return []

  if (
    pending.kind === 'schedule' ||
    pending.kind === 'reschedule' ||
    pending.kind === 'invited_reschedule_hold' ||
    pending.kind === 'external_call_prep'
  ) {
    return (pending.payload.options || []).map((option, index) => ({
      value: String(index + 1),
      label: `${index + 1}. ${option.dayLabel} at ${option.timeLabel}`,
    }))
  }

  if (pending.kind === 'select_reschedule_target') {
    return (pending.payload.events || []).map((event, index) => ({
      value: String(index + 1),
      label: `${index + 1}. ${event.timeLabel} ${event.title}`,
    }))
  }

  if (pending.kind === 'invited_reschedule_action') {
    return [
      { value: '1', label: '1. Hold a new time on my calendar only' },
      { value: '2', label: '2. Draft a message to the organizer' },
      { value: '3', label: '3. Keep it and add a reminder' },
    ]
  }

  if (pending.kind === 'invited_cancel_action') {
    return [
      { value: '1', label: '1. Remove it from my calendar only' },
      { value: '2', label: '2. Draft a decline message' },
      { value: '3', label: '3. Keep it' },
    ]
  }

  return []
}
