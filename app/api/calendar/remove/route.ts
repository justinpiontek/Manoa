import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import { removeConfiguredCalendar } from '@/src/lib/calendar/google'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const profileId = String(formData.get('profile_id') || '').trim()
  const connectionId = String(formData.get('connection_id') || '').trim()

  if (!profileId || !connectionId) {
    return new Response('Missing profile or calendar connection.', { status: 400 })
  }

  await removeConfiguredCalendar({
    profileId,
    connectionId,
  })

  return Response.redirect(`${appUrl()}/dashboard?profile_id=${profileId}&calendar=removed`, 303)
}
