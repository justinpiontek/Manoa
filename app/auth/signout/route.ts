import { appUrl } from '@/src/lib/env'
import { createSupabaseServerClient } from '@/src/lib/supabase/server'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()

  return Response.redirect(`${appUrl()}/?login=signed_out#access`, 303)
}
