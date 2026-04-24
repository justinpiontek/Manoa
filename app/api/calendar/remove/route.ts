import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import {
  assertMatchingDashboardProfile,
  getAuthenticatedDashboardProfileForRoute,
} from '@/src/lib/dashboardAuth'
import { removeConfiguredCalendar } from '@/src/lib/calendar/google'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const profileId = String(formData.get('profile_id') || '').trim()
  const connectionId = String(formData.get('connection_id') || '').trim()
  const profile = await getAuthenticatedDashboardProfileForRoute()

  if (!profile) {
    return Response.redirect(`${appUrl()}/login`, 303)
  }

  if (!connectionId) {
    return new Response('Missing profile or calendar connection.', { status: 400 })
  }

  if (!assertMatchingDashboardProfile(profileId, profile)) {
    return new Response('Profile mismatch.', { status: 403 })
  }

  await removeConfiguredCalendar({
    profileId: profile.id,
    connectionId,
  })

  return Response.redirect(`${appUrl()}/dashboard?calendar=removed`, 303)
}
