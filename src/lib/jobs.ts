import { getCalendarEvent, listAgenda, listUpcomingEvents } from './calendar/google'
import { DEFAULT_REMINDER_LEAD_MINUTES } from './reminders'
import { supabaseAdmin } from './supabaseAdmin'
import { sendSms } from './twilioClient'

type ActiveProfile = {
  id: string
  phone_e164: string
  timezone: string
}

const MORNING_AGENDA_HOUR = 6
const MORNING_AGENDA_MINUTE = 30
const MORNING_AGENDA_WINDOW_MINUTES = 15

function sortAgendaEvents(events: Awaited<ReturnType<typeof listAgenda>>) {
  return [...events].sort((left, right) => {
    const leftTime = new Date(left.start).getTime()
    const rightTime = new Date(right.start).getTime()

    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0
    if (Number.isNaN(leftTime)) return 1
    if (Number.isNaN(rightTime)) return -1
    return leftTime - rightTime
  })
}

function normalizeIso(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function agendaText(events: Awaited<ReturnType<typeof listAgenda>>) {
  if (!events.length) return "Good morning. You're clear today."
  return `Good morning. Today:\n${sortAgendaEvents(events)
    .map((event) => `${event.timeLabel} ${event.title} (${event.calendarName})`)
    .join('\n')}`
}

export async function activeSubscriberProfiles() {
  const { data: subscriptions, error } = await supabaseAdmin
    .from('subscriptions')
    .select('profile_id')
    .in('status', ['active', 'trialing'])

  if (error) throw error

  const profileIds = [...new Set((subscriptions || []).map((item) => item.profile_id))]
  if (!profileIds.length) return []

  const { data: profiles, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id,phone_e164,timezone')
    .in('id', profileIds)
    .not('phone_e164', 'is', null)
    .is('sms_opted_out_at', null)
    .returns<ActiveProfile[]>()

  if (profileError) throw profileError
  return profiles || []
}

function datePartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  const parts = formatter.formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value || ''

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: Number(value('hour') || '0'),
    minute: Number(value('minute') || '0'),
    dateKey: `${value('year')}-${value('month')}-${value('day')}`,
  }
}

function isMorningAgendaWindow(date: Date, timeZone: string) {
  const local = datePartsInTimeZone(date, timeZone)
  return (
    local.hour === MORNING_AGENDA_HOUR &&
    local.minute >= MORNING_AGENDA_MINUTE &&
    local.minute < MORNING_AGENDA_MINUTE + MORNING_AGENDA_WINDOW_MINUTES
  )
}

async function alreadySentMorningAgendaToday(profile: ActiveProfile, now: Date) {
  const { data, error } = await supabaseAdmin
    .from('sms_messages')
    .select('created_at,body')
    .eq('profile_id', profile.id)
    .eq('direction', 'outbound')
    .gte('created_at', new Date(now.getTime() - 36 * 60 * 60_000).toISOString())
    .ilike('body', 'Good morning.%')
    .returns<{ created_at: string; body: string }[]>()

  if (error) throw error

  const todayKey = datePartsInTimeZone(now, profile.timezone).dateKey
  return (data || []).some((message) => {
    const createdAt = new Date(message.created_at)
    if (Number.isNaN(createdAt.getTime())) return false
    return datePartsInTimeZone(createdAt, profile.timezone).dateKey === todayKey
  })
}

export async function sendMorningAgendas() {
  const profiles = await activeSubscriberProfiles()
  const results = []
  const now = new Date()

  for (const profile of profiles) {
    if (!isMorningAgendaWindow(now, profile.timezone)) continue
    if (await alreadySentMorningAgendaToday(profile, now)) continue

    const events = await listAgenda(profile.id, 'today', profile.timezone)
    const message = agendaText(events)
    const result = await sendSms({ to: profile.phone_e164, body: message })
    await supabaseAdmin.from('sms_messages').insert({
      profile_id: profile.id,
      from_e164: profile.phone_e164,
      body: message,
      direction: 'outbound',
      twilio_message_sid: result.sid,
    })
    results.push({ profileId: profile.id, sid: result.sid })
  }

  return results
}

async function reminderExistsForOccurrence({
  profileId,
  calendarEventId,
  startsAt,
}: {
  profileId: string
  calendarEventId: string
  startsAt: string
}) {
  const { data, error } = await supabaseAdmin
    .from('reminders')
    .select('id')
    .eq('profile_id', profileId)
    .eq('calendar_event_id', calendarEventId)
    .eq('event_starts_at', startsAt)
    .neq('status', 'canceled')
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (error) throw error
  return Boolean(data)
}

async function ensureUpcomingReminders() {
  const profiles = await activeSubscriberProfiles()

  for (const profile of profiles) {
    const events = await listUpcomingEvents({
      profileId: profile.id,
      windowMinutes: 90,
      startAt: new Date(),
      maxResults: 20,
    })

    for (const event of events) {
      if (!event.id || !event.start || event.timeLabel === 'All day') continue

      const startsAt = normalizeIso(event.start)
      if (!startsAt) continue

      if (
        await reminderExistsForOccurrence({
          profileId: profile.id,
          calendarEventId: event.id,
          startsAt,
        })
      ) {
        continue
      }

      const dueDate = new Date(
        new Date(startsAt).getTime() - DEFAULT_REMINDER_LEAD_MINUTES * 60_000,
      )
      const dueAt =
        dueDate.getTime() <= Date.now() ? new Date().toISOString() : dueDate.toISOString()

      const { error } = await supabaseAdmin.from('reminders').insert({
        profile_id: profile.id,
        phone_e164: profile.phone_e164,
        calendar_event_id: event.id,
        calendar_id: event.calendarId || null,
        event_starts_at: startsAt,
        due_at: dueAt,
        body: `Reminder: ${event.title} starts at ${event.timeLabel}.`,
        status: 'pending',
      })

      if (error) throw error
    }
  }
}

export async function sendDueReminders() {
  await ensureUpcomingReminders()

  const { data: reminders, error } = await supabaseAdmin
    .from('reminders')
    .select('id,profile_id,phone_e164,body,event_starts_at,calendar_event_id,calendar_id')
    .eq('status', 'pending')
    .lte('due_at', new Date().toISOString())
    .limit(50)

  if (error) throw error

  const sent = []
  for (const reminder of reminders || []) {
    if (reminder.event_starts_at && new Date(reminder.event_starts_at).getTime() <= Date.now()) {
      await supabaseAdmin
        .from('reminders')
        .update({
          status: 'canceled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', reminder.id)
      continue
    }

    if (reminder.calendar_event_id) {
      const liveEvent = await getCalendarEvent(
        reminder.profile_id,
        reminder.calendar_event_id,
        reminder.calendar_id || undefined,
      )
      const liveStart = normalizeIso(liveEvent?.start)
      const storedStart = normalizeIso(reminder.event_starts_at)

      if (!liveEvent || (storedStart && liveStart && storedStart !== liveStart)) {
        await supabaseAdmin
          .from('reminders')
          .update({
            status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('id', reminder.id)
        continue
      }
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('sms_opted_out_at')
      .eq('id', reminder.profile_id)
      .maybeSingle<{ sms_opted_out_at: string | null }>()

    if (profile?.sms_opted_out_at) {
      await supabaseAdmin
        .from('reminders')
        .update({
          status: 'canceled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', reminder.id)
      continue
    }

    const result = await sendSms({ to: reminder.phone_e164, body: reminder.body })
    await supabaseAdmin
      .from('reminders')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        twilio_message_sid: result.sid,
      })
      .eq('id', reminder.id)
    sent.push({ reminderId: reminder.id, sid: result.sid })
  }

  return sent
}
