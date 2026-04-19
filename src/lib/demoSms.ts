import { addMinutes, setTime, startOfDay } from './calendar/dates'
import {
  hasSpecificScheduleTimePreference,
  scheduleCandidateTimesForTitle,
} from './calendar/schedulingPreferences'
import { parseScheduleLocation, parseSmsIntent, type DateWindow, type ParsedSmsIntent } from './sms/parser'

export type DemoMessage = {
  role: 'user' | 'manoa'
  lines: string[]
  options?: DemoOption[]
}

export type DemoOption = {
  title: string
  calendarName: string
  dayLabel: string
  timeLabel: string
  start: string
  location?: string | null
}

export type DemoEvent = {
  id: string
  title: string
  calendar: string
  start: string
  kind: 'owned' | 'pending_invite' | 'external_appointment'
  location?: string | null
  officeNumber?: string
}

type DemoPendingAction =
  | { kind: 'schedule'; options: DemoOption[] }
  | { kind: 'recent_created_event'; eventId: string }
  | {
      kind: 'select_reschedule_target'
      options: DemoOption[]
      requestedText: string
    }
  | { kind: 'reschedule'; targetEventId: string; options: DemoOption[] }
  | {
      kind: 'external_call_prep'
      targetEventId?: string
      title: string
      options: DemoOption[]
      officeNumber?: string
      callNote: string
    }

export type DemoState = {
  messages: DemoMessage[]
  events: DemoEvent[]
  pendingAction: DemoPendingAction | null
}

export const DEMO_STARTER_INPUT = 'Need a meeting with Beth this week'

const bookingCalendars = ['Work', 'Personal']
const externalAppointmentKeywords = [
  'doctor',
  'dentist',
  'therapy',
  'therapist',
  'vet',
  'clinic',
  'salon',
  'haircut',
  'hair cut',
  'hair appointment',
  'barber',
  'repair',
  'service',
]
const schedulingWords = ['meeting', 'call', 'coffee', 'lunch', 'dinner', 'appointment', 'event']

function starterMessages(): DemoMessage[] {
  return [
    {
      role: 'manoa',
      lines: [
        'Text me like you would from your phone.',
        'Try: Need a meeting with Beth this week, what is on my calendar tomorrow, 2pm meeting tomorrow on Work, or reschedule dentist.',
      ],
    },
  ]
}

function seedIso(offsetDays: number, hour: number, minute: number) {
  return setTime(startOfDay(offsetDays), { hour, minute }).toISOString()
}

function seedEvents(): DemoEvent[] {
  return [
    {
      id: 'today-standup',
      title: 'Team standup',
      calendar: 'Work',
      start: seedIso(0, 9, 0),
      kind: 'owned',
    },
    {
      id: 'today-dentist',
      title: 'Dentist',
      calendar: 'Personal',
      start: seedIso(0, 13, 30),
      kind: 'external_appointment',
      officeNumber: '(312) 555-0189',
    },
    {
      id: 'today-pickup',
      title: 'School pickup',
      calendar: 'Family',
      start: seedIso(0, 16, 0),
      kind: 'owned',
    },
    {
      id: 'tomorrow-workout',
      title: 'Workout',
      calendar: 'Personal',
      start: seedIso(1, 8, 30),
      kind: 'owned',
    },
    {
      id: 'tomorrow-client',
      title: 'Client review',
      calendar: 'Work',
      start: seedIso(1, 10, 0),
      kind: 'owned',
    },
    {
      id: 'tomorrow-design',
      title: 'Design review',
      calendar: 'Work',
      start: seedIso(1, 14, 0),
      kind: 'pending_invite',
    },
    {
      id: 'tomorrow-budget',
      title: 'Budget check-in',
      calendar: 'Work',
      start: seedIso(1, 15, 0),
      kind: 'owned',
    },
  ]
}

export function createDemoState(): DemoState {
  return {
    messages: starterMessages(),
    events: seedEvents(),
    pendingAction: null,
  }
}

function appendMessage(state: DemoState, message: DemoMessage): DemoState {
  return {
    ...state,
    messages: [...state.messages, message],
  }
}

function normalizeText(value: string) {
  return value.trim().toLowerCase()
}

function isSingleScheduleConfirmation(text: string) {
  return /^(?:yes|yep|yeah|y|ok|okay|sure|sounds good|perfect|confirm|confirmed|book it|book|do it|go ahead|please do|looks good)(?:\s+please)?[.!]*$/i.test(
    text.trim(),
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

function pendingActionTitle(action: DemoPendingAction) {
  if (action.kind === 'external_call_prep') return action.title
  if (action.kind === 'recent_created_event') return null
  return action.options[0]?.title.replace(/\s*\(pending\)\s*$/i, '') || null
}

function correctedDemoScheduleText(text: string, action: DemoPendingAction) {
  if (action.kind !== 'schedule' && action.kind !== 'external_call_prep') return null
  const fragment = correctionFragment(text)
  const title = pendingActionTitle(action)
  if (!fragment || !title) return null

  let cleanedFragment = fragment
    .replace(/^(?:schedule|book|add|set up)\s+/i, '')
    .replace(/^(?:it|that)\s+/i, '')
    .trim()

  if (!cleanedFragment) return null

  const calendarName = action.options[0]?.calendarName
  if (calendarName && !/\bcalendar\b/i.test(cleanedFragment)) {
    cleanedFragment += ` on ${calendarName} calendar`
  }

  return `schedule ${title} ${cleanedFragment}`
}

function pendingTitleToConfirmed(title: string) {
  return title.replace(/\s*\(pending\)\s*$/i, '')
}

function latestPendingExternalHold(events: DemoEvent[]) {
  return [...events]
    .reverse()
    .find((event) => /\(pending\)\s*$/i.test(event.title))
}

function detectLooseAgendaIntent(value: string): 'today' | 'tomorrow' | null {
  const lower = normalizeText(value)
  const asksWhat =
    lower.includes('what') ||
    lower.includes("what's") ||
    lower.includes('whats') ||
    lower.includes('show') ||
    lower.includes('happening') ||
    lower.includes('doing') ||
    lower.includes('calendar') ||
    lower.includes('schedule')

  if (!asksWhat) return null

  if (/\b(tomorrow|tmrw|tomororw|tomororws)\b/.test(lower)) {
    return 'tomorrow'
  }

  if (/\b(today|todays|today's|toda|todao|todau|todya)\b/.test(lower)) {
    return 'today'
  }

  return null
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function sortEvents(events: DemoEvent[]) {
  return [...events].sort((left, right) => {
    return new Date(left.start).getTime() - new Date(right.start).getTime()
  })
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function shortDayLabel(date: Date) {
  if (isSameDay(date, startOfDay(0))) return 'Today'
  if (isSameDay(date, startOfDay(1))) return 'Tomorrow'
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}

function agendaForDay(events: DemoEvent[], day: 'today' | 'tomorrow') {
  const targetDate = startOfDay(day === 'today' ? 0 : 1)
  return sortEvents(events).filter((event) => isSameDay(new Date(event.start), targetDate))
}

function agendaReply(events: DemoEvent[], day: 'today' | 'tomorrow'): DemoMessage {
  const dayEvents = agendaForDay(events, day)
  if (!dayEvents.length) {
    return {
      role: 'manoa',
      lines: [day === 'tomorrow' ? "Tomorrow's schedule is clear." : "You're clear today."],
    }
  }

  return {
    role: 'manoa',
    lines: [
      day === 'tomorrow' ? "Tomorrow's schedule:" : 'Today:',
      ...dayEvents.map((event) => `${timeLabel(event.start)} ${event.title} (${event.calendar})`),
    ],
  }
}

function optionLines(options: DemoOption[]) {
  return options.map(
    (option, index) => `${index + 1}. ${option.dayLabel} at ${option.timeLabel} on ${option.calendarName}`,
  )
}

function scheduleOptionsReply(options: DemoOption[]) {
  const replyLine =
    options.length >= 3 ? 'Reply 1, 2, or 3.' : options.length === 2 ? 'Reply 1 or 2.' : 'Reply 1.'

  return {
    role: 'manoa' as const,
    lines: ['I found these times:', ...optionLines(options), replyLine],
    options,
  }
}

function exactAvailableReply(option: DemoOption) {
  return {
    role: 'manoa' as const,
    lines: [
      `I confirmed ${option.dayLabel} at ${option.timeLabel} is available on ${option.calendarName}.`,
      ...(option.location ? [`Location: ${option.location}.`] : []),
      'Book it? Reply YES to book or NO to leave it.',
    ],
    options: [option],
  }
}

function pendingInviteReply(conflict: DemoEvent, requestedOption: DemoOption, alternatives: DemoOption[]) {
  const lines = [
    `You have a pending invite for "${conflict.title}" at ${timeLabel(conflict.start)}.`,
    `1. Book over it anyway: ${requestedOption.dayLabel} at ${requestedOption.timeLabel} on ${requestedOption.calendarName}`,
  ]

  if (alternatives[0]) {
    lines.push(`2. ${alternatives[0].dayLabel} at ${alternatives[0].timeLabel} on ${alternatives[0].calendarName}`)
  }

  if (alternatives[1]) {
    lines.push(`3. ${alternatives[1].dayLabel} at ${alternatives[1].timeLabel} on ${alternatives[1].calendarName}`)
  }

  lines.push(alternatives[1] ? 'Reply 1, 2, or 3.' : alternatives[0] ? 'Reply 1 or 2.' : 'Reply 1 to book over it anyway.')

  return {
    role: 'manoa' as const,
    lines,
    options: [requestedOption, ...alternatives].slice(0, 3),
  }
}

function extractCalendar(rawText: string) {
  const lower = normalizeText(rawText)
  if (lower.includes('work')) return 'Work'
  if (lower.includes('personal') || lower.includes('home')) return 'Personal'
  if (lower.includes('family')) return 'Family'
  if (looksLikeExternalAppointment(rawText)) return 'Personal'
  return 'Work'
}

function inferWindow(rawText: string) {
  const lower = normalizeText(rawText)
  if (
    lower.includes('afternoon') ||
    lower.includes('lunch') ||
    /\b(12|1|2|3|4)(?::[0-5]\d)?\s*p\.?m\.?\b/.test(lower)
  ) {
    return 'afternoon'
  }

  if (
    lower.includes('morning') ||
    /\b(8|9|10|11)(?::[0-5]\d)?\s*a\.?m\.?\b/.test(lower)
  ) {
    return 'morning'
  }

  return 'default'
}

function titleCase(value: string) {
  return value
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function inferScheduleTitle(rawText: string) {
  const locationContext = parseScheduleLocation(rawText)
  const lower = normalizeText(locationContext.textWithoutLocation)
  const personMatch = rawText.match(/\bwith\s+([a-zA-Z]+)(?:\b|$)/i)
  const meetingWord = schedulingWords.find((word) => lower.includes(word))

  if (personMatch?.[1]) {
    const person = titleCase(personMatch[1])
    if (meetingWord === 'coffee') return `Coffee with ${person}`
    if (meetingWord === 'lunch') return `Lunch with ${person}`
    if (meetingWord === 'dinner') return `Dinner with ${person}`
    if (meetingWord === 'call') return `Call with ${person}`
    return `Meeting with ${person}`
  }

  const cleaned = lower
    .replace(/\b(need|a|an|this|week|next|schedule|book|add|set up|fit in|make time|tomorrow|today|on|at|for|to|calendar|work|personal|family|home)\b/g, ' ')
    .replace(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return 'Meeting'
  return titleCase(cleaned)
}

function looksLikeExternalAppointment(text: string) {
  const lower = normalizeText(text)
  return externalAppointmentKeywords.some((keyword) => lower.includes(keyword))
}

function externalAvailabilityWeekdays(text: string) {
  const lower = normalizeText(text)
  if (/\b(haircut|barber|salon)\b|\bhair\s+cut\b|\bhair appointment\b/.test(lower)) {
    return new Set([1, 2, 3, 4, 5, 6])
  }

  return new Set([1, 2, 3, 4, 5])
}

function callNote(title: string, options: DemoOption[]) {
  const times = options.map((option) => `${option.dayLabel} at ${option.timeLabel}`).join(', ')
  return `Need to move ${title}. Best times: ${times}.`
}

function buildScheduleOptions(rawText: string, baseDate: Date, exactTime: { hour: number; minute: number } | null) {
  const parsed = parseSmsIntent(rawText)
  const title = parsed.type === 'schedule' ? titleCase(parsed.title) : inferScheduleTitle(rawText)
  const location = parsed.type === 'schedule' ? parsed.location : parseScheduleLocation(rawText).location
  const calendarName = extractCalendar(rawText)
  const window = inferWindow(rawText)

  const templates =
    window === 'morning'
      ? [
          { dayOffset: 0, hour: 9, minute: 30 },
          { dayOffset: 1, hour: 10, minute: 0 },
          { dayOffset: 2, hour: 8, minute: 45 },
        ]
      : window === 'afternoon'
        ? [
            { dayOffset: 0, hour: 12, minute: 0 },
            { dayOffset: 1, hour: 14, minute: 0 },
            { dayOffset: 2, hour: 15, minute: 0 },
          ]
        : [
            { dayOffset: 0, hour: 10, minute: 0 },
            { dayOffset: 1, hour: 14, minute: 0 },
            { dayOffset: 2, hour: 11, minute: 0 },
          ]
  const preferredTimes = scheduleCandidateTimesForTitle(title)
  const hasTitlePreference = hasSpecificScheduleTimePreference(title)
  const preferredTemplates =
    exactTime || !hasTitlePreference
      ? templates
      : preferredTimes.slice(0, 3).map((time) => ({
          dayOffset: 0,
          hour: time.hour,
          minute: time.minute,
        }))

  const requestTemplate =
    exactTime === null
      ? preferredTemplates
      : [
          { dayOffset: 0, hour: exactTime.hour, minute: exactTime.minute },
          ...templates.slice(1),
        ]

  return requestTemplate.map((template) => {
    const date = new Date(baseDate)
    date.setDate(date.getDate() + template.dayOffset)
    const start = setTime(date, { hour: template.hour, minute: template.minute })

    return {
      title,
      calendarName,
      dayLabel: shortDayLabel(start),
      timeLabel: timeLabel(start.toISOString()),
      start: start.toISOString(),
      location,
    }
  })
}

function buildCallPrepOptions(baseDate: Date, appointmentTitle: string, dateWindow?: DateWindow | null) {
  const templates = [
    { dayOffset: 0, hour: 11, minute: 0 },
    { dayOffset: 1, hour: 12, minute: 30 },
    { dayOffset: 2, hour: 9, minute: 45 },
    { dayOffset: 3, hour: 11, minute: 15 },
    { dayOffset: 4, hour: 10, minute: 30 },
    { dayOffset: 5, hour: 13, minute: 0 },
    { dayOffset: 6, hour: 9, minute: 30 },
  ]
  const allowedWeekdays = externalAvailabilityWeekdays(appointmentTitle)

  const options: DemoOption[] = []
  const totalDays = dateWindow
    ? Math.max(1, Math.ceil((dateWindow.end.getTime() - baseDate.getTime()) / 86_400_000) + 1)
    : 7

  for (let dayOffset = 0; dayOffset < totalDays && options.length < 3; dayOffset += 1) {
    const template = templates[dayOffset % templates.length]
    const date = new Date(baseDate)
    date.setDate(date.getDate() + dayOffset)
    const start = setTime(date, { hour: template.hour, minute: template.minute })
    const option = {
      title: `${appointmentTitle} (pending)`,
      calendarName: 'Personal',
      dayLabel: shortDayLabel(start),
      timeLabel: timeLabel(start.toISOString()),
      start: start.toISOString(),
    }

    if (new Date(option.start).getTime() <= Date.now() + 5 * 60_000) continue
    if (dateWindow && (new Date(option.start) < dateWindow.start || new Date(option.start) > dateWindow.end)) continue
    if (!allowedWeekdays.has(new Date(option.start).getDay())) continue
    options.push(option)
  }

  return options.slice(0, 3)
}

function sameTimeConflict(event: DemoEvent, start: Date) {
  const eventStart = new Date(event.start)
  const eventEnd = addMinutes(eventStart, 60)
  const requestedEnd = addMinutes(start, 60)
  return eventStart < requestedEnd && eventEnd > start
}

function scheduleReply(
  state: DemoState,
  rawText: string,
  parsedIntent?: ParsedSmsIntent,
): DemoState {
  const intent = parsedIntent ?? parseSmsIntent(rawText)
  if (intent.type !== 'schedule') {
    return appendMessage(state, {
      role: 'manoa',
      lines: ['Try: Need a meeting with Beth this week.', 'Then reply with 1, 2, or 3.'],
    })
  }

  if (looksLikeExternalAppointment(rawText)) {
    const title = inferScheduleTitle(rawText)
    let options = buildCallPrepOptions(intent.baseDate, title, intent.dateWindow)
    let widenedFrom: string | null = null
    if (!options.length && intent.dateWindow?.label === 'this week') {
      const nextSearchDate = new Date(intent.dateWindow.end)
      nextSearchDate.setDate(nextSearchDate.getDate() + 1)
      options = buildCallPrepOptions(nextSearchDate, title, null)
      widenedFrom = intent.dateWindow.label
    }
    if (!options.length) {
      return appendMessage(state, {
        role: 'manoa',
        lines: [
          `I could not find a good opening${intent.dateWindow?.label ? ` for ${intent.dateWindow.label}` : ''} for ${title}.`,
          'Try a specific weekday.',
        ],
      })
    }
    const note = `Call the office to confirm ${title}. Best times: ${options
      .map((option) => `${option.dayLabel} at ${option.timeLabel}`)
      .join(', ')}.`
    const message: DemoMessage = {
      role: 'manoa',
      lines: [
        widenedFrom
          ? `I did not find any remaining ${widenedFrom} openings for ${title}, so I checked next week.`
          : `I can hold one of these while you call to book ${title}:`,
        ...(widenedFrom ? ['I can hold one of these while you call:'] : []),
        ...optionLines(options),
        'Reply 1, 2, or 3.',
        'After the office books it, reply CONFIRMED. If they give a different time, text that time.',
      ],
      options,
    }

    return {
      ...appendMessage(state, message),
      pendingAction: {
        kind: 'external_call_prep' as const,
        title,
        options,
        callNote: note,
      },
    }
  }

  const options = buildScheduleOptions(rawText, intent.baseDate, intent.exactTime)

  if (intent.exactTime) {
    const requestedStart = setTime(intent.baseDate, intent.exactTime)
    const overlapping = state.events.filter((event) => sameTimeConflict(event, requestedStart))
    const pendingInvite = overlapping.find((event) => event.kind === 'pending_invite')
    const hardConflict = overlapping.find((event) => event.kind !== 'pending_invite')

    if (pendingInvite && !hardConflict) {
      const requestedOption = {
        ...options[0],
        dayLabel: shortDayLabel(requestedStart),
        timeLabel: timeLabel(requestedStart.toISOString()),
        calendarName: extractCalendar(rawText),
        start: requestedStart.toISOString(),
      }
      const message = pendingInviteReply(pendingInvite, requestedOption, options.slice(1, 3))
      return {
        ...appendMessage(state, message),
        pendingAction: {
          kind: 'schedule' as const,
          options: message.options || [requestedOption],
        },
      }
    }

    if (hardConflict) {
      const alternativeMessage = scheduleOptionsReply(options.slice(1))
      return {
        ...appendMessage(state, alternativeMessage),
        pendingAction: { kind: 'schedule' as const, options: options.slice(1) },
      }
    }

    const message = exactAvailableReply(options[0])
    return {
      ...appendMessage(state, message),
      pendingAction: { kind: 'schedule' as const, options: [options[0]] },
    }
  }

  const message = scheduleOptionsReply(options)
  return {
    ...appendMessage(state, message),
    pendingAction: { kind: 'schedule' as const, options },
  }
}

function findMatchingEvent(events: DemoEvent[], query: string, day: 'today' | 'tomorrow' | null) {
  const lower = normalizeText(query)
  const targetEvents = day ? agendaForDay(events, day) : events
  const exactTimeMatch = lower.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/)
  const calendar = extractCalendar(query)

  if (exactTimeMatch) {
    const exactTimeText = timeLabel(setTime(startOfDay(0), {
      hour:
        (Number(exactTimeMatch[1]) % 12) +
        (exactTimeMatch[3].toLowerCase().startsWith('p') ? 12 : 0),
      minute: Number(exactTimeMatch[2] || '0'),
    }).toISOString())
    const byTime = targetEvents.find((event) => timeLabel(event.start) === exactTimeText)
    if (byTime) return byTime
  }

  const byTitle = targetEvents.find((event) => {
    return lower
      .split(/\s+/)
      .filter(Boolean)
      .some((word) => word.length > 2 && event.title.toLowerCase().includes(word))
  })
  if (byTitle) return byTitle

  const byCalendar = targetEvents.find((event) => event.calendar === calendar)
  return byCalendar || null
}

function selectRescheduleTargetReply(options: DemoOption[]) {
  const replyLine =
    options.length >= 3 ? 'Reply 1, 2, or 3.' : options.length === 2 ? 'Reply 1 or 2.' : 'Reply 1.'

  return {
    role: 'manoa' as const,
    lines: ['Which meeting should I move?', ...optionLines(options), replyLine],
    options,
  }
}

function buildTargetSelectionOptions(events: DemoEvent[]) {
  return sortEvents(events)
    .slice(0, 3)
    .map((event) => ({
      title: event.title,
      calendarName: event.calendar,
      dayLabel: shortDayLabel(new Date(event.start)),
      timeLabel: timeLabel(event.start),
      start: event.start,
    }))
}

function rescheduleReply(
  state: DemoState,
  rawText: string,
  parsedIntent?: ParsedSmsIntent,
): DemoState {
  const intent = parsedIntent ?? parseSmsIntent(rawText)
  if (intent.type !== 'reschedule') {
    return appendMessage(state, {
      role: 'manoa',
      lines: ['Tell me which meeting to move.', 'For example: reschedule dentist.'],
    })
  }

  const day =
    normalizeText(rawText).includes('tomorrow') ||
    normalizeText(rawText).includes('tmrw')
      ? 'tomorrow'
      : normalizeText(rawText).includes('today')
        ? 'today'
        : null

  const target = findMatchingEvent(state.events, intent.query, day)
  if (!target) {
    const candidates = buildTargetSelectionOptions(day ? agendaForDay(state.events, day) : state.events)
    if (!candidates.length) {
      return appendMessage(state, {
        role: 'manoa',
        lines: ["I don't see a meeting to move in this demo yet.", 'Ask for today or tomorrow first.'],
      })
    }

    return {
      ...appendMessage(state, selectRescheduleTargetReply(candidates)),
      pendingAction: {
        kind: 'select_reschedule_target' as const,
        options: candidates,
        requestedText: rawText,
      },
    }
  }

  if (target.kind === 'external_appointment' || looksLikeExternalAppointment(target.title)) {
    const options = buildCallPrepOptions(intent.baseDate, target.title)
    const note = callNote(target.title, options)
    const message: DemoMessage = {
      role: 'manoa',
      lines: [
        `I can't change ${target.title} with the office by text, but I can get you ready to call.`,
        'Here are your next openings:',
        ...optionLines(options),
        "Reply 1, 2, or 3 and I'll hold that time for your call.",
        ...(target.officeNumber ? [`Office number: ${target.officeNumber}.`] : []),
        `Call note: ${note}`,
      ],
      options,
    }

    return {
      ...appendMessage(state, message),
      pendingAction: {
        kind: 'external_call_prep' as const,
        targetEventId: target.id,
        title: target.title,
        options,
        officeNumber: target.officeNumber,
        callNote: note,
      },
    }
  }

  const options = buildScheduleOptions(
    `move ${target.title} ${intent.calendarHint || ''}`,
    intent.baseDate,
    intent.exactTime,
  ).map((option) => ({
    ...option,
    title: target.title,
    calendarName: target.calendar,
  }))

  const message: DemoMessage = {
    role: 'manoa',
    lines: [`I can move ${target.title} to one of these:`, ...optionLines(options), 'Reply 1, 2, or 3.'],
    options,
  }

  return {
    ...appendMessage(state, message),
    pendingAction: {
      kind: 'reschedule' as const,
      targetEventId: target.id,
      options,
    },
  }
}

function cancelReply(
  state: DemoState,
  rawText: string,
  parsedIntent?: ParsedSmsIntent,
): DemoState {
  const intent = parsedIntent ?? parseSmsIntent(rawText)
  if (intent.type !== 'cancel') return state

  const target = findMatchingEvent(state.events, intent.query, null)
  if (!target) {
    return appendMessage(state, {
      role: 'manoa',
      lines: ["I couldn't find that event to cancel.", 'Try the exact meeting name or time.'],
    })
  }

  const remainingEvents = state.events.filter((event) => event.id !== target.id)
  const message =
    target.kind === 'external_appointment'
      ? {
          role: 'manoa' as const,
          lines: [
            `Removed ${target.title} from your calendar.`,
            "If you still need to cancel with the office, you'll want to call them directly.",
          ],
        }
      : {
          role: 'manoa' as const,
          lines: [`Canceled ${target.title}.`],
        }

  return {
    ...appendMessage({ ...state, events: remainingEvents }, message),
    events: remainingEvents,
    pendingAction: null,
  }
}

function lookupReply(
  state: DemoState,
  rawText: string,
  parsedIntent?: ParsedSmsIntent,
): DemoState {
  const intent = parsedIntent ?? parseSmsIntent(rawText)
  if (intent.type !== 'lookup') return state

  const target = findMatchingEvent(state.events, intent.query, null)
  if (!target) {
    return appendMessage(state, {
      role: 'manoa',
      lines: [`I couldn't find ${intent.query} on this demo calendar.`],
    })
  }

  return appendMessage(state, {
    role: 'manoa',
    lines: [`${target.title} is ${shortDayLabel(new Date(target.start))} at ${timeLabel(target.start)} on ${target.calendar}.`],
  })
}

function applyChoice(state: DemoState, choice: number): DemoState {
  const pendingAction = state.pendingAction
  if (!pendingAction) {
    return appendMessage(state, {
      role: 'manoa',
      lines: ['Send a request first, then reply with 1, 2, or 3.'],
    })
  }

  if (pendingAction.kind === 'recent_created_event') {
    return appendMessage(state, {
      role: 'manoa',
      lines: ['That event is already booked. Say "cancel that" if you want me to remove it.'],
    })
  }

  const picked = pendingAction.options[choice - 1]
  if (!picked) {
    return appendMessage(state, {
      role: 'manoa',
      lines: ['Reply with 1, 2, or 3.'],
    })
  }

  if (pendingAction.kind === 'select_reschedule_target') {
    return rescheduleReply(
      {
        ...state,
        pendingAction: null,
      },
      `${pendingAction.requestedText} ${picked.title}`,
    )
  }

  if (pendingAction.kind === 'external_call_prep') {
    const target = pendingAction.targetEventId
      ? state.events.find((event) => event.id === pendingAction.targetEventId)
      : null
    const heldEvent: DemoEvent = {
      id: `hold-${picked.start}`,
      title: target ? `Call ${target.title} to reschedule` : `${pendingAction.title} (pending)`,
      calendar: picked.calendarName,
      start: picked.start,
      kind: 'owned',
    }
    const message: DemoMessage = {
      role: 'manoa',
      lines: [
        target
          ? `Held ${picked.dayLabel} at ${picked.timeLabel} for your call about ${target.title}.`
          : `Held ${picked.dayLabel} at ${picked.timeLabel} as ${pendingAction.title} (pending).`,
        ...(pendingAction.officeNumber ? [`Office number: ${pendingAction.officeNumber}.`] : []),
        target
          ? `When the office confirms the new time, text something like "They moved it to Tuesday at 2pm."`
          : 'After the office books it, reply CONFIRMED. If they give a different time, text that time.',
      ],
    }

    return {
      ...appendMessage(
        { ...state, events: sortEvents([...state.events, heldEvent]), pendingAction: null },
        message,
      ),
      events: sortEvents([...state.events, heldEvent]),
      pendingAction: null,
    }
  }

  if (pendingAction.kind === 'reschedule') {
    const target = state.events.find((event) => event.id === pendingAction.targetEventId)
    if (!target) {
      return appendMessage({ ...state, pendingAction: null }, {
        role: 'manoa',
        lines: ['I lost track of that meeting. Try the request again.'],
      })
    }

    const updatedEvents = sortEvents(
      state.events.map((event) =>
        event.id === target.id
          ? {
              ...event,
              start: picked.start,
              calendar: picked.calendarName,
            }
          : event,
      ),
    )

    return {
      ...appendMessage(
        { ...state, events: updatedEvents, pendingAction: null },
        {
          role: 'manoa',
          lines: [`Moved ${target.title} to ${picked.dayLabel} at ${picked.timeLabel}.`],
        },
      ),
      events: updatedEvents,
      pendingAction: null,
    }
  }

  const bookedEvent: DemoEvent = {
    id: `event-${picked.start}-${picked.title}`,
    title: picked.title,
    calendar: picked.calendarName,
    start: picked.start,
    kind: 'owned',
    location: picked.location || null,
  }

  return {
    ...appendMessage(
      {
        ...state,
        events: sortEvents([...state.events, bookedEvent]),
        pendingAction: { kind: 'recent_created_event', eventId: bookedEvent.id },
      },
      {
        role: 'manoa',
        lines: [
          `Booked ${picked.title} for ${picked.dayLabel} at ${picked.timeLabel}.`,
          ...(picked.location ? [`Location: ${picked.location}.`] : []),
          "I'll remind you before it starts.",
        ],
      },
    ),
    events: sortEvents([...state.events, bookedEvent]),
    pendingAction: { kind: 'recent_created_event', eventId: bookedEvent.id },
  }
}

export function applyDemoTextForIntent(
  state: DemoState,
  text: string,
  intent: ParsedSmsIntent,
): DemoState {
  const trimmed = text.trim()
  if (!trimmed) return state

  const withUserMessage = appendMessage(state, { role: 'user', lines: [trimmed] })

  if (state.pendingAction && isCancelPendingRequest(trimmed)) {
    if (state.pendingAction.kind === 'recent_created_event') {
      const eventId = state.pendingAction.eventId
      const target = state.events.find((event) => event.id === eventId)
      const nextEvents = state.events.filter((event) => event.id !== eventId)
      return appendMessage(
        { ...withUserMessage, events: nextEvents, pendingAction: null },
        {
          role: 'manoa',
          lines: [target ? `Done. I canceled ${target.title}.` : 'Done. I canceled that event.'],
        },
      )
    }

    return appendMessage(
      { ...withUserMessage, pendingAction: null },
      { role: 'manoa', lines: ['Okay. I dropped that request.'] },
    )
  }

  const correctedScheduleText = state.pendingAction
    ? correctedDemoScheduleText(trimmed, state.pendingAction)
    : null

  if (correctedScheduleText) {
    const correctedIntent = parseSmsIntent(correctedScheduleText)
    return scheduleReply(
      {
        ...withUserMessage,
        pendingAction: null,
      },
      correctedScheduleText,
      correctedIntent,
    )
  }

  if (state.pendingAction?.kind === 'schedule' && state.pendingAction.options.length === 1) {
    if (isSingleScheduleConfirmation(trimmed)) {
      return applyChoice(withUserMessage, 1)
    }

    if (isSingleScheduleDecline(trimmed)) {
      return appendMessage({ ...withUserMessage, pendingAction: null }, {
        role: 'manoa',
        lines: ['Okay. I left it off your calendar.'],
      })
    }
  }

  if (!state.pendingAction && isSingleScheduleConfirmation(trimmed)) {
    const pendingHold = latestPendingExternalHold(withUserMessage.events)
    if (pendingHold) {
      const title = pendingTitleToConfirmed(pendingHold.title)
      const updatedEvents = withUserMessage.events.map((event) =>
        event.id === pendingHold.id ? { ...event, title } : event,
      )
      return {
        ...appendMessage(
          { ...withUserMessage, events: updatedEvents },
          {
            role: 'manoa',
            lines: [
              `Great. I marked ${title} as confirmed for ${shortDayLabel(new Date(pendingHold.start))} at ${timeLabel(pendingHold.start)}.`,
            ],
          },
        ),
        events: updatedEvents,
      }
    }
  }

  const looseAgenda = intent.type === 'unknown' ? detectLooseAgendaIntent(trimmed) : null
  if (looseAgenda) {
    return appendMessage(
      { ...withUserMessage, pendingAction: null },
      agendaReply(withUserMessage.events, looseAgenda),
    )
  }

  if (intent.type === 'choice') {
    return applyChoice(withUserMessage, intent.choice)
  }

  if (intent.type === 'agenda') {
    return appendMessage({ ...withUserMessage, pendingAction: null }, agendaReply(withUserMessage.events, intent.day))
  }

  if (intent.type === 'lookup') {
    return lookupReply({ ...withUserMessage, pendingAction: null }, trimmed, intent)
  }

  if (intent.type === 'schedule') {
    return scheduleReply({ ...withUserMessage, pendingAction: null }, trimmed, intent)
  }

  if (intent.type === 'reschedule') {
    return rescheduleReply({ ...withUserMessage, pendingAction: null }, trimmed, intent)
  }

  if (intent.type === 'cancel') {
    return cancelReply({ ...withUserMessage, pendingAction: null }, trimmed, intent)
  }

  return appendMessage({ ...withUserMessage, pendingAction: null }, {
    role: 'manoa',
    lines: [
      'Try one of these:',
      '1. Need a meeting with Beth this week',
      "2. What's on my calendar tomorrow?",
      '3. Reschedule dentist',
    ],
  })
}

export function applyDemoText(state: DemoState, text: string): DemoState {
  return applyDemoTextForIntent(state, text, parseSmsIntent(text))
}
