import { defaultTimezone } from './env'
import { supabaseAdmin } from './supabaseAdmin'
import { syncStripeSubscriptionForProfile } from './subscriptions'

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

async function resolveDashboardSubscriptionStatus(profile: Profile) {
  const { data: subscription, error: subscriptionError } = await supabaseAdmin
    .from('subscriptions')
    .select('status')
    .eq('profile_id', profile.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ status: string }>()

  if (subscriptionError) throw subscriptionError

  if (subscription?.status) {
    return subscription.status
  }

  try {
    return await syncStripeSubscriptionForProfile({
      profileId: profile.id,
      email: profile.email,
    })
  } catch {
    return null
  }
}

function duplicateAuthUserError(message: string) {
  const lower = message.toLowerCase()
  return (
    lower.includes('already registered') ||
    lower.includes('already exists') ||
    lower.includes('duplicate key') ||
    lower.includes('has already been taken')
  )
}

export async function ensureAuthUserForEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return

  const { data: listedUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })

  if (listError) {
    throw listError
  }

  const existingUser = listedUsers.users.find((user) => user.email?.toLowerCase() === normalizedEmail)
  if (existingUser) {
    return
  }

  const { error } = await supabaseAdmin.auth.admin.createUser({
    email: normalizedEmail,
    email_confirm: true,
    password: `Manoa-${crypto.randomUUID()}-login`,
  })

  if (error && !duplicateAuthUserError(error.message || '')) {
    throw error
  }
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
    await ensureAuthUserForEmail(email)
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
    await ensureAuthUserForEmail(email)
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
  await ensureAuthUserForEmail(email)
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

export async function getDashboardProfileByEmail(email: string) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id,email,phone_e164,timezone')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle<Profile>()

  if (error) throw error
  if (!profile) return null

  const subscriptionStatus = await resolveDashboardSubscriptionStatus(profile)

  const { data: calendarConnection, error: calendarError } = await supabaseAdmin
    .from('calendar_connections')
    .select('id')
    .eq('profile_id', profile.id)
    .eq('provider', 'google')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (calendarError) throw calendarError

  return {
    ...profile,
    subscriptionStatus,
    googleCalendarConnected: Boolean(calendarConnection?.id),
  } satisfies DashboardProfile
}

export async function getDashboardProfile(profileId: string) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id,email,phone_e164,timezone')
    .eq('id', profileId)
    .maybeSingle<Profile>()

  if (error) throw error
  if (!profile) return null

  const subscriptionStatus = await resolveDashboardSubscriptionStatus(profile)

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
    subscriptionStatus,
    googleCalendarConnected: Boolean(calendarConnection?.id),
  } satisfies DashboardProfile
}
