import { defaultTimezone } from './env'
import { supabaseAdmin } from './supabaseAdmin'

export type Profile = {
  id: string
  email: string
  phone_e164: string
  timezone: string
}

export async function findOrCreateProfile({
  email,
  phoneE164,
}: {
  email: string
  phoneE164: string
}) {
  const byPhone = await supabaseAdmin
    .from('profiles')
    .select('id,email,phone_e164,timezone')
    .eq('phone_e164', phoneE164)
    .maybeSingle<Profile>()

  if (byPhone.error) throw byPhone.error

  if (byPhone.data) {
    const updated = await supabaseAdmin
      .from('profiles')
      .update({ email, updated_at: new Date().toISOString() })
      .eq('id', byPhone.data.id)
      .select('id,email,phone_e164,timezone')
      .single<Profile>()

    if (updated.error) throw updated.error
    return updated.data
  }

  const byEmail = await supabaseAdmin
    .from('profiles')
    .select('id,email,phone_e164,timezone')
    .eq('email', email)
    .maybeSingle<Profile>()

  if (byEmail.error) throw byEmail.error

  if (byEmail.data) {
    const updated = await supabaseAdmin
      .from('profiles')
      .update({ phone_e164: phoneE164, updated_at: new Date().toISOString() })
      .eq('id', byEmail.data.id)
      .select('id,email,phone_e164,timezone')
      .single<Profile>()

    if (updated.error) throw updated.error
    return updated.data
  }

  const created = await supabaseAdmin
    .from('profiles')
    .insert({
      email,
      phone_e164: phoneE164,
      timezone: defaultTimezone(),
    })
    .select('id,email,phone_e164,timezone')
    .single<Profile>()

  if (created.error) throw created.error
  return created.data
}
