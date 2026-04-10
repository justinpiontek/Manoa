export function startOfDay(offsetDays = 0) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + offsetDays)
  return date
}

export function endOfDay(offsetDays = 0) {
  const date = startOfDay(offsetDays)
  date.setHours(23, 59, 59, 999)
  return date
}

export function nextDateForWeekday(weekday: number) {
  const date = startOfDay(0)
  const today = date.getDay()
  let diff = weekday - today
  if (diff <= 0) diff += 7
  date.setDate(date.getDate() + diff)
  return date
}

export function setTime(date: Date, time: { hour: number; minute: number }) {
  const result = new Date(date)
  result.setHours(time.hour, time.minute, 0, 0)
  return result
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

export function formatSmsDate(date: Date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export function formatSmsTime(date: Date) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}
