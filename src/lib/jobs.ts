import { getCalendarEvent, listAgenda, listUpcomingEvents } from './calendar/google'
import { supabaseAdmin } from './supabaseAdmin'
import { sendSms } from './twilioClient'

type ActiveProfile = {
  id: string
  phone_e164: string
}

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
    .select('id,phone_e164')
    .in('id', profileIds)
    .is('sms_opted_out_at', null)
    .returns<ActiveProfile[]>()

  if (profileError) throw profileError
  return profiles || []
}

export async function sendMorningAgendas() {
  const profiles = await activeSubscriberProfiles()
  const results = []

  for (const profile of profiles) {
    const events = await listAgenda(profile.id, 'today')
    const message = agendaText(events)
    const result = await sendSms({ to: profile.phone_e164, body: message })
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

      const dueDate = new Date(new Date(startsAt).getTime() - 30 * 60_000)
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
