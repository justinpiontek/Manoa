import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdminEmail } from '@/src/lib/admin'
import { appUrl, requiredEnv } from '@/src/lib/env'
import { ensureAuthUserForEmail, getDashboardProfileByEmail } from '@/src/lib/profiles'
import { checkRateLimit, clientIp } from '@/src/lib/rateLimit'

function friendlyAuthSendError(message: string) {
  const lower = message.toLowerCase()

  if (lower.includes('email rate limit exceeded') || lower.includes('rate limit')) {
    return 'Too many login emails were sent in a short stretch. Wait a minute, then try again. If you already got one, use the newest email in your inbox.'
  }

  return 'We could not send your login link yet. Try again in a minute.'
}

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

    const profile = await getDashboardProfileByEmail(email)
    const adminLogin = isAdminEmail(email)

    if (profile || adminLogin) {
      await ensureAuthUserForEmail(email)

      const supabase = createClient(
        requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
        requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        },
      )

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${appUrl()}/auth/callback?next=${encodeURIComponent(
            adminLogin ? '/dashboard/support' : '/dashboard',
          )}`,
        },
      })

      if (error) {
        console.error('Magic link send failed.', {
          email,
          error: error.message,
        })
        return NextResponse.json(
          { error: friendlyAuthSendError(error.message || '') },
          { status: lowerRateLimitStatus(error.message || '') },
        )
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'We could not get your Manoa login ready yet. Try again in a minute.'

    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function lowerRateLimitStatus(message: string) {
  return message.toLowerCase().includes('rate limit') ? 429 : 500
}
