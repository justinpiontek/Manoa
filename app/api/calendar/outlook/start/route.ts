import { NextRequest, NextResponse } from 'next/server'
import { appUrl } from '@/src/lib/env'
import { getAuthenticatedDashboardProfileForRoute } from '@/src/lib/dashboardAuth'
import { microsoftAuthUrl } from '@/src/lib/calendar/google'
import { createCalendarOAuthState } from '@/src/lib/calendar/oauthState'

export async function GET(request: NextRequest) {
  const profile = await getAuthenticatedDashboardProfileForRoute()
  if (!profile) {
    return Response.redirect(`${appUrl()}/login`, 303)
  }

  const accountId = request.nextUrl.searchParams.get('account_id')
  const oauthState = createCalendarOAuthState('outlook', {
    profileId: profile.id,
    accountId,
  })

  const response = NextResponse.redirect(microsoftAuthUrl(oauthState.state), 303)
  response.cookies.set(oauthState.cookie.name, oauthState.cookie.value, oauthState.cookie.options)
  return response
}
