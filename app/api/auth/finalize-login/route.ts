import { NextRequest, NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createSupabaseRouteHandlerClient } from '@/src/lib/supabase/server'

type FinalizeLoginBody = {
  next?: string
  code?: string | null
  tokenHash?: string | null
  type?: EmailOtpType | null
  accessToken?: string | null
  refreshToken?: string | null
}

function safeNextPath(next: string | null | undefined) {
  return next && next.startsWith('/') ? next : '/dashboard'
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as FinalizeLoginBody | null
  const safeNext = safeNextPath(body?.next)
  const responseCookies: Array<{
    name: string
    value: string
    options?: Parameters<NextResponse['cookies']['set']>[2]
  }> = []
  const supabase = await createSupabaseRouteHandlerClient((cookiesToSet) => {
    responseCookies.push(...cookiesToSet)
  })

  let error: { message?: string | null } | null = null

  if (body?.code) {
    const result = await supabase.auth.exchangeCodeForSession(body.code)
    error = result.error
  } else if (body?.tokenHash && body?.type) {
    const result = await supabase.auth.verifyOtp({
      type: body.type,
      token_hash: body.tokenHash,
    })
    error = result.error
  } else if (body?.accessToken && body?.refreshToken) {
    const result = await supabase.auth.setSession({
      access_token: body.accessToken,
      refresh_token: body.refreshToken,
    })
    error = result.error
  } else {
    return NextResponse.json({ error: 'Missing login data.' }, { status: 400 })
  }

  if (error) {
    return NextResponse.json(
      { error: error.message || 'That login link did not work.' },
      { status: 400 },
    )
  }

  const response = NextResponse.json(
    { ok: true, next: safeNext },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )

  responseCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options)
  })

  return response
}
