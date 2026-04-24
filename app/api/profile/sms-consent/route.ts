import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import { normalizePhone } from '@/src/lib/phone'
import { supabaseAdmin } from '@/src/lib/supabaseAdmin'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const profileId = String(formData.get('profile_id') || '').trim()
  const phone = String(formData.get('phone') || '').trim()
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

  const phoneE164 = phone ? normalizePhone(phone) : ''
  if (phone && phoneE164.length < 8) {
    return Response.redirect(
      `${appUrl()}/dashboard?profile_id=${profileId}&settings=sms_phone_invalid`,
      303,
    )
  }

  const { data: existingProfile } = await supabaseAdmin
    .from('profiles')
    .select('phone_e164')
    .eq('id', profileId)
    .maybeSingle<{ phone_e164: string | null }>()

  const effectivePhone = phoneE164 || existingProfile?.phone_e164 || ''
  if (effectivePhone.length < 8) {
    return Response.redirect(
      `${appUrl()}/dashboard?profile_id=${profileId}&settings=sms_phone_missing`,
      303,
    )
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      phone_e164: effectivePhone,
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
