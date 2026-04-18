import { NextRequest, NextResponse } from 'next/server'
import { getDashboardProfileByEmail } from '@/src/lib/profiles'
import { handleIncomingSms } from '@/src/lib/sms/agent'
import { listSmsThreadEntries, toSmsThreadMessages } from '@/src/lib/sms/thread'
import { createSupabaseRouteHandlerClient } from '@/src/lib/supabase/server'

export const runtime = 'nodejs'

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
    const message = error instanceof Error ? error.message : 'Something went wrong sending that text.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
