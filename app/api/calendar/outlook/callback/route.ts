import { NextRequest, NextResponse } from 'next/server'
import { appUrl } from '@/src/lib/env'
import { getAuthenticatedDashboardProfileForRoute } from '@/src/lib/dashboardAuth'
import { storeOutlookConnection } from '@/src/lib/calendar/google'
import { clearCalendarOAuthCookie, readCalendarOAuthState } from '@/src/lib/calendar/oauthState'

function calendarErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : ''

  if (message.includes('supports up to 2 outlook accounts')) return 'account_limit'
  if (message.includes('did not return any calendars')) return 'no_calendars'
  if (message.includes('mailbox') && message.includes('not')) return 'mailbox_missing'
  if (message.includes('insufficient privileges') || message.includes('consent')) return 'permissions'
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
        : 'Unknown Outlook calendar callback error.'

  return message.replace(/\s+/g, ' ').trim().slice(0, 180)
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const rawState = request.nextUrl.searchParams.get('state')
  const authedProfile = await getAuthenticatedDashboardProfileForRoute()
  const cookieState = readCalendarOAuthState(
    'outlook',
    request.cookies.get('manoa_outlook_oauth')?.value,
    rawState,
  )

  const legacyState = new URLSearchParams(rawState || '')
  const legacyProfileId = legacyState.get('profile_id') || rawState
  const legacyReconnectAccountId = legacyState.get('account_id')

  const profileId =
    cookieState?.profileId ||
    (authedProfile && legacyProfileId && authedProfile.id === legacyProfileId ? legacyProfileId : '')
  const reconnectAccountId = cookieState?.accountId || legacyReconnectAccountId
  const clearCookie = clearCalendarOAuthCookie('outlook')

  if (!code || !profileId) {
    const response = NextResponse.redirect(`${appUrl()}/login?login=error`, 303)
    response.cookies.set(clearCookie.name, clearCookie.value, clearCookie.options)
    return response
  }

  try {
    await storeOutlookConnection(profileId, code, {
      reconnectAccountId,
    })

    const response = NextResponse.redirect(`${appUrl()}/dashboard?calendar=connected`, 303)
    response.cookies.set(clearCookie.name, clearCookie.value, clearCookie.options)
    return response
  } catch (error) {
    console.error('Outlook calendar callback failed', error)
    const code = calendarErrorCode(error)
    const detail = calendarErrorDetail(error)
    const response = NextResponse.redirect(
      `${appUrl()}/dashboard?calendar=error&calendar_error=${encodeURIComponent(code)}&calendar_error_detail=${encodeURIComponent(detail)}`,
      303,
    )
    response.cookies.set(clearCookie.name, clearCookie.value, clearCookie.options)
    return response
  }
}
