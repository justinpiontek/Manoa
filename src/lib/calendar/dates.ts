const weekdayNumbers: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export type DateTimeParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: number
}

function formatterForTimeZone(timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
}

export function dateTimePartsInTimeZone(value: Date | string, timeZone?: string): DateTimeParts {
  const date = value instanceof Date ? new Date(value) : new Date(value)
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
      weekday: date.getDay(),
    }
  }

  const parts = formatterForTimeZone(timeZone).formatToParts(date)
  const partValue = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || ''

  return {
    year: Number(partValue('year')),
    month: Number(partValue('month')),
    day: Number(partValue('day')),
    hour: Number(partValue('hour')),
    minute: Number(partValue('minute')),
    second: Number(partValue('second')),
    weekday: weekdayNumbers[partValue('weekday')] ?? date.getDay(),
  }
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = dateTimePartsInTimeZone(date, timeZone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return asUtc - date.getTime()
}

export function dateFromTimeZoneParts(
  parts: Omit<DateTimeParts, 'weekday'>,
  timeZone?: string,
) {
  if (!timeZone) {
    return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0)
  }

  const baseUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0,
  )

  let correctedUtc = baseUtc
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const offset = timeZoneOffsetMs(new Date(correctedUtc), timeZone)
    const nextUtc = baseUtc - offset
    if (nextUtc === correctedUtc) break
    correctedUtc = nextUtc
  }

  return new Date(correctedUtc)
}

export function startOfDay(offsetDays = 0, timeZone?: string) {
  if (!timeZone) {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() + offsetDays)
    return date
  }

  const today = dateTimePartsInTimeZone(new Date(), timeZone)
  const anchor = new Date(Date.UTC(today.year, today.month - 1, today.day))
  anchor.setUTCDate(anchor.getUTCDate() + offsetDays)

  return dateFromTimeZoneParts(
    {
      year: anchor.getUTCFullYear(),
      month: anchor.getUTCMonth() + 1,
      day: anchor.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
  )
}

export function endOfDay(offsetDays = 0, timeZone?: string) {
  if (!timeZone) {
    const date = startOfDay(offsetDays)
    date.setHours(23, 59, 59, 999)
    return date
  }

  return dateFromTimeZoneParts(
    {
      ...dateTimePartsInTimeZone(startOfDay(offsetDays, timeZone), timeZone),
      hour: 23,
      minute: 59,
      second: 59,
    },
    timeZone,
  )
}

export function addDays(date: Date, days: number, timeZone?: string) {
  if (!timeZone) {
    const result = new Date(date)
    result.setDate(result.getDate() + days)
    return result
  }

  const parts = dateTimePartsInTimeZone(date, timeZone)
  const anchor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  anchor.setUTCDate(anchor.getUTCDate() + days)

  return dateFromTimeZoneParts(
    {
      year: anchor.getUTCFullYear(),
      month: anchor.getUTCMonth() + 1,
      day: anchor.getUTCDate(),
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
    },
    timeZone,
  )
}

export function nextDateForWeekday(weekday: number, timeZone?: string) {
  if (!timeZone) {
    const date = startOfDay(0)
    const today = date.getDay()
    let diff = weekday - today
    if (diff <= 0) diff += 7
    date.setDate(date.getDate() + diff)
    return date
  }

  const today = startOfDay(0, timeZone)
  const todayWeekday = dateTimePartsInTimeZone(today, timeZone).weekday
  let diff = weekday - todayWeekday
  if (diff <= 0) diff += 7
  return addDays(today, diff, timeZone)
}

export function setTime(date: Date, time: { hour: number; minute: number }, timeZone?: string) {
  if (!timeZone) {
    const result = new Date(date)
    result.setHours(time.hour, time.minute, 0, 0)
    return result
  }

  const parts = dateTimePartsInTimeZone(date, timeZone)
  return dateFromTimeZoneParts(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: time.hour,
      minute: time.minute,
      second: 0,
    },
    timeZone,
  )
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

export function overlaps(
  candidate: { start: Date; end: Date },
  busy: Array<{ start: Date; end: Date }>,
) {
  return busy.some((block) => candidate.start < block.end && candidate.end > block.start)
}

export function sameCalendarDay(left: Date | string, right: Date | string, timeZone?: string) {
  const leftParts = dateTimePartsInTimeZone(left, timeZone)
  const rightParts = dateTimePartsInTimeZone(right, timeZone)
  return (
    leftParts.year === rightParts.year &&
    leftParts.month === rightParts.month &&
    leftParts.day === rightParts.day
  )
}

export function formatSmsDate(date: Date, timeZone?: string) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  })
}

export function formatSmsTime(date: Date, timeZone?: string) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  })
}
