import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import {
  assertMatchingDashboardProfile,
  getAuthenticatedDashboardProfileForRoute,
} from '@/src/lib/dashboardAuth'
import { supabaseAdmin } from '@/src/lib/supabaseAdmin'

function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
    return true
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const profileId = String(formData.get('profile_id') || '').trim()
  const timezone = String(formData.get('timezone') || '').trim()
  const profile = await getAuthenticatedDashboardProfileForRoute()

  if (!profile) {
    return Response.redirect(`${appUrl()}/login`, 303)
  }

  if (!assertMatchingDashboardProfile(profileId, profile)) {
    return new Response('Profile mismatch.', { status: 403 })
  }

  if (!timezone || !isValidTimezone(timezone)) {
    return Response.redirect(`${appUrl()}/dashboard?settings=timezone_invalid`, 303)
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      timezone,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profile.id)

  if (error) throw error

  return Response.redirect(`${appUrl()}/dashboard?settings=timezone_saved`, 303)
}
