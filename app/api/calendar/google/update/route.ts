import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import {
  assertMatchingDashboardProfile,
  getAuthenticatedDashboardProfileForRoute,
} from '@/src/lib/dashboardAuth'
import { updateConfiguredCalendar } from '@/src/lib/calendar/google'

function checked(formData: FormData, name: string) {
  return formData.getAll(name).some((value) => String(value) === 'on')
}

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const profileId = String(formData.get('profile_id') || '').trim()
  const connectionId = String(formData.get('connection_id') || '').trim()
  const calendarLabel = String(formData.get('calendar_label') || '').trim()
  const includeInConflicts = checked(formData, 'include_in_conflicts')
  const allowNewEvents = checked(formData, 'allow_new_events')
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

  await updateConfiguredCalendar({
    profileId: profile.id,
    connectionId,
    calendarLabel,
    includeInConflicts,
    allowNewEvents,
  })

  return Response.redirect(`${appUrl()}/dashboard`, 303)
}
