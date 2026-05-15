import { NextRequest, NextResponse } from 'next/server'
import { getDashboardProfileByEmail } from '@/src/lib/profiles'
import { checkRateLimit, clientIp } from '@/src/lib/rateLimit'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const email = String(body?.email || '')
      .trim()
      .toLowerCase()

    if (!email.includes('@')) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
    }

    const ipLimit = checkRateLimit({
      scope: 'auth-prepare-login-ip',
      identity: clientIp(request),
      limit: 10,
      windowMs: 10 * 60_000,
    })
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: 'Please wait a minute, then try again.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(ipLimit.retryAfterSeconds),
          },
        },
      )
    }

    const emailLimit = checkRateLimit({
      scope: 'auth-prepare-login-email',
      identity: email,
      limit: 5,
      windowMs: 10 * 60_000,
    })
    if (!emailLimit.allowed) {
      return NextResponse.json(
        { error: 'Please wait a minute, then try again.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(emailLimit.retryAfterSeconds),
          },
        },
      )
    }

    await getDashboardProfileByEmail(email)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'We could not get your Manoa login ready yet. Try again in a minute.'

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
