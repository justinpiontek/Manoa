import { dateTimePartsInTimeZone } from './dates'

export type RecurrenceSpec =
  | {
      unit: 'week'
      interval: 1 | 2
      weekday?: number
      weekdays?: number[]
    }
  | {
      unit: 'month'
      interval: 1
      mode: 'month_day' | 'nth_weekday'
      weekday?: number
    }

const weekdayCodes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const
const weekdayNames = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

function ordinalWord(value: number) {
  switch (value) {
    case 1:
      return 'first'
    case 2:
      return 'second'
    case 3:
      return 'third'
    case 4:
      return 'fourth'
    case 5:
      return 'fifth'
    default:
      return `${value}th`
  }
}

function ordinalSuffix(value: number) {
  const mod100 = value % 100
  if (mod100 >= 11 && mod100 <= 13) return 'th'

  switch (value % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

function nthWeekdayOfMonth(dayOfMonth: number) {
  return Math.floor((dayOfMonth - 1) / 7) + 1
}

function asDate(value: Date | string) {
  return value instanceof Date ? new Date(value) : new Date(value)
}

function uniqueSortedWeekdays(days: number[]) {
  return [...new Set(days.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))].sort((left, right) => left - right)
}

function joinLabels(labels: string[]) {
  if (!labels.length) return ''
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
}

export function weeklyRecurrenceDays(
  spec: RecurrenceSpec | null | undefined,
  start: Date | string,
  timeZone?: string,
) {
  if (!spec || spec.unit !== 'week') return []

  const date = asDate(start)
  if (Number.isNaN(date.getTime())) return []
  const fallbackWeekday = dateTimePartsInTimeZone(date, timeZone).weekday

  return uniqueSortedWeekdays(
    Array.isArray(spec.weekdays) && spec.weekdays.length
      ? spec.weekdays
      : [spec.weekday ?? fallbackWeekday],
  )
}

export function recurrenceSummary(
  spec: RecurrenceSpec | null | undefined,
  start: Date | string,
  timeZone?: string,
) {
  if (!spec) return null

  const date = asDate(start)
  if (Number.isNaN(date.getTime())) return null
  const parts = dateTimePartsInTimeZone(date, timeZone)

  if (spec.unit === 'week') {
    const weekday = joinLabels(
      weeklyRecurrenceDays(spec, date, timeZone).map((value) => weekdayNames[value]),
    ) || weekdayNames[spec.weekday ?? parts.weekday]
    return spec.interval === 2
      ? `Repeats every other ${weekday}.`
      : `Repeats every ${weekday}.`
  }

  if (spec.mode === 'nth_weekday') {
    return `Repeats monthly on the ${ordinalWord(nthWeekdayOfMonth(parts.day))} ${
      weekdayNames[spec.weekday ?? parts.weekday]
    }.`
  }

  return `Repeats monthly on the ${parts.day}${ordinalSuffix(parts.day)}.`
}

export function recurrenceRule(
  spec: RecurrenceSpec | null | undefined,
  start: Date | string,
  timeZone?: string,
) {
  if (!spec) return null

  const date = asDate(start)
  if (Number.isNaN(date.getTime())) return null
  const parts = dateTimePartsInTimeZone(date, timeZone)

  if (spec.unit === 'week') {
    const weekdays = weeklyRecurrenceDays(spec, date, timeZone)
    const byDay = weekdays.length
      ? weekdays.map((weekday) => weekdayCodes[weekday]).join(',')
      : weekdayCodes[spec.weekday ?? parts.weekday]
    return `RRULE:FREQ=WEEKLY;INTERVAL=${spec.interval};BYDAY=${byDay}`
  }

  const weekday = spec.weekday ?? parts.weekday
  if (spec.mode === 'nth_weekday') {
    return `RRULE:FREQ=MONTHLY;INTERVAL=1;BYDAY=${weekdayCodes[weekday]};BYSETPOS=${nthWeekdayOfMonth(
      parts.day,
    )}`
  }

  return `RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${parts.day}`
}

export function parseGoogleRecurrence(recurrence: string[] | null | undefined): RecurrenceSpec | null {
  const rule = recurrence?.find((value) => value.startsWith('RRULE:'))
  if (!rule) return null

  const fields = Object.fromEntries(
    rule
      .replace(/^RRULE:/, '')
      .split(';')
      .map((part) => {
        const [key, value] = part.split('=')
        return [key, value]
      }),
      ) as Record<string, string | undefined>

  if (fields.FREQ === 'WEEKLY') {
    const interval = Number(fields.INTERVAL || '1')
    const weekdayIndexes = uniqueSortedWeekdays(
      (fields.BYDAY || '')
        .split(',')
        .map((weekday) => weekdayCodes.indexOf(weekday as (typeof weekdayCodes)[number]))
        .filter((value) => value >= 0),
    )
    if ((interval === 1 || interval === 2) && weekdayIndexes.length) {
      return weekdayIndexes.length === 1
        ? {
            unit: 'week',
            interval: interval as 1 | 2,
            weekday: weekdayIndexes[0],
          }
        : {
            unit: 'week',
            interval: interval as 1 | 2,
            weekdays: weekdayIndexes,
          }
    }
  }

  if (fields.FREQ === 'MONTHLY') {
    if (fields.BYMONTHDAY) {
      return {
        unit: 'month',
        interval: 1,
        mode: 'month_day',
      }
    }

    const bySetPos = Number(fields.BYSETPOS || '')
    if (fields.BYDAY && Number.isInteger(bySetPos) && bySetPos >= 1 && bySetPos <= 5) {
      const weekday = fields.BYDAY.split(',')[0]
      const weekdayIndex = weekdayCodes.indexOf(weekday as (typeof weekdayCodes)[number])
      return {
        unit: 'month',
        interval: 1,
        mode: 'nth_weekday',
        weekday: weekdayIndex >= 0 ? weekdayIndex : undefined,
      }
    }
  }

  return null
}
