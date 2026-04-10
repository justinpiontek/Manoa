import { NextRequest } from 'next/server'
import { googleAuthUrl } from '@/src/lib/calendar/google'

export async function GET(request: NextRequest) {
  const profileId = request.nextUrl.searchParams.get('profile_id')
  if (!profileId) {
    return new Response('Missing profile_id.', { status: 400 })
  }

  return Response.redirect(googleAuthUrl(profileId), 303)
}
