import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import { disconnectCalendarAccount, type CalendarProvider } from '@/src/lib/calendar/google'

function isProvider(value: string): value is CalendarProvider {
  return value === 'google' || value === 'outlook'
}

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const profileId = String(formData.get('profile_id') || '').trim()
  const accountId = String(formData.get('account_id') || '').trim()
  const provider = String(formData.get('provider') || '').trim()

  if (!profileId || !accountId || !isProvider(provider)) {
    return new Response('Missing calendar account details.', { status: 400 })
  }

  await disconnectCalendarAccount({
    profileId,
    provider,
    accountId,
  })

  return Response.redirect(`${appUrl()}/dashboard?profile_id=${profileId}&calendar=disconnected`, 303)
}
