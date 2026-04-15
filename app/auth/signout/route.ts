import { appUrl } from '@/src/lib/env'
import { NextResponse } from 'next/server'
import { createSupabaseRouteHandlerClient } from '@/src/lib/supabase/server'

export async function GET() {
  const responseCookies: Array<{ name: string; value: string; options?: Parameters<NextResponse['cookies']['set']>[2] }> = []
  const supabase = await createSupabaseRouteHandlerClient((cookiesToSet) => {
    responseCookies.push(...cookiesToSet)
  })
  await supabase.auth.signOut()

  const response = NextResponse.redirect(`${appUrl()}/?login=signed_out#access`, 303)

  responseCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options)
  })

  return response
}
