import {
  addDays,
  dateFromTimeZoneParts,
  dateTimePartsInTimeZone,
  nextDateForWeekday,
  startOfDay,
} from '../calendar/dates'
import type { RecurrenceSpec } from '../calendar/recurrence'

export type DateWindow = {
  start: Date
  end: Date
  label: string
}

export type ParsedSmsIntent =
  | { type: 'choice'; choice: number }
  | { type: 'agenda'; day: 'today' | 'tomorrow'; dateWindow?: DateWindow | null; label?: string }
  | { type: 'lookup'; query: string; dateWindow?: DateWindow | null }
  | {
      type: 'schedule'
      title: string
      baseDate: Date
      dateWindow: DateWindow | null
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
      dateWindow: DateWindow | null
      exactTime: { hour: number; minute: number } | null
      calendarHint: string
    }
  | { type: 'cancel'; query: string }
  | { type: 'unknown' }

const weekdays: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
}
const weekdayNameSource =
  'sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday|rday)?|fri(?:day)?|sat(?:urday)?'

const schedulingWords = [
  'schedule',
  'scheudle',
  'chedule',
  'book',
  'add',
  'set up',
  'fit in',
  'find time',
  'find me time',
  'find me a time',
  'make time',
  'squeeze in',
  'hold',
  'block off',
  'pencil in',
  'put',
  'throw',
  'save',
  'plan',
  'lunch',
  'dinner',
  'supper',
  'breakfast',
  'brunch',
  'coffee',
  'call',
  'meet',
  'meeting',
  'appointment',
  'haircut',
  'hair cut',
  'dentist',
  'doctor',
  'vet',
  'oil change',
  'event',
]

const cancelPattern = /\b(cancel|canceled|cancelled|delete|deleted|remove|removed|drop|dropped)\b|\btake\b.{0,60}\boff\b/
const reschedulePattern = /\b(reschedule|rescheduled|move|moved|change|changed|push|pushed)\b/
const weekdayPattern =
  /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|tomorrow|tmrw|tmmrw|tomorow|tommorow|tommorrow|tomororw|tomororws)\b/
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
    /^(?:(?:book|take|choose|pick|go with|lets do|let's do|do|i(?:['’]d| would)? like|i want)\s+)?(?:option\s*)?(?:the\s+)?(1|2|3|one|two|three|first|second|third|1st|2nd|3rd)(?:\s+one)?(?:\s+please)?$/,
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
    /\bschedule\b/.test(lower) ||
    /\bscheudle\b/.test(lower) ||
    /^(?:what'?s|whats|what is)\b/.test(lower) ||
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
  const bareHourMatch = match || lower.match(/\b(?:at|@)\s*(1[0-2]|0?[1-9])(?::([0-5]\d))?\b/)
  if (!bareHourMatch) return null

  let hour = Number(bareHourMatch[1])
  const minute = Number(bareHourMatch[2] || '0')
  const explicitPeriod = match?.[3]?.startsWith('a') ? 'am' : match?.[3]?.startsWith('p') ? 'pm' : null
  const period = explicitPeriod || (hour === 12 || (hour >= 1 && hour <= 5) ? 'pm' : 'am')

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

function endOfSpecificDay(date: Date, timeZone?: string) {
  const parts = dateTimePartsInTimeZone(date, timeZone)
  return dateFromTimeZoneParts(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: 23,
      minute: 59,
      second: 59,
    },
    timeZone,
  )
}

function startOfMonth(year: number, month: number, timeZone?: string) {
  return dateFromTimeZoneParts({ year, month, day: 1, hour: 0, minute: 0, second: 0 }, timeZone)
}

function endOfMonthDate(year: number, month: number, timeZone?: string) {
  const firstOfNextMonth =
    month === 12
      ? startOfMonth(year + 1, 1, timeZone)
      : startOfMonth(year, month + 1, timeZone)
  return new Date(firstOfNextMonth.getTime() - 1)
}

function monthWindow(month: number, part: string | null, timeZone?: string): DateWindow {
  const today = startOfDay(0, timeZone)
  const todayParts = dateTimePartsInTimeZone(today, timeZone)
  let year = todayParts.year
  const fullStart = startOfMonth(year, month, timeZone)
  const fullEnd = endOfMonthDate(year, month, timeZone)

  if (fullEnd < today) {
    year += 1
  }

  const start = startOfMonth(year, month, timeZone)
  const end = endOfMonthDate(year, month, timeZone)
  const monthName = start.toLocaleDateString('en-US', { month: 'long', timeZone })

  if (part === 'early') {
    return {
      start,
      end: endOfSpecificDay(dateFromTimeZoneParts({ year, month, day: 10, hour: 0, minute: 0, second: 0 }, timeZone), timeZone),
      label: `early ${monthName}`,
    }
  }

  if (part === 'mid' || part === 'middle') {
    return {
      start: dateFromTimeZoneParts({ year, month, day: 11, hour: 0, minute: 0, second: 0 }, timeZone),
      end: endOfSpecificDay(dateFromTimeZoneParts({ year, month, day: 20, hour: 0, minute: 0, second: 0 }, timeZone), timeZone),
      label: `mid ${monthName}`,
    }
  }

  if (part === 'late' || part === 'end' || part === 'end of') {
    return {
      start: dateFromTimeZoneParts({ year, month, day: 21, hour: 0, minute: 0, second: 0 }, timeZone),
      end,
      label: `late ${monthName}`,
    }
  }

  return { start, end, label: monthName }
}

function daysUntilWeekEnd(timeZone?: string) {
  const today = startOfDay(0, timeZone)
  const weekday = dateTimePartsInTimeZone(today, timeZone).weekday
  return Math.max(0, 6 - weekday)
}

function nextWeekStart(timeZone?: string) {
  const today = startOfDay(0, timeZone)
  const weekday = dateTimePartsInTimeZone(today, timeZone).weekday
  const daysUntilNextMonday = ((8 - weekday) % 7) || 7
  return addDays(today, daysUntilNextMonday, timeZone)
}

function weekdayFromAlias(value: string | undefined) {
  if (!value) return null
  const normalized = value.toLowerCase().replace(/'s$/, '').replace(/s$/, '')
  return weekdays[value.toLowerCase()] ?? weekdays[normalized] ?? null
}

export function parseDateWindow(text: string, timeZone?: string): DateWindow | null {
  const lower = text.toLowerCase()
  const explicitDate = parseExplicitDate(text, timeZone)
  if (explicitDate) {
    return {
      start: explicitDate,
      end: endOfSpecificDay(explicitDate, timeZone),
      label: formatWindowLabel(explicitDate, explicitDate, timeZone),
    }
  }

  const inDays = lower.match(/\bin\s+(\d+)\s+days?\b/)
  if (inDays) {
    const start = startOfDay(Number(inDays[1]), timeZone)
    return { start, end: endOfSpecificDay(start, timeZone), label: formatWindowLabel(start, start, timeZone) }
  }

  const inWeeks = lower.match(/\b(?:in\s+)?(\d+)\s+weeks?\s+from\s+now\b|\bin\s+(\d+)\s+weeks?\b/)
  const weekCount = Number(inWeeks?.[1] || inWeeks?.[2] || 0)
  if (weekCount) {
    const start = startOfDay(weekCount * 7, timeZone)
    return { start, end: endOfSpecificDay(start, timeZone), label: formatWindowLabel(start, start, timeZone) }
  }

  const monthMatch = lower.match(
    new RegExp(`\\b(?:(early|mid|middle|late|end(?: of)?)\\s+)?(?:in\\s+|during\\s+|sometime\\s+in\\s+)?(${monthNameSource})\\b`, 'i'),
  )
  if (monthMatch && !/\b(month|months)\b/.test(monthMatch[2])) {
    const month = monthNames[monthMatch[2].replace(/\.$/, '')]
    if (month) return monthWindow(month, monthMatch[1]?.trim() || null, timeZone)
  }

  if (/\bnext month\b/.test(lower)) {
    const todayParts = dateTimePartsInTimeZone(startOfDay(0, timeZone), timeZone)
    const nextMonth = todayParts.month === 12 ? 1 : todayParts.month + 1
    const year = todayParts.month === 12 ? todayParts.year + 1 : todayParts.year
    const start = startOfMonth(year, nextMonth, timeZone)
    return {
      start,
      end: endOfMonthDate(year, nextMonth, timeZone),
      label: start.toLocaleDateString('en-US', { month: 'long', timeZone }),
    }
  }

  if (/\bend of (?:the )?(?:current )?month\b|\bend of month\b/.test(lower)) {
    const todayParts = dateTimePartsInTimeZone(startOfDay(0, timeZone), timeZone)
    const end = endOfMonthDate(todayParts.year, todayParts.month, timeZone)
    const endParts = dateTimePartsInTimeZone(end, timeZone)
    const startDay = Math.max(todayParts.day, endParts.day - 6)
    const start = dateFromTimeZoneParts(
      { year: todayParts.year, month: todayParts.month, day: startDay, hour: 0, minute: 0, second: 0 },
      timeZone,
    )
    return { start, end, label: 'end of the month' }
  }

  const nextWeekWithDay =
    lower.match(new RegExp(`\\bnext week\\s+(?:on\\s+)?(${weekdayNameSource})'?s?\\b`, 'i')) ||
    lower.match(new RegExp(`\\b(${weekdayNameSource})'?s?\\s+next week\\b`, 'i'))
  const nextWeekDay = weekdayFromAlias(nextWeekWithDay?.[1])
  if (nextWeekDay !== null) {
    const weekStart = nextWeekStart(timeZone)
    const offset = nextWeekDay === 0 ? 6 : nextWeekDay - 1
    const start = addDays(weekStart, offset, timeZone)
    return { start, end: endOfSpecificDay(start, timeZone), label: formatWindowLabel(start, start, timeZone) }
  }

  if (/\bnext week(?:'s|s)?\b/.test(lower)) {
    const start = nextWeekStart(timeZone)
    let end = addDays(start, 6, timeZone)
    if (/\bearly next week\b/.test(lower)) end = addDays(start, 2, timeZone)
    if (/\bmid next week\b|\bmiddle of next week\b/.test(lower)) {
      const midStart = addDays(start, 2, timeZone)
      return { start: midStart, end: endOfSpecificDay(addDays(start, 3, timeZone), timeZone), label: 'mid next week' }
    }
    if (/\bend of next week\b|\blate next week\b/.test(lower)) {
      const lateStart = addDays(start, 4, timeZone)
      return { start: lateStart, end: endOfSpecificDay(end, timeZone), label: 'late next week' }
    }
    return { start, end: endOfSpecificDay(end, timeZone), label: 'next week' }
  }

  if (/\bthis weekend\b/.test(lower)) {
    const today = startOfDay(0, timeZone)
    const weekday = dateTimePartsInTimeZone(today, timeZone).weekday
    const saturday = addDays(today, (6 - weekday + 7) % 7, timeZone)
    const sunday = addDays(saturday, 1, timeZone)
    return { start: saturday, end: endOfSpecificDay(sunday, timeZone), label: 'this weekend' }
  }

  if (/\bthis week(?:'s|s)?\b/.test(lower)) {
    const start = startOfDay(0, timeZone)
    const end = addDays(start, daysUntilWeekEnd(timeZone), timeZone)
    return { start, end: endOfSpecificDay(end, timeZone), label: 'this week' }
  }

  if (/\btoday\b|\bthis (morning|afternoon|evening)\b|\btonight\b/.test(lower)) {
    const start = startOfDay(0, timeZone)
    return { start, end: endOfSpecificDay(start, timeZone), label: 'today' }
  }

  if (/\btomorrow'?s?\b|\btmrw\b|\btmmrw\b|\btomorow\b|\btommorow\b|\btommorrow\b|\btomororws?\b/.test(lower)) {
    const start = startOfDay(1, timeZone)
    return { start, end: endOfSpecificDay(start, timeZone), label: 'tomorrow' }
  }

  const dayMatch = lower.match(new RegExp(`\\b(?:next\\s+)?(${weekdayNameSource})'?s?\\b`, 'i'))
  const weekday = weekdayFromAlias(dayMatch?.[1])
  if (weekday !== null) {
    const start = nextDateForWeekday(weekday, timeZone)
    return { start, end: endOfSpecificDay(start, timeZone), label: formatWindowLabel(start, start, timeZone) }
  }

  return null
}

function formatWindowLabel(start: Date, end: Date, timeZone?: string) {
  if (start.toDateString() === end.toDateString()) {
    return start.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone,
    })
  }

  return `${start.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone,
  })}-${end.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone,
  })}`
}

function findLocationStop(rest: string) {
  const stopPatterns = [
    /\s+(?:today|tomorrow|tmrw|tmmrw|tomorow|tommorow|tommorrow|tomororws?)\b/i,
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
  if (/^\d{1,2}(?::[0-5]\d)?$/.test(lower)) return false
  if (/^(?:today|tomorrow|tmrw|tmmrw|tomorow|tommorow|tommorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i.test(lower)) return false
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
  return parseDateWindow(text, timeZone)?.start || startOfDay(1, timeZone)
}

function agendaDayFromWindow(window: DateWindow | null, timeZone?: string): 'today' | 'tomorrow' {
  if (!window) return 'today'
  return sameDay(window.start, startOfDay(1, timeZone), timeZone) ? 'tomorrow' : 'today'
}

function sameDay(left: Date, right: Date, timeZone?: string) {
  const leftParts = dateTimePartsInTimeZone(left, timeZone)
  const rightParts = dateTimePartsInTimeZone(right, timeZone)
  return (
    leftParts.year === rightParts.year &&
    leftParts.month === rightParts.month &&
    leftParts.day === rightParts.day
  )
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
    .replace(/\b(?:early|mid|middle of|late|end of(?: the)?)\s+next\s+week\b/g, ' ')
    .replace(new RegExp(`\\b(?:early|mid|middle of|late|end of(?: the)?)\\s+(?:${monthNameSource})\\b`, 'g'), ' ')
    .replace(/\bend of (?:the )?(?:current )?month\b|\bend of month\b/g, ' ')
    .replace(/\b(?:this|next)\s+(?:week(?:'s|s)?|weekend|month)\b/g, ' ')
    .replace(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/g, ' ')
    .replace(/\bat\s+(1[0-2]|0?[1-9])(?::[0-5]\d)?\b/g, ' ')
    .replace(/\b(noon|midnight|morning|afternoon|evening|tonight|lunchtime)\b/g, ' ')
    .replace(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|today|tomorrow|tmrw|tmmrw|tomorow|tommorow|tommorrow|next)\b/g, ' ')
    .replace(/\btomororws?\b/g, ' ')
    .replace(
      /\b(i need to|need to|schedule|scheudle|chedule|book|add|set up|fit in|find time|find me time|find me a time|make time|squeeze in|hold|block off|pencil in|put|throw|save|plan|meet|reschedule|rescheduled|move|moved|change|changed|push|pushed|cancel|canceled|cancelled|delete|deleted|remove|removed|drop|dropped|take|took|off|from|on|at|to|my|work|personal|family|home|email|calendar|this|every|each|weekly|biweekly|monthly|week|weeks|month|months|other|recurring)\b/g,
      ' ',
    )
    .replace(/\b\d+\s*(minute|min|hour|hr)\b/g, ' ')
    .replace(/\bsometime\b/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
    .trim()

  return cleaned || 'meeting'
}

function parseLookupQuery(text: string) {
  const cleaned = text.trim().replace(/[?!.]+$/g, '')
  const patterns = [
    /^when(?:['’]s|\s+is|\s+are)?\s+(?:is\s+|are\s+)?(?:my\s+|the\s+)?(.+)$/i,
    /^what\s+time(?:\s+is|\s+are)?\s+(?:my\s+|the\s+)?(.+)$/i,
    /^where(?:['’]s|\s+is|\s+are)?\s+(?:is\s+|are\s+)?(?:my\s+|the\s+)?(.+)$/i,
    /^when\s+do\s+i\s+have\s+(?:my\s+|the\s+)?(.+)$/i,
  ]

  for (const pattern of patterns) {
    const match = cleaned.match(pattern)
    const query = match?.[1]
      ?.replace(/\b(?:scheduled|happening|coming up)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (query) return query
  }

  return null
}

export function parseSmsIntent(body: string, timeZone?: string): ParsedSmsIntent {
  const text = body.trim()
  const lower = text.toLowerCase()
  const dateWindow = parseDateWindow(text, timeZone)

  const choice = parseChoiceIntent(text)
  if (choice) return { type: 'choice', choice }

  const lookupQuery = parseLookupQuery(text)
  if (lookupQuery) return { type: 'lookup', query: lookupQuery, dateWindow }

  const startsWithScheduleCommand = /^(schedule|scheudle|chedule|book|add|set up|put|throw|save|plan|pencil in|block off|already scheduled|already booked|they scheduled|they booked)\b/.test(lower)
  const isTomorrowAgenda =
    !startsWithScheduleCommand && isAgendaRequest(lower, 'tomorrow')

  if (isTomorrowAgenda) return { type: 'agenda', day: 'tomorrow', dateWindow, label: dateWindow?.label }

  const isTodayAgenda =
    !startsWithScheduleCommand &&
    (lower === 'today' ||
      lower === "today's schedule" ||
      isAgendaRequest(lower, 'today') ||
      (!/\btomorrow'?s?\b|\btmrw\b|\btmmrw\b|\btomorow\b|\btommorow\b|\btommorrow\b|\btomororws?\b/.test(lower) &&
        (lower.includes("what's my day") ||
          lower.includes('what is my day') ||
          lower.includes('what am i doing today') ||
          lower.includes('today look like'))))

  const isBroadAgenda =
    !startsWithScheduleCommand &&
    (lower.includes('agenda') ||
      /\bschedule\b/.test(lower) ||
      lower.includes("what's on") ||
      lower.includes('what is on') ||
      lower.includes('what do i have') ||
      lower.includes('show me') ||
      lower.includes('walk me through') ||
      lower.includes('brief me') ||
      lower.includes('do i have anything') ||
      lower.includes('am i free') ||
      lower.includes('am i open') ||
      lower.includes('am i available') ||
      lower.includes('calendar') ||
      lower.includes('coming up') ||
      lower.includes('upcoming')) &&
    Boolean(dateWindow || /\bcoming up\b|\bupcoming\b/.test(lower))

  if (isTodayAgenda || isBroadAgenda) {
    return {
      type: 'agenda',
      day: isTomorrowAgenda ? 'tomorrow' : agendaDayFromWindow(dateWindow, timeZone),
      dateWindow,
      label: dateWindow?.label || (/\bcoming up\b|\bupcoming\b/.test(lower) ? 'coming up' : undefined),
    }
  }

  if (cancelPattern.test(lower)) {
    return { type: 'cancel', query: stripSchedulingNoise(text) }
  }

  if (!startsWithScheduleCommand && reschedulePattern.test(lower)) {
    return {
      type: 'reschedule',
      query: stripSchedulingNoise(text),
      baseDate: parseBaseDate(text, timeZone),
      dateWindow,
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
      dateWindow,
      exactTime: parseSmsTime(text) || parseLooseTimeHint(text),
      calendarHint: parseCalendarHint(text),
      durationMinutes: parseDuration(text),
      recurrence: parseRecurrence(text),
      location: locationContext.location,
    }
  }

  return { type: 'unknown' }
}
