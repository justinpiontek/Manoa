import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import {
  assertMatchingDashboardProfile,
  getAuthenticatedDashboardProfileForRoute,
} from '@/src/lib/dashboardAuth'
import { isMissingDefaultDurationColumnError } from '@/src/lib/profiles'
import { supabaseAdmin } from '@/src/lib/supabaseAdmin'

const allowedDurations = new Set([15, 30, 45, 60, 90])

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const profileId = String(formData.get('profile_id') || '').trim()
  const durationMinutes = Number(formData.get('default_event_duration_minutes') || '0')
  const profile = await getAuthenticatedDashboardProfileForRoute()

  if (!profile) {
    return Response.redirect(`${appUrl()}/login`, 303)
  }

  if (!assertMatchingDashboardProfile(profileId, profile)) {
    return new Response('Profile mismatch.', { status: 403 })
  }

  if (!allowedDurations.has(durationMinutes)) {
    return new Response('Choose a valid default duration.', { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      default_event_duration_minutes: durationMinutes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profile.id)

  if (error) {
    if (isMissingDefaultDurationColumnError(error)) {
      return Response.redirect(
        `${appUrl()}/dashboard?settings=duration_unavailable`,
        303,
      )
    }
    throw error
  }

  return Response.redirect(`${appUrl()}/dashboard?settings=duration_saved`, 303)
}
