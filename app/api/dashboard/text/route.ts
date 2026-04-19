import { NextRequest, NextResponse } from 'next/server'
import { getDashboardProfileByEmail } from '@/src/lib/profiles'
import { handleIncomingSms } from '@/src/lib/sms/agent'
import { listSmsThreadEntries, toSmsThreadMessages } from '@/src/lib/sms/thread'
import { createSupabaseRouteHandlerClient } from '@/src/lib/supabase/server'

export const runtime = 'nodejs'

function friendlyDashboardTextError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message || 'Something went wrong sending that text.')
        : 'Something went wrong sending that text.'

  if (/people_contacts|schema cache/i.test(message)) {
    return 'Contact memory is not set up in Supabase yet. Run the people_contacts SQL migration, then try again.'
  }

  if (/pending_actions_kind_check|violates check constraint/i.test(message)) {
    return 'The calendar action worked, but Supabase needs the newest pending-actions migration so Manoa can remember the follow-up.'
  }

  if (/apple calendar request failed:\s*403\b/i.test(message)) {
    return 'One of your Apple calendars is blocking access right now. I skipped the broken Apple calendar path for future reads, but if this keeps happening, reconnect Apple or remove the problem calendar from Manoa.'
  }

  if (/apple calendar request failed:\s*401\b/i.test(message)) {
    return 'Apple did not accept that iCloud connection anymore. Reconnect Apple Calendar with a fresh app-specific password.'
  }

  if (/apple calendar (?:request|delete|update|create) failed:\s*400\b/i.test(message)) {
    return 'Apple rejected that calendar change. Try sending the cancel or schedule request again; if it keeps happening, reconnect Apple Calendar with a fresh app-specific password.'
  }

  return message
}

export async function POST(request: NextRequest) {
  const cookiesToSet: Array<{
    name: string
    value: string
    options?: Parameters<NextResponse['cookies']['set']>[2]
  }> = []

  const supabase = await createSupabaseRouteHandlerClient((nextCookies) => {
    cookiesToSet.push(...nextCookies)
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    return NextResponse.json({ error: 'Sign in again and try once more.' }, { status: 401 })
  }

  const payload = (await request.json().catch(() => null)) as { body?: unknown } | null
  const body = typeof payload?.body === 'string' ? payload.body.trim() : ''

  if (!body) {
    return NextResponse.json({ error: 'Write a text first.' }, { status: 400 })
  }

  const profile = await getDashboardProfileByEmail(user.email)
  if (!profile) {
    return NextResponse.json(
      { error: 'We could not find your Manoa account right now.' },
      { status: 404 },
    )
  }

  try {
    await handleIncomingSms({
      from: profile.phone_e164,
      body,
    })

    const thread = toSmsThreadMessages(await listSmsThreadEntries(profile.id))
    const response = NextResponse.json({ messages: thread })

    cookiesToSet.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options)
    })

    return response
  } catch (error) {
    return NextResponse.json({ error: friendlyDashboardTextError(error) }, { status: 500 })
  }
}
