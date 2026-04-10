import { defaultTimezone } from './env'
import { supabaseAdmin } from './supabaseAdmin'

export type Profile = {
  id: string
  email: string
  phone_e164: string
  timezone: string
}

export type DashboardProfile = Profile & {
  subscriptionStatus: string | null
  googleCalendarConnected: boolean
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

export async function findProfileForAccess({
  email,
  phoneE164,
}: {
  email: string
  phoneE164: string
}) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id,email,phone_e164,timezone')
    .eq('email', email)
    .eq('phone_e164', phoneE164)
    .maybeSingle<Profile>()

  if (error) throw error
  return data
}

export async function getDashboardProfile(profileId: string) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id,email,phone_e164,timezone')
    .eq('id', profileId)
    .maybeSingle<Profile>()

  if (error) throw error
  if (!profile) return null

  const { data: subscription, error: subscriptionError } = await supabaseAdmin
    .from('subscriptions')
    .select('status')
    .eq('profile_id', profileId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ status: string }>()

  if (subscriptionError) throw subscriptionError

  const { data: calendarConnection, error: calendarError } = await supabaseAdmin
    .from('calendar_connections')
    .select('id')
    .eq('profile_id', profileId)
    .eq('provider', 'google')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (calendarError) throw calendarError

  return {
    ...profile,
    subscriptionStatus: subscription?.status || null,
    googleCalendarConnected: Boolean(calendarConnection?.id),
  } satisfies DashboardProfile
}
