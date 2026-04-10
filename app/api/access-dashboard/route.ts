import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import { normalizePhone } from '@/src/lib/phone'
import { findProfileForAccess } from '@/src/lib/profiles'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const phone = String(formData.get('phone') || '').trim()

  if (!email.includes('@') || !phone) {
    return Response.redirect(`${appUrl()}/?access=invalid#access`, 303)
  }

  const phoneE164 = normalizePhone(phone)
  const profile = await findProfileForAccess({
    email,
    phoneE164,
  })

  if (!profile) {
    return Response.redirect(`${appUrl()}/?access=not_found#access`, 303)
  }

  return Response.redirect(`${appUrl()}/dashboard?profile_id=${profile.id}&login=success`, 303)
}
