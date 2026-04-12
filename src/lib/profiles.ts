import { defaultTimezone } from './env'
import { supabaseAdmin } from './supabaseAdmin'
import { syncStripeSubscriptionForProfile } from './subscriptions'

export type Profile = {
  id: string
  email: string
  phone_e164: string
  timezone: string
  default_event_duration_minutes: number
}

type ProfileRow = {
  id: string
  email: string
  phone_e164: string
  timezone: string
  default_event_duration_minutes?: number | null
}

export type DashboardProfile = Profile & {
  subscriptionStatus: string | null
  calendarConnected: boolean
  googleCalendarConnected: boolean
}

const profileSelectColumns = 'id,email,phone_e164,timezone,default_event_duration_minutes'
const legacyProfileSelectColumns = 'id,email,phone_e164,timezone'

export function isMissingDefaultDurationColumnError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : ''

  const lower = message.toLowerCase()
  return lower.includes('default_event_duration_minutes') && lower.includes('does not exist')
}

function normalizeProfileRow(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email,
    phone_e164: row.phone_e164,
    timezone: row.timezone,
    default_event_duration_minutes: row.default_event_duration_minutes ?? 30,
  }
}

async function selectProfileMaybeSingle(
  build: (columns: string) => PromiseLike<{ data: ProfileRow | null; error: unknown }>,
) {
  const result = await build(profileSelectColumns)
  if (result.error && isMissingDefaultDurationColumnError(result.error)) {
    const fallback = await build(legacyProfileSelectColumns)
    if (fallback.error) throw fallback.error
    return fallback.data ? normalizeProfileRow(fallback.data) : null
  }

  if (result.error) throw result.error
  return result.data ? normalizeProfileRow(result.data) : null
}

async function selectProfileSingle(
  build: (columns: string) => PromiseLike<{ data: ProfileRow | null; error: unknown }>,
) {
  const result = await build(profileSelectColumns)
  if (result.error && isMissingDefaultDurationColumnError(result.error)) {
    const fallback = await build(legacyProfileSelectColumns)
    if (fallback.error) throw fallback.error
    if (!fallback.data) throw new Error('Profile could not be loaded after saving.')
    return normalizeProfileRow(fallback.data)
  }

  if (result.error) throw result.error
  if (!result.data) throw new Error('Profile could not be loaded after saving.')
  return normalizeProfileRow(result.data)
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
  const byPhone = await selectProfileMaybeSingle((columns) =>
    supabaseAdmin.from('profiles').select(columns).eq('phone_e164', phoneE164).maybeSingle<ProfileRow>(),
  )

  if (byPhone) {
    const updated = await selectProfileSingle((columns) =>
      supabaseAdmin
        .from('profiles')
        .update({ email, updated_at: new Date().toISOString() })
        .eq('id', byPhone.id)
        .select(columns)
        .single<ProfileRow>(),
    )

    await ensureAuthUserForEmail(email)
    return updated
  }

  const byEmail = await selectProfileMaybeSingle((columns) =>
    supabaseAdmin.from('profiles').select(columns).eq('email', email).maybeSingle<ProfileRow>(),
  )

  if (byEmail) {
    const updated = await selectProfileSingle((columns) =>
      supabaseAdmin
        .from('profiles')
        .update({ phone_e164: phoneE164, updated_at: new Date().toISOString() })
        .eq('id', byEmail.id)
        .select(columns)
        .single<ProfileRow>(),
    )

    await ensureAuthUserForEmail(email)
    return updated
  }

  const created = await supabaseAdmin
    .from('profiles')
    .insert({
      email,
      phone_e164: phoneE164,
      timezone: defaultTimezone(),
      default_event_duration_minutes: 30,
    })
    .select(profileSelectColumns)
    .single<ProfileRow>()

  let createdProfile: Profile
  if (created.error && isMissingDefaultDurationColumnError(created.error)) {
    const legacyCreated = await supabaseAdmin
      .from('profiles')
      .insert({
        email,
        phone_e164: phoneE164,
        timezone: defaultTimezone(),
      })
      .select(legacyProfileSelectColumns)
      .single<ProfileRow>()

    if (legacyCreated.error) throw legacyCreated.error
    if (!legacyCreated.data) throw new Error('Profile could not be created.')
    createdProfile = normalizeProfileRow(legacyCreated.data)
  } else {
    if (created.error) throw created.error
    if (!created.data) throw new Error('Profile could not be created.')
    createdProfile = normalizeProfileRow(created.data)
  }

  await ensureAuthUserForEmail(email)
  return createdProfile
}

export async function findProfileForAccess({
  email,
  phoneE164,
}: {
  email: string
  phoneE164: string
}) {
  return selectProfileMaybeSingle((columns) =>
    supabaseAdmin
      .from('profiles')
      .select(columns)
      .eq('email', email)
      .eq('phone_e164', phoneE164)
      .maybeSingle<ProfileRow>(),
  )
}

export async function getDashboardProfileByEmail(email: string) {
  const profile = await selectProfileMaybeSingle((columns) =>
    supabaseAdmin
      .from('profiles')
      .select(columns)
      .eq('email', email.trim().toLowerCase())
      .maybeSingle<ProfileRow>(),
  )

  if (!profile) return null

  const subscriptionStatus = await resolveDashboardSubscriptionStatus(profile)

  const { data: calendarConnection, error: calendarError } = await supabaseAdmin
    .from('calendar_connections')
    .select('id')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (calendarError) throw calendarError

  return {
    ...profile,
    subscriptionStatus,
    calendarConnected: Boolean(calendarConnection?.id),
    googleCalendarConnected: Boolean(calendarConnection?.id),
  } satisfies DashboardProfile
}

export async function getDashboardProfile(profileId: string) {
  const profile = await selectProfileMaybeSingle((columns) =>
    supabaseAdmin.from('profiles').select(columns).eq('id', profileId).maybeSingle<ProfileRow>(),
  )

  if (!profile) return null

  const subscriptionStatus = await resolveDashboardSubscriptionStatus(profile)

  const { data: calendarConnection, error: calendarError } = await supabaseAdmin
    .from('calendar_connections')
    .select('id')
    .eq('profile_id', profileId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (calendarError) throw calendarError

  return {
    ...profile,
    subscriptionStatus,
    calendarConnected: Boolean(calendarConnection?.id),
    googleCalendarConnected: Boolean(calendarConnection?.id),
  } satisfies DashboardProfile
}
