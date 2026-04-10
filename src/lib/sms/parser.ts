import { nextDateForWeekday, startOfDay } from '../calendar/dates'
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
      durationMinutes: number
      recurrence: RecurrenceSpec | null
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
  if (!match) return 30

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

function parseBaseDate(text: string) {
  const lower = text.toLowerCase()
  if (/\btoday\b|\bthis (morning|afternoon|evening)\b|\btonight\b/.test(lower)) return startOfDay(0)
  if (/\btomorrow'?s?\b|\btmrw\b|\btomororws?\b/.test(lower)) return startOfDay(1)

  const dayMatch = lower.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)
  if (dayMatch) return nextDateForWeekday(weekdays[dayMatch[1]])

  return startOfDay(1)
}

function parseCalendarHint(text: string) {
  const lower = text.toLowerCase()
  if (lower.includes('work')) return 'Work'
  if (lower.includes('family')) return 'Family'
  if (lower.includes('personal') || lower.includes('home')) return 'Personal'
  return 'Google Calendar'
}

function stripSchedulingNoise(text: string) {
  const cleaned = text
    .toLowerCase()
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

export function parseSmsIntent(body: string): ParsedSmsIntent {
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
      baseDate: parseBaseDate(text),
      exactTime: parseSmsTime(text) || parseLooseTimeHint(text),
      calendarHint: parseCalendarHint(text),
    }
  }

  const looksLikeSchedule =
    hasSchedulingWord(lower) ||
    Boolean(parseSmsTime(lower)) ||
    Boolean(parseLooseTimeHint(lower)) ||
    Boolean(parseRecurrence(lower)) ||
    (Boolean(lower.match(weekdayPattern)) &&
      /\b(with|for|around|after|before|from|until)\b/.test(lower))

  if (looksLikeSchedule) {
    return {
      type: 'schedule',
      title: stripSchedulingNoise(text),
      baseDate: parseBaseDate(text),
      exactTime: parseSmsTime(text) || parseLooseTimeHint(text),
      calendarHint: parseCalendarHint(text),
      durationMinutes: parseDuration(text),
      recurrence: parseRecurrence(text),
    }
  }

  return { type: 'unknown' }
}
