import { dateTimePartsInTimeZone } from './dates'

export type RecurrenceSpec =
  | {
      unit: 'week'
      interval: 1 | 2
    }
  | {
      unit: 'month'
      interval: 1
      mode: 'month_day' | 'nth_weekday'
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
    const weekday = weekdayNames[parts.weekday]
    return spec.interval === 2
      ? `Repeats every other ${weekday}.`
      : `Repeats every ${weekday}.`
  }

  if (spec.mode === 'nth_weekday') {
    return `Repeats monthly on the ${ordinalWord(nthWeekdayOfMonth(parts.day))} ${
      weekdayNames[parts.weekday]
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
    return `RRULE:FREQ=WEEKLY;INTERVAL=${spec.interval};BYDAY=${weekdayCodes[parts.weekday]}`
  }

  if (spec.mode === 'nth_weekday') {
    return `RRULE:FREQ=MONTHLY;INTERVAL=1;BYDAY=${weekdayCodes[parts.weekday]};BYSETPOS=${nthWeekdayOfMonth(
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
    if ((interval === 1 || interval === 2) && fields.BYDAY) {
      return {
        unit: 'week',
        interval: interval as 1 | 2,
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
      return {
        unit: 'month',
        interval: 1,
        mode: 'nth_weekday',
      }
    }
  }

  return null
}
