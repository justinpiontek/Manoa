import { listAgenda } from './calendar/google'
import { supabaseAdmin } from './supabaseAdmin'
import { sendSms } from './twilioClient'

type ActiveProfile = {
  id: string
  phone_e164: string
}

function agendaText(events: Awaited<ReturnType<typeof listAgenda>>) {
  if (!events.length) return "Good morning. You're clear today."
  return `Good morning. Today:\n${events
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

export async function sendDueReminders() {
  const { data: reminders, error } = await supabaseAdmin
    .from('reminders')
    .select('id,profile_id,phone_e164,body,event_starts_at')
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
