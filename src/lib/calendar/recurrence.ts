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

function nthWeekdayOfMonth(date: Date) {
  return Math.floor((date.getDate() - 1) / 7) + 1
}

function asDate(value: Date | string) {
  return value instanceof Date ? new Date(value) : new Date(value)
}

export function recurrenceSummary(spec: RecurrenceSpec | null | undefined, start: Date | string) {
  if (!spec) return null

  const date = asDate(start)
  if (Number.isNaN(date.getTime())) return null

  if (spec.unit === 'week') {
    const weekday = weekdayNames[date.getDay()]
    return spec.interval === 2
      ? `Repeats every other ${weekday}.`
      : `Repeats every ${weekday}.`
  }

  if (spec.mode === 'nth_weekday') {
    return `Repeats monthly on the ${ordinalWord(nthWeekdayOfMonth(date))} ${
      weekdayNames[date.getDay()]
    }.`
  }

  return `Repeats monthly on the ${date.getDate()}${ordinalSuffix(date.getDate())}.`
}

export function recurrenceRule(spec: RecurrenceSpec | null | undefined, start: Date | string) {
  if (!spec) return null

  const date = asDate(start)
  if (Number.isNaN(date.getTime())) return null

  if (spec.unit === 'week') {
    return `RRULE:FREQ=WEEKLY;INTERVAL=${spec.interval};BYDAY=${weekdayCodes[date.getDay()]}`
  }

  if (spec.mode === 'nth_weekday') {
    return `RRULE:FREQ=MONTHLY;INTERVAL=1;BYDAY=${weekdayCodes[date.getDay()]};BYSETPOS=${nthWeekdayOfMonth(
      date,
    )}`
  }

  return `RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${date.getDate()}`
}
