import { dateFromTimeZoneParts, dateTimePartsInTimeZone, nextDateForWeekday, startOfDay } from '../calendar/dates'
import type { RecurrenceSpec } from '../calendar/recurrence'

export type ParsedSmsIntent =
  | { type: 'choice'; choice: number }
  | { type: 'agenda'; day: 'today' | 'tomorrow' }
  | {
      type: 'schedule'
      title: string
      baseDate: Date
      exactTime: { hour: number; minute: number } | null
      calendarHint: string
      durationMinutes: number | null
      recurrence: RecurrenceSpec | null
      location: string | null
    }
  | {
      type: 'reschedule'
      query: string
      baseDate: Date
      exactTime: { hour: number; minute: number } | null
      calendarHint: string
    }
  | { type: 'cancel'; query: string }
  | { type: 'unknown' }

const weekdays: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

const schedulingWords = [
  'schedule',
  'book',
  'add',
  'set up',
  'fit in',
  'make time',
  'squeeze in',
  'hold',
  'lunch',
  'dinner',
  'coffee',
  'call',
  'meeting',
  'appointment',
  'event',
]

const cancelPattern = /\b(cancel|canceled|cancelled|delete|deleted)\b/
const reschedulePattern = /\b(reschedule|rescheduled|move|moved|change|changed|push|pushed)\b/
const weekdayPattern =
  /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|tomorrow|tmrw|tomororw|tomororws)\b/
const recurringWeeklyPattern = /\b(weekly|every week|each week|biweekly|every 2 weeks?|every two weeks?)\b/
const recurringWeekdayPattern =
  /\b(?:every|each)(?:\s+other)?\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/
const recurringMonthlyPattern = /\b(monthly|every month|each month)\b/
const monthNames: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}
const monthNameSource =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const monthNameDatePattern = new RegExp(
  `\\b(${monthNameSource})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
  'i',
)
const dateMonthNamePattern = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNameSource})\\.?\\b(?:,?\\s+(\\d{4}))?`,
  'i',
)
const numericDatePattern = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/

function hasWholeWord(text: string, word: string) {
  return new RegExp(`\\b${word}\\b`, 'i').test(text)
}

function hasSchedulingWord(text: string) {
  return schedulingWords.some((word) => hasWholeWord(text, word))
}

function choiceValue(value: string) {
  const normalized = value.toLowerCase()
  if (['1', 'one', 'first', '1st'].includes(normalized)) return 1
  if (['2', 'two', 'second', '2nd'].includes(normalized)) return 2
  if (['3', 'three', 'third', '3rd'].includes(normalized)) return 3
  return null
}

function parseChoiceIntent(text: string) {
  const lower = text.trim().toLowerCase()
  const directMatch = lower.match(
    /^(?:(?:book|take|choose|pick|go with|lets do|let's do|do|i(?:'d| would)? like|i want)\s+)?(?:option\s*)?(1|2|3|one|two|three|first|second|third|1st|2nd|3rd)(?:\s+one)?(?:\s+please)?$/,
  )
  if (directMatch) return choiceValue(directMatch[1])

  const ordinalOnly = lower.match(/^(?:the\s+)?(first|second|third|1st|2nd|3rd)$/)
  if (ordinalOnly) return choiceValue(ordinalOnly[1])

  return null
}

function isAgendaRequest(lower: string, day: 'today' | 'tomorrow') {
  const hasDay =
    day === 'tomorrow'
      ? /\btomorrow'?s?\b|\btmrw\b|\btomororws?\b/.test(lower)
      : lower === 'today' || /\btoday'?s?\b|\btodays\b/.test(lower)

  const agendaLanguage =
    lower.includes('agenda') ||
    lower.includes('recap') ||
    lower.includes('summary') ||
    lower.includes('calendar') ||
    lower.includes('schedule') ||
    lower.includes('scheudle') ||
    lower.includes("what's on") ||
    lower.includes('what is on') ||
    lower.includes('what do i have') ||
    lower.includes("what's my day") ||
    lower.includes('what is my day') ||
    lower.includes('day look like') ||
    lower.includes('look like') ||
    lower.includes('what am i doing') ||
    lower.includes('on deck') ||
    lower.includes('show me') ||
    lower.includes('walk me through') ||
    lower.includes('run me through') ||
    lower.includes('brief me') ||
    lower.includes('am i free') ||
    lower.includes('am i open') ||
    lower.includes('am i available') ||
    lower.includes('do i have anything')

  return hasDay && agendaLanguage
}

export function parseSmsTime(text: string) {
  const lower = text.toLowerCase()
  const match = lower.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/)
  if (!match) return null

  let hour = Number(match[1])
  const minute = Number(match[2] || '0')
  const period = match[3].startsWith('a') ? 'am' : 'pm'

  if (period === 'pm' && hour !== 12) hour += 12
  if (period === 'am' && hour === 12) hour = 0

  return { hour, minute }
}

function parseLooseTimeHint(text: string) {
  const lower = text.toLowerCase()
  if (/\bnoon\b|\blunchtime\b/.test(lower)) return { hour: 12, minute: 0 }
  if (/\bmidnight\b/.test(lower)) return { hour: 0, minute: 0 }
  if (/\bmorning\b/.test(lower)) return { hour: 9, minute: 0 }
  if (/\bafternoon\b/.test(lower)) return { hour: 14, minute: 0 }
  if (/\b(evening|tonight)\b/.test(lower)) return { hour: 18, minute: 0 }
  return null
}

function parseDuration(text: string) {
  const match = text.toLowerCase().match(/\b(\d+)\s*(minute|min|hour|hr)\b/)
  if (!match) return null

  const value = Number(match[1])
  return match[2].startsWith('hour') || match[2] === 'hr' ? value * 60 : value
}

function parseRecurrence(text: string): RecurrenceSpec | null {
  const lower = text.toLowerCase()

  if (recurringMonthlyPattern.test(lower)) {
    return {
      unit: 'month',
      interval: 1,
      mode: /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(lower)
        ? 'nth_weekday'
        : 'month_day',
    }
  }

  if (
    /\b(biweekly|every other week|every other weeks|every 2 weeks?|every two weeks?)\b/.test(lower) ||
    /\b(?:every|each)\s+other\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(
      lower,
    )
  ) {
    return {
      unit: 'week',
      interval: 2,
    }
  }

  if (recurringWeeklyPattern.test(lower) || recurringWeekdayPattern.test(lower)) {
    return {
      unit: 'week',
      interval: 1,
    }
  }

  return null
}

function normalizeExplicitYear(rawYear: string | undefined, currentYear: number) {
  if (!rawYear) return { year: currentYear, explicit: false }
  const year = Number(rawYear)
  if (rawYear.length === 2) {
    return { year: year + 2000, explicit: true }
  }
  return { year, explicit: true }
}

function buildExplicitDate({
  month,
  day,
  rawYear,
  timeZone,
}: {
  month: number
  day: number
  rawYear?: string
  timeZone?: string
}) {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }

  const today = startOfDay(0, timeZone)
  const todayParts = dateTimePartsInTimeZone(today, timeZone)
  const { year: initialYear, explicit } = normalizeExplicitYear(rawYear, todayParts.year)

  const create = (year: number) =>
    dateFromTimeZoneParts(
      {
        year,
        month,
        day,
        hour: 0,
        minute: 0,
        second: 0,
      },
      timeZone,
    )

  let candidate = create(initialYear)
  let parts = dateTimePartsInTimeZone(candidate, timeZone)

  if (parts.year !== initialYear || parts.month !== month || parts.day !== day) {
    return null
  }

  if (!explicit && candidate < today) {
    candidate = create(initialYear + 1)
    parts = dateTimePartsInTimeZone(candidate, timeZone)
    if (parts.year !== initialYear + 1 || parts.month !== month || parts.day !== day) {
      return null
    }
  }

  return candidate
}

export function parseExplicitDate(text: string, timeZone?: string) {
  const lower = text.toLowerCase()
  const monthNameMatch = lower.match(monthNameDatePattern)
  if (monthNameMatch) {
    const month = monthNames[monthNameMatch[1].replace(/\.$/, '')]
    return buildExplicitDate({
      month,
      day: Number(monthNameMatch[2]),
      rawYear: monthNameMatch[3],
      timeZone,
    })
  }

  const dateMonthNameMatch = lower.match(dateMonthNamePattern)
  if (dateMonthNameMatch) {
    const month = monthNames[dateMonthNameMatch[2].replace(/\.$/, '')]
    return buildExplicitDate({
      month,
      day: Number(dateMonthNameMatch[1]),
      rawYear: dateMonthNameMatch[3],
      timeZone,
    })
  }

  const numericDateMatch = lower.match(numericDatePattern)
  if (numericDateMatch) {
    return buildExplicitDate({
      month: Number(numericDateMatch[1]),
      day: Number(numericDateMatch[2]),
      rawYear: numericDateMatch[3],
      timeZone,
    })
  }

  return null
}

function findLocationStop(rest: string) {
  const stopPatterns = [
    /\s+(?:today|tomorrow|tmrw|tomororws?)\b/i,
    /\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    /\s+next\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    new RegExp(`\\s+(?:${monthNameSource})\\.?\\s+\\d{1,2}`, 'i'),
    new RegExp(`\\s+\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${monthNameSource})\\.?`, 'i'),
    /\s+\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/i,
    /\s+at\s+(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)\b/i,
    /\s+at\s+(?:noon|midnight|lunchtime)\b/i,
    /\s+for\s+\d+\s*(?:minute|min|hour|hr)s?\b/i,
    /\s+on\s+[a-z0-9][a-z0-9 '&-]{1,40}\s+calendar\b/i,
    /\s+for\s+[a-z0-9][a-z0-9 '&-]{1,40}\s+calendar\b/i,
    /\s+with\s+/i,
  ]

  return stopPatterns.reduce((earliest, pattern) => {
    const match = rest.match(pattern)
    if (!match || match.index === undefined) return earliest
    return Math.min(earliest, match.index)
  }, rest.length)
}

function cleanLocation(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[,.:;\s]+|[,.:;\s]+$/g, '')
    .replace(/\b(?:please|thanks|thank you)$/i, '')
    .trim()
}

function isLikelyLocation(value: string, timeZone?: string) {
  const lower = value.toLowerCase()
  if (!value || value.length < 2 || value.length > 80) return false
  if (parseSmsTime(lower) || parseLooseTimeHint(lower) || parseExplicitDate(lower, timeZone)) return false
  if (/^(?:today|tomorrow|tmrw|sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i.test(lower)) return false
  if (/^\d+\s*(?:minute|min|hour|hr)s?$/i.test(lower)) return false
  if (/^(?:me|you|it|that|this|calendar)$/i.test(lower)) return false
  return true
}

export function parseScheduleLocation(text: string, timeZone?: string) {
  const markerPattern = /\b(?:at|near|in)\s+/gi
  const markers = Array.from(text.matchAll(markerPattern))

  for (let index = markers.length - 1; index >= 0; index -= 1) {
    const marker = markers[index]
    if (marker.index === undefined) continue

    const markerStart = marker.index
    const valueStart = markerStart + marker[0].length
    const rest = text.slice(valueStart)
    const stop = findLocationStop(rest)
    const location = cleanLocation(rest.slice(0, stop))

    if (!isLikelyLocation(location, timeZone)) continue

    return {
      location,
      textWithoutLocation: `${text.slice(0, markerStart)} ${text.slice(valueStart + stop)}`.replace(/\s+/g, ' ').trim(),
    }
  }

  return {
    location: null,
    textWithoutLocation: text,
  }
}

function parseBaseDate(text: string, timeZone?: string) {
  const lower = text.toLowerCase()
  const explicitDate = parseExplicitDate(text, timeZone)
  if (explicitDate) return explicitDate

  if (/\btoday\b|\bthis (morning|afternoon|evening)\b|\btonight\b/.test(lower)) {
    return startOfDay(0, timeZone)
  }
  if (/\btomorrow'?s?\b|\btmrw\b|\btomororws?\b/.test(lower)) return startOfDay(1, timeZone)

  const dayMatch = lower.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)
  if (dayMatch) return nextDateForWeekday(weekdays[dayMatch[1]], timeZone)
  if (/\bthis week\b/.test(lower)) return startOfDay(0, timeZone)

  return startOfDay(1, timeZone)
}

function parseCalendarHint(text: string) {
  const lower = text.toLowerCase()

  const labeledCalendarMatch =
    text.match(/\bon\s+([a-z0-9][a-z0-9 '&-]{1,40})\s+calendar\b/i) ||
    text.match(/\binto\s+([a-z0-9][a-z0-9 '&-]{1,40})\b/i) ||
    text.match(/\bfor\s+([a-z0-9][a-z0-9 '&-]{1,40})\s+calendar\b/i)

  if (labeledCalendarMatch?.[1]) {
    return labeledCalendarMatch[1].trim()
  }

  if (lower.includes('work')) return 'Work'
  if (lower.includes('family')) return 'Family'
  if (lower.includes('personal') || lower.includes('home')) return 'Personal'
  return 'Calendar'
}

function stripSchedulingNoise(text: string) {
  const cleaned = text
    .toLowerCase()
    .replace(monthNameDatePattern, ' ')
    .replace(dateMonthNamePattern, ' ')
    .replace(numericDatePattern, ' ')
    .replace(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/g, ' ')
    .replace(/\b(noon|midnight|morning|afternoon|evening|tonight|lunchtime)\b/g, ' ')
    .replace(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|today|tomorrow|tmrw|next)\b/g, ' ')
    .replace(/\btomororws?\b/g, ' ')
    .replace(
      /\b(schedule|book|add|reschedule|rescheduled|move|moved|change|changed|push|pushed|cancel|canceled|cancelled|delete|deleted|on|at|to|my|work|personal|family|home|email|calendar|every|each|weekly|biweekly|monthly|week|weeks|month|months|other|recurring)\b/g,
      ' ',
    )
    .replace(/\b\d+\s*(minute|min|hour|hr)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || 'meeting'
}

export function parseSmsIntent(body: string, timeZone?: string): ParsedSmsIntent {
  const text = body.trim()
  const lower = text.toLowerCase()

  const choice = parseChoiceIntent(text)
  if (choice) return { type: 'choice', choice }

  const isTomorrowAgenda =
    !/^(schedule|book|add|set up)\b/.test(lower) && isAgendaRequest(lower, 'tomorrow')

  if (isTomorrowAgenda) return { type: 'agenda', day: 'tomorrow' }

  const isTodayAgenda =
    lower === 'today' ||
    lower === "today's schedule" ||
    isAgendaRequest(lower, 'today') ||
    (!/\btomorrow'?s?\b|\btmrw\b|\btomororws?\b/.test(lower) &&
      (lower.includes("what's my day") ||
        lower.includes('what is my day') ||
        lower.includes('what am i doing today') ||
        lower.includes('today look like')))

  if (isTodayAgenda) return { type: 'agenda', day: 'today' }

  if (cancelPattern.test(lower)) {
    return { type: 'cancel', query: stripSchedulingNoise(text) }
  }

  if (reschedulePattern.test(lower)) {
    return {
      type: 'reschedule',
      query: stripSchedulingNoise(text),
      baseDate: parseBaseDate(text, timeZone),
      exactTime: parseSmsTime(text) || parseLooseTimeHint(text),
      calendarHint: parseCalendarHint(text),
    }
  }

  const looksLikeSchedule =
    hasSchedulingWord(lower) ||
    Boolean(parseExplicitDate(lower, timeZone)) ||
    Boolean(parseSmsTime(lower)) ||
    Boolean(parseLooseTimeHint(lower)) ||
    Boolean(parseRecurrence(lower)) ||
    (Boolean(lower.match(weekdayPattern)) &&
      /\b(with|for|around|after|before|from|until)\b/.test(lower))

  if (looksLikeSchedule) {
    const locationContext = parseScheduleLocation(text, timeZone)

    return {
      type: 'schedule',
      title: stripSchedulingNoise(locationContext.textWithoutLocation),
      baseDate: parseBaseDate(text, timeZone),
      exactTime: parseSmsTime(text) || parseLooseTimeHint(text),
      calendarHint: parseCalendarHint(text),
      durationMinutes: parseDuration(text),
      recurrence: parseRecurrence(text),
      location: locationContext.location,
    }
  }

  return { type: 'unknown' }
}
