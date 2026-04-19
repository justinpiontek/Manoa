import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
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
