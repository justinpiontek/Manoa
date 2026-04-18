import { addDays, dateTimePartsInTimeZone, sameCalendarDay, startOfDay } from '../calendar/dates'
import { parseSmsTime } from './parser'

type PendingOption = {
  title?: string
  start?: string
  dayLabel?: string
  timeLabel?: string
}

type PendingEvent = {
  title: string
  start?: string
  timeLabel?: string
  location?: string
  description?: string
}

type PendingPayload = {
  options?: PendingOption[]
  events?: PendingEvent[]
}

type PendingLike = {
  kind: string
  payload: PendingPayload
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function choiceValue(value: string) {
  const normalized = value.toLowerCase()
  if (['1', 'one', 'first', '1st'].includes(normalized)) return 1
  if (['2', 'two', 'second', '2nd'].includes(normalized)) return 2
  if (['3', 'three', 'third', '3rd'].includes(normalized)) return 3
  return null
}

function parseOrdinalChoice(text: string, itemCount: number) {
  const lower = text.trim().toLowerCase()
  const directMatch = lower.match(
    /^(?:(?:book|take|choose|pick|go with|lets do|let's do|do|i(?:'d| would)? like|i want|works|that works)\s+)?(?:option\s*)?(1|2|3|one|two|three|first|second|third|1st|2nd|3rd)(?:\s+one)?(?:\s+please)?$/,
  )
  if (directMatch) return choiceValue(directMatch[1])

  if (/\b(last|latest|later)\b/.test(lower)) return itemCount
  if (/\b(earliest|first)\b/.test(lower)) return 1
  if (itemCount >= 2 && /\b(middle|second)\b/.test(lower)) return 2
  return null
}

function parseSingleOptionConfirmation(text: string) {
  const lower = text.trim().toLowerCase()
  if (
    /^(?:yes|yep|yeah|y|ok|okay|sure|sounds good|perfect|confirm|confirmed|book it|book|do it|go ahead|please do|looks good)(?:\s+please)?[.!]*$/.test(
      lower,
    )
  ) {
    return 1
  }

  return null
}

function parseDayHint(text: string) {
  const lower = text.toLowerCase()
  if (/\btoday\b/.test(lower)) return 'today'
  if (/\btomorrow'?s?\b|\btmrw\b|\btomororws?\b/.test(lower)) return 'tomorrow'

  const weekdayMatch = lower.match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  )
  return weekdayMatch?.[1] || null
}

function dayKey(dateLike?: string) {
  if (!dateLike) return null
  const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const date = new Date(dateLike)
  if (Number.isNaN(date.getTime())) return null
  return weekdayNames[dateTimePartsInTimeZone(date, undefined).weekday] || null
}

function relativeDayKey(dateLike?: string, timeZone?: string) {
  if (!dateLike) return null
  const date = new Date(dateLike)
  if (Number.isNaN(date.getTime())) return null
  const today = startOfDay(0, timeZone)
  const tomorrow = addDays(today, 1, timeZone)

  if (sameCalendarDay(date, today, timeZone)) return 'today'
  if (sameCalendarDay(date, tomorrow, timeZone)) return 'tomorrow'
  return null
}

function matchesTime(text: string, dateLike?: string, timeZone?: string) {
  const parsed = parseSmsTime(text)
  if (!parsed || !dateLike) return false

  const date = new Date(dateLike)
  const parts = dateTimePartsInTimeZone(date, timeZone)
  return parts.hour === parsed.hour && parts.minute === parsed.minute
}

function matchesTimeOfDay(text: string, dateLike?: string, timeZone?: string) {
  if (!dateLike) return false
  const lower = text.toLowerCase()
  const date = new Date(dateLike)
  const hour = dateTimePartsInTimeZone(date, timeZone).hour

  if (/\bmorning\b/.test(lower)) return hour >= 6 && hour < 12
  if (/\bafternoon\b/.test(lower)) return hour >= 12 && hour < 17
  if (/\b(evening|tonight)\b/.test(lower)) return hour >= 17
  return false
}

function matchesDay(text: string, dateLike?: string, timeZone?: string) {
  const dayHint = parseDayHint(text)
  if (!dayHint || !dateLike) return false
  const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const date = new Date(dateLike)
  const weekday = weekdayNames[dateTimePartsInTimeZone(date, timeZone).weekday] || null
  return dayHint === weekday || dayHint === relativeDayKey(dateLike, timeZone)
}

function uniqueIndex(indexes: number[]) {
  return indexes.length === 1 ? indexes[0] : null
}

function resolveOptionChoice(text: string, options: PendingOption[], timeZone?: string) {
  if (options.length === 1) {
    const confirmation = parseSingleOptionConfirmation(text)
    if (confirmation) return confirmation
  }

  const ordinal = parseOrdinalChoice(text, options.length)
  if (ordinal) return ordinal

  const lower = text.toLowerCase()
  const timeMatches = options
    .map((option, index) => (matchesTime(text, option.start, timeZone) ? index + 1 : null))
    .filter((value): value is number => value !== null)
  const uniqueTimeMatch = uniqueIndex(timeMatches)
  if (uniqueTimeMatch) return uniqueTimeMatch

  const dayAndTimeMatches = options
    .map((option, index) =>
      matchesDay(text, option.start, timeZone) &&
      (matchesTime(text, option.start, timeZone) || matchesTimeOfDay(text, option.start, timeZone))
        ? index + 1
        : null,
    )
    .filter((value): value is number => value !== null)
  const uniqueDayAndTimeMatch = uniqueIndex(dayAndTimeMatches)
  if (uniqueDayAndTimeMatch) return uniqueDayAndTimeMatch

  const titledMatches = options
    .map((option, index) => {
      const tokens = tokenize(option.title || '')
      return tokens.some((token) => token.length > 3 && lower.includes(token)) ? index + 1 : null
    })
    .filter((value): value is number => value !== null)
  const uniqueTitleMatch = uniqueIndex(titledMatches)
  if (uniqueTitleMatch) return uniqueTitleMatch

  return null
}

function resolveEventChoice(text: string, events: PendingEvent[], timeZone?: string) {
  const ordinal = parseOrdinalChoice(text, events.length)
  if (ordinal) return ordinal

  const lower = text.toLowerCase()
  const timeMatches = events
    .map((event, index) => (matchesTime(text, event.start, timeZone) ? index + 1 : null))
    .filter((value): value is number => value !== null)
  const uniqueTimeMatch = uniqueIndex(timeMatches)
  if (uniqueTimeMatch) return uniqueTimeMatch

  const titleMatches = events
    .map((event, index) => {
      const tokens = tokenize([event.title, event.location, event.description].join(' '))
      return tokens.some((token) => token.length > 3 && lower.includes(token)) ? index + 1 : null
    })
    .filter((value): value is number => value !== null)
  const uniqueTitleMatch = uniqueIndex(titleMatches)
  if (uniqueTitleMatch) return uniqueTitleMatch

  return null
}

function resolveInvitedActionChoice(text: string, kind: string) {
  const lower = text.toLowerCase()
  const ordinal = parseOrdinalChoice(text, 3)
  if (ordinal) return ordinal

  if (/\b(hold|tentative|calendar only|my calendar|just my calendar|personal hold)\b/.test(lower)) {
    return 1
  }

  if (/\b(draft|message|text them|email them|tell the organizer|send a note|decline)\b/.test(lower)) {
    return 2
  }

  if (
    /\b(keep|leave it|leave it alone|remind me|keep it|do nothing|leave as is)\b/.test(lower)
  ) {
    return 3
  }

  if (kind === 'invited_cancel_action' && /\b(remove it|take it off|remove from my calendar)\b/.test(lower)) {
    return 1
  }

  return null
}

export function resolvePendingChoice(text: string, pending: PendingLike | null, timeZone?: string) {
  if (!pending) return null

  if (
    pending.kind === 'schedule' ||
    pending.kind === 'reschedule' ||
    pending.kind === 'invited_reschedule_hold' ||
    pending.kind === 'external_call_prep'
  ) {
    return resolveOptionChoice(text, pending.payload.options || [], timeZone)
  }

  if (pending.kind === 'select_reschedule_target') {
    return resolveEventChoice(text, pending.payload.events || [], timeZone)
  }

  if (pending.kind === 'invited_reschedule_action' || pending.kind === 'invited_cancel_action') {
    return resolveInvitedActionChoice(text, pending.kind)
  }

  return null
}
