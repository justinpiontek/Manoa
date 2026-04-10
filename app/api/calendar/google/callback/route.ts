import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import { googleOAuthClient, storeGoogleConnection } from '@/src/lib/calendar/google'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const profileId = request.nextUrl.searchParams.get('state')

  if (!code || !profileId) {
    return new Response('Missing Google OAuth code or state.', { status: 400 })
  }

  const client = googleOAuthClient()
  const tokenResponse = await client.getToken(code)
  await storeGoogleConnection(profileId, tokenResponse.tokens)

  return Response.redirect(`${appUrl()}/setup?profile_id=${profileId}&calendar=connected`, 303)
}
