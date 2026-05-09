import {
  createCalendarEvent,
  listUpcomingEvents,
  resolveCalendarPlacement,
  type CalendarPlacementOption,
  type ScheduleOption,
} from '../calendar/google'
import {
  addMinutes,
  addDays,
  dateFromTimeZoneParts,
  formatSmsDate,
  formatSmsTime,
} from '../calendar/dates'
import { supabaseAdmin } from '../supabaseAdmin'
import type { CalendarImageEvent, CalendarImageResult } from './calendarImage'

type CalendarImageBatchProfile = {
  id: string
  phone_e164: string | null
  timezone: string
  default_event_duration_minutes: number
}

export type CalendarImageBatchResult = {
  ok: boolean
  reply: string
  createdCount: number
  skippedCount: number
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function parseYmd(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
}

function parseTime24h(value: string | null) {
  if (!value) return null
  const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!match) return null

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  }
}

export function calendarHintFromImageCaption(caption: string | null | undefined) {
  const raw = (caption || '').trim()
  if (!raw) return null

  const explicit = raw.match(/\b(?:to|on|in)\s+(.+?)(?:\s+calendar)?[.!?]*$/i)
  if (explicit?.[1]) {
    return explicit[1]
      .replace(/\bcalendar\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const cleaned = raw
    .replace(/^(?:add|put|save|import)\s+(?:these|this|it|schedule|events?)?\s*/i, '')
    .replace(/^(?:to|on|in)\s+/i, '')
    .replace(/\bcalendar\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned && cleaned.split(/\s+/).length <= 4 ? cleaned : null
}

function scheduleOptionFromImageEvent({
  event,
  calendar,
  timeZone,
  defaultDurationMinutes,
}: {
  event: CalendarImageEvent
  calendar: CalendarPlacementOption
  timeZone: string
  defaultDurationMinutes: number
}): ScheduleOption | null {
  const date = parseYmd(event.dateYmd)
  if (!date) return null

  if (event.isAllDay) {
    const endDate = parseYmd(event.endDateYmd || event.dateYmd)
    if (!endDate) return null

    const start = dateFromTimeZoneParts({
      year: date.year,
      month: date.month,
      day: date.day,
      hour: 0,
      minute: 0,
      second: 0,
    }, timeZone)
    const inclusiveEnd = dateFromTimeZoneParts({
      year: endDate.year,
      month: endDate.month,
      day: endDate.day,
      hour: 0,
      minute: 0,
      second: 0,
    }, timeZone)
    const end = addDays(inclusiveEnd, 1, timeZone)
    const dayLabel =
      event.endDateYmd && event.endDateYmd !== event.dateYmd
        ? `${formatSmsDate(start, timeZone)} through ${formatSmsDate(inclusiveEnd, timeZone)}`
        : formatSmsDate(start, timeZone)

    return {
      title: event.title,
      start: start.toISOString(),
      end: end.toISOString(),
      isAllDay: true,
      provider: calendar.provider,
      calendarId: calendar.calendarId,
      calendarName: calendar.calendarLabel,
      dayLabel,
      timeLabel: 'All day',
      timeZone,
      location: event.location,
      recurrence: null,
    }
  }

  const time = parseTime24h(event.time24h)
  if (!time) return null

  const start = dateFromTimeZoneParts({
    year: date.year,
    month: date.month,
    day: date.day,
    hour: time.hour,
    minute: time.minute,
    second: 0,
  }, timeZone)
  const duration = event.durationMinutes && event.durationMinutes > 0
    ? event.durationMinutes
    : defaultDurationMinutes
  const end = addMinutes(start, duration)

  return {
    title: event.title,
    start: start.toISOString(),
    end: end.toISOString(),
    provider: calendar.provider,
    calendarId: calendar.calendarId,
    calendarName: calendar.calendarLabel,
    dayLabel: formatSmsDate(start, timeZone),
    timeLabel: formatSmsTime(start, timeZone),
    timeZone,
    location: event.location,
    recurrence: null,
  }
}

async function alreadyOnCalendar(profileId: string, option: ScheduleOption, timeZone: string) {
  const existing = await listUpcomingEvents({
    profileId,
    startAt: new Date(option.start),
    windowMinutes: Math.max(5, Math.ceil((new Date(option.end).getTime() - new Date(option.start).getTime()) / 60000)),
    maxResults: 20,
    timeZone,
  })

  const targetTitle = normalize(option.title)
  const targetStart = new Date(option.start).getTime()
  return existing.some((event) => {
    const eventStart = new Date(event.start).getTime()
    return (
      event.calendarId === option.calendarId &&
      normalize(event.title) === targetTitle &&
      Math.abs(eventStart - targetStart) < 60_000
    )
  })
}

async function queueBatchReminder({
  profile,
  option,
  eventId,
}: {
  profile: CalendarImageBatchProfile
  option: ScheduleOption
  eventId?: string | null
}) {
  if (option.isAllDay) return

  const start = new Date(option.start)
  const dueAt = addMinutes(start, -30)
  if (!profile.phone_e164 || dueAt <= new Date()) return

  const { error } = await supabaseAdmin.from('reminders').insert({
    profile_id: profile.id,
    phone_e164: profile.phone_e164,
    calendar_event_id: eventId || null,
    calendar_id: option.calendarId,
    event_starts_at: start.toISOString(),
    due_at: dueAt.toISOString(),
    body: `Reminder: ${option.title} starts at ${formatSmsTime(start, profile.timezone)}.`,
    status: 'pending',
  })

  if (error) throw error
}

function calendarChoicesText(calendars: CalendarPlacementOption[]) {
  return calendars.slice(0, 6).map((calendar) => calendar.calendarLabel).join(', ')
}

function batchList(options: ScheduleOption[]) {
  return options.slice(0, 6).map((option, index) => {
    return `${index + 1}. ${option.dayLabel} at ${option.timeLabel} ${option.title}`
  }).join('\n')
}

export async function createCalendarImageBatch({
  profile,
  result,
  calendarHint,
}: {
  profile: CalendarImageBatchProfile
  result: CalendarImageResult
  calendarHint?: string | null
}): Promise<CalendarImageBatchResult> {
  const fixedEvents = result.events
    .filter((event) => event.isConfirmedOrFixed)
    .slice(0, 12)

  if (fixedEvents.length < 2) {
    return {
      ok: false,
      reply: 'I can read one proposed event at a time. Send the clearest event or type the details.',
      createdCount: 0,
      skippedCount: 0,
    }
  }

  const placement = await resolveCalendarPlacement(profile.id, calendarHint || undefined)
  if (!placement.bookingCalendars.length) {
    return {
      ok: false,
      reply: 'I found the schedule, but no connected calendar is set to accept new events yet.',
      createdCount: 0,
      skippedCount: 0,
    }
  }

  const calendar =
    calendarHint && placement.matches.length === 1
      ? placement.matches[0]
      : !calendarHint && placement.bookingCalendars.length === 1
        ? placement.bookingCalendars[0]
        : null

  if (!calendar) {
    const choices = calendarChoicesText(
      calendarHint && placement.matches.length > 1
        ? placement.matches
        : placement.bookingCalendars,
    )
    return {
      ok: false,
      reply: `I found ${fixedEvents.length} events. Tell me which calendar to add them to, like "add to Home", then upload it again.\nChoices: ${choices}`,
      createdCount: 0,
      skippedCount: 0,
    }
  }

  const created: ScheduleOption[] = []
  const skipped: ScheduleOption[] = []
  const failed: ScheduleOption[] = []

  for (const event of fixedEvents) {
    const option = scheduleOptionFromImageEvent({
      event,
      calendar,
      timeZone: profile.timezone,
      defaultDurationMinutes: profile.default_event_duration_minutes,
    })
    if (!option) continue

    try {
      if (await alreadyOnCalendar(profile.id, option, profile.timezone)) {
        skipped.push(option)
        continue
      }

      const createdEvent = await createCalendarEvent(profile.id, option)
      await queueBatchReminder({
        profile,
        option,
        eventId: createdEvent.id || null,
      })
      created.push(option)
    } catch {
      failed.push(option)
    }
  }

  if (!created.length && skipped.length) {
    return {
      ok: true,
      reply: `I found ${fixedEvents.length} events, but they already look like they are on ${calendar.calendarLabel}.`,
      createdCount: 0,
      skippedCount: skipped.length,
    }
  }

  if (!created.length) {
    return {
      ok: false,
      reply: `I found ${fixedEvents.length} events, but I could not add them to ${calendar.calendarLabel}. Try one clearer photo or a different calendar.`,
      createdCount: 0,
      skippedCount: skipped.length,
    }
  }

  const lines = [
    `Added ${created.length} event${created.length === 1 ? '' : 's'} to ${calendar.calendarLabel}.`,
    batchList(created),
  ]

  if (skipped.length) {
    lines.push(`Skipped ${skipped.length} that already looked saved.`)
  }

  if (failed.length) {
    lines.push(`Could not add ${failed.length}. Try those one at a time if they matter.`)
  }

  return {
    ok: true,
    reply: lines.join('\n'),
    createdCount: created.length,
    skippedCount: skipped.length,
  }
}
