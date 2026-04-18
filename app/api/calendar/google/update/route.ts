import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import { updateConfiguredCalendar } from '@/src/lib/calendar/google'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const profileId = String(formData.get('profile_id') || '').trim()
  const connectionId = String(formData.get('connection_id') || '').trim()
  const calendarLabel = String(formData.get('calendar_label') || '').trim()
  const includeInConflicts = formData.get('include_in_conflicts') === 'on'
  const allowNewEvents = formData.get('allow_new_events') === 'on'

  if (!profileId || !connectionId) {
    return new Response('Missing profile or calendar connection.', { status: 400 })
  }

  await updateConfiguredCalendar({
    profileId,
    connectionId,
    calendarLabel,
    includeInConflicts,
    allowNewEvents,
  })

  return Response.redirect(`${appUrl()}/dashboard?profile_id=${profileId}`, 303)
}
