import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import { googleOAuthClient, storeGoogleConnection } from '@/src/lib/calendar/google'

function calendarErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : ''

  if (message.includes('supports up to 2 google accounts')) return 'account_limit'
  if (message.includes('did not return any calendars')) return 'no_calendars'
  if (message.includes('insufficient authentication scopes')) return 'insufficient_scopes'
  if (message.includes('duplicate key')) return 'duplicate'
  if (message.includes('there is no unique or exclusion constraint')) return 'db_constraint'
  if (message.includes('does not exist')) return 'migration_missing'
  return 'unknown'
}

function calendarErrorDetail(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown calendar callback error.'

  return message.replace(/\s+/g, ' ').trim().slice(0, 180)
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const rawState = request.nextUrl.searchParams.get('state')
  const state = new URLSearchParams(rawState || '')
  const profileId = state.get('profile_id') || rawState
  const reconnectAccountId = state.get('account_id')

  if (!code || !profileId) {
    return new Response('Missing Google OAuth code or state.', { status: 400 })
  }

  try {
    const client = googleOAuthClient()
    const tokenResponse = await client.getToken(code)
    await storeGoogleConnection(profileId, tokenResponse.tokens, {
      reconnectAccountId,
    })

    return Response.redirect(`${appUrl()}/dashboard?profile_id=${profileId}&calendar=connected`, 303)
  } catch (error) {
    console.error('Google calendar callback failed', error)
    const code = calendarErrorCode(error)
    const detail = calendarErrorDetail(error)
    return Response.redirect(
      `${appUrl()}/dashboard?profile_id=${profileId}&calendar=error&calendar_error=${encodeURIComponent(code)}&calendar_error_detail=${encodeURIComponent(detail)}`,
      303,
    )
  }
}
