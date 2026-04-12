import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import { isMissingDefaultDurationColumnError } from '@/src/lib/profiles'
import { supabaseAdmin } from '@/src/lib/supabaseAdmin'

const allowedDurations = new Set([15, 30, 45, 60, 90])

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const profileId = String(formData.get('profile_id') || '').trim()
  const durationMinutes = Number(formData.get('default_event_duration_minutes') || '0')

  if (!profileId) {
    return new Response('Missing profile.', { status: 400 })
  }

  if (!allowedDurations.has(durationMinutes)) {
    return new Response('Choose a valid default duration.', { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      default_event_duration_minutes: durationMinutes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profileId)

  if (error) {
    if (isMissingDefaultDurationColumnError(error)) {
      return Response.redirect(
        `${appUrl()}/dashboard?profile_id=${profileId}&settings=duration_unavailable`,
        303,
      )
    }
    throw error
  }

  return Response.redirect(`${appUrl()}/dashboard?profile_id=${profileId}&settings=duration_saved`, 303)
}
