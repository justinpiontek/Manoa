import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import { supabaseAdmin } from '@/src/lib/supabaseAdmin'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const profileId = String(formData.get('profile_id') || '').trim()
  const smsConsent = String(formData.get('sms_consent') || '').trim().toLowerCase()

  if (!profileId) {
    return Response.redirect(`${appUrl()}/dashboard?settings=sms_consent_missing`, 303)
  }

  if (smsConsent !== 'yes') {
    return Response.redirect(
      `${appUrl()}/dashboard?profile_id=${profileId}&settings=sms_consent_missing`,
      303,
    )
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      sms_opted_out_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profileId)

  if (error) {
    return Response.redirect(
      `${appUrl()}/dashboard?profile_id=${profileId}&settings=sms_consent_error`,
      303,
    )
  }

  return Response.redirect(
    `${appUrl()}/dashboard?profile_id=${profileId}&settings=sms_consent_enabled`,
    303,
  )
}
