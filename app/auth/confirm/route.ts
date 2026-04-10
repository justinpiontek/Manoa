import { NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { appUrl } from '@/src/lib/env'
import { createSupabaseServerClient } from '@/src/lib/supabase/server'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const tokenHash = requestUrl.searchParams.get('token_hash')
  const type = requestUrl.searchParams.get('type') as EmailOtpType | null
  const code = requestUrl.searchParams.get('code')
  const next = requestUrl.searchParams.get('next') || '/dashboard'
  const redirectUrl = new URL(next, appUrl())
  const supabase = await createSupabaseServerClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return Response.redirect(redirectUrl.toString(), 303)
    }
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })

    if (!error) {
      return Response.redirect(redirectUrl.toString(), 303)
    }
  }

  return Response.redirect(`${appUrl()}/?login=error#access`, 303)
}
