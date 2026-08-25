import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import {
  assertMatchingDashboardProfile,
  getAuthenticatedDashboardProfileForRoute,
} from '@/src/lib/dashboardAuth'
import { disconnectCalendarAccount, type CalendarProvider } from '@/src/lib/calendar/google'

function isProvider(value: string): value is CalendarProvider {
  return value === 'google' || value === 'outlook' || value === 'apple'
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const profileId = String(formData.get('profile_id') || '').trim()
    const accountId = String(formData.get('account_id') || '').trim()
    const provider = String(formData.get('provider') || '').trim()
    const profile = await getAuthenticatedDashboardProfileForRoute()

    if (!profile) {
      return Response.redirect(`${appUrl()}/login`, 303)
    }

    if (!accountId || !isProvider(provider)) {
      return Response.redirect(
        `${appUrl()}/dashboard?calendar=error&calendar_error=disconnect_failed`,
        303,
      )
    }

    if (!assertMatchingDashboardProfile(profileId, profile)) {
      return Response.redirect(
        `${appUrl()}/dashboard?calendar=error&calendar_error=disconnect_failed`,
        303,
      )
    }

    await disconnectCalendarAccount({
      profileId: profile.id,
      provider,
      accountId,
    })

    return Response.redirect(`${appUrl()}/dashboard?calendar=disconnected`, 303)
  } catch (error) {
    console.error('Calendar disconnect failed', error)
    return Response.redirect(
      `${appUrl()}/dashboard?calendar=error&calendar_error=disconnect_failed`,
      303,
    )
  }
}
