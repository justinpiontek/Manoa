import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import {
  assertMatchingDashboardProfile,
  getAuthenticatedDashboardProfileForRoute,
} from '@/src/lib/dashboardAuth'
import { isMissingNotificationSettingsColumnError } from '@/src/lib/profiles'
import { supabaseAdmin } from '@/src/lib/supabaseAdmin'

const allowedReminderLeadMinutes = new Set([5, 15, 30, 60])

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const profileId = String(formData.get('profile_id') || '').trim()
  const reminderLeadMinutes = Number(formData.get('reminder_lead_minutes') || '0')
  const morningAgendaEnabled = String(formData.get('morning_agenda_enabled') || '').trim() === 'yes'
  const reminderTextsEnabled = String(formData.get('reminder_texts_enabled') || '').trim() === 'yes'
  const profile = await getAuthenticatedDashboardProfileForRoute()

  if (!profile) {
    return Response.redirect(`${appUrl()}/login`, 303)
  }

  if (!assertMatchingDashboardProfile(profileId, profile)) {
    return new Response('Profile mismatch.', { status: 403 })
  }

  if (!allowedReminderLeadMinutes.has(reminderLeadMinutes)) {
    return Response.redirect(`${appUrl()}/dashboard?settings=notifications_invalid`, 303)
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      morning_agenda_enabled: morningAgendaEnabled,
      reminder_texts_enabled: reminderTextsEnabled,
      reminder_lead_minutes: reminderLeadMinutes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profile.id)

  if (error) {
    if (isMissingNotificationSettingsColumnError(error)) {
      return Response.redirect(`${appUrl()}/dashboard?settings=notifications_unavailable`, 303)
    }
    return Response.redirect(`${appUrl()}/dashboard?settings=notifications_error`, 303)
  }

  return Response.redirect(`${appUrl()}/dashboard?settings=notifications_saved`, 303)
}
