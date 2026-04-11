import { NextRequest } from 'next/server'
import { microsoftAuthUrl } from '@/src/lib/calendar/google'

export async function GET(request: NextRequest) {
  const profileId = request.nextUrl.searchParams.get('profile_id')
  const accountId = request.nextUrl.searchParams.get('account_id')
  if (!profileId) {
    return new Response('Missing profile_id.', { status: 400 })
  }

  const state = new URLSearchParams()
  state.set('profile_id', profileId)
  if (accountId) state.set('account_id', accountId)

  return Response.redirect(microsoftAuthUrl(state.toString()), 303)
}
