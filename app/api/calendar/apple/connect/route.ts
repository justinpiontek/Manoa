import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import { getAuthenticatedDashboardProfileForRoute } from '@/src/lib/dashboardAuth'
import { storeAppleConnection } from '@/src/lib/calendar/google'

function classifyAppleError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  const lower = message.toLowerCase()

  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized')) {
    return {
      code: 'apple_auth',
      detail: 'Apple did not accept that iCloud email and app-specific password.',
    }
  }

  if (lower.includes('did not return any calendars')) {
    return {
      code: 'no_calendars',
      detail: 'Apple connected, but did not return any calendars for that account.',
    }
  }

  if (lower.includes('supports 1 apple account')) {
    return {
      code: 'account_limit',
      detail: 'Manoa supports 1 Apple account right now.',
    }
  }

  return {
    code: 'apple_connect',
    detail: message || 'Apple Calendar could not be connected yet.',
  }
}

export async function POST(request: NextRequest) {
  const profile = await getAuthenticatedDashboardProfileForRoute()
  if (!profile) {
    return Response.redirect(`${appUrl()}/login`, 303)
  }

  const formData = await request.formData()
  const accountId = String(formData.get('account_id') || '').trim() || null
  const email = String(formData.get('apple_email') || '').trim()
  const appSpecificPassword = String(formData.get('app_specific_password') || '').trim()

  if (!email || !appSpecificPassword) {
    return new Response('Missing Apple Calendar details.', { status: 400 })
  }

  try {
    await storeAppleConnection(
      profile.id,
      {
        email,
        appSpecificPassword,
      },
      { reconnectAccountId: accountId },
    )

    return Response.redirect(`${appUrl()}/dashboard?calendar=connected`, 303)
  } catch (error) {
    const classified = classifyAppleError(error)
    const redirect = new URL(`${appUrl()}/dashboard`)
    redirect.searchParams.set('calendar', 'error')
    redirect.searchParams.set('calendar_error', classified.code)
    redirect.searchParams.set('calendar_error_detail', classified.detail)
    return Response.redirect(redirect, 303)
  }
}
