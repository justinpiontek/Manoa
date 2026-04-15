import { NextRequest, NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createSupabaseRouteHandlerClient } from '@/src/lib/supabase/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const tokenHash = requestUrl.searchParams.get('token_hash')
  const type = requestUrl.searchParams.get('type') as EmailOtpType | null
  const code = requestUrl.searchParams.get('code')
  const next = requestUrl.searchParams.get('next') || '/dashboard'
  const safeNext = next.startsWith('/') ? next : '/dashboard'
  const redirectUrl = new URL(safeNext, requestUrl.origin)
  const responseCookies: Array<{ name: string; value: string; options?: Parameters<NextResponse['cookies']['set']>[2] }> = []
  const supabase = await createSupabaseRouteHandlerClient((cookiesToSet) => {
    responseCookies.push(...cookiesToSet)
  })

  function redirectWithCookies(url: URL | string) {
    const response = NextResponse.redirect(url, 303)

    responseCookies.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options)
    })

    return response
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return redirectWithCookies(redirectUrl.toString())
    }
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })

    if (!error) {
      return redirectWithCookies(redirectUrl.toString())
    }
  }

  return redirectWithCookies(new URL('/login?login=error', requestUrl.origin).toString())
}
