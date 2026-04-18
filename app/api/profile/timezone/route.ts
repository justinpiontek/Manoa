import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import { supabaseAdmin } from '@/src/lib/supabaseAdmin'

function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
    return true
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const profileId = String(formData.get('profile_id') || '').trim()
  const timezone = String(formData.get('timezone') || '').trim()

  if (!profileId) {
    return new Response('Missing profile.', { status: 400 })
  }

  if (!timezone || !isValidTimezone(timezone)) {
    return Response.redirect(`${appUrl()}/dashboard?profile_id=${profileId}&settings=timezone_invalid`, 303)
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      timezone,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profileId)

  if (error) throw error

  return Response.redirect(`${appUrl()}/dashboard?profile_id=${profileId}&settings=timezone_saved`, 303)
}
