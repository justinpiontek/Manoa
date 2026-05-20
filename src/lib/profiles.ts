import { defaultTimezone } from './env'
import { supabaseAdmin } from './supabaseAdmin'
import { syncStripeSubscriptionForProfile } from './subscriptions'

export type Profile = {
  id: string
  email: string
  phone_e164: string | null
  timezone: string
  default_event_duration_minutes: number
  morning_agenda_enabled: boolean
  reminder_texts_enabled: boolean
  reminder_lead_minutes: number
}

type ProfileRow = {
  id: string
  email: string
  phone_e164: string | null
  timezone: string
  default_event_duration_minutes?: number | null
  morning_agenda_enabled?: boolean | null
  reminder_texts_enabled?: boolean | null
  reminder_lead_minutes?: number | null
}

export type DashboardProfile = Profile & {
  subscriptionStatus: string | null
  calendarConnected: boolean
  googleCalendarConnected: boolean
}

const profileSelectColumns =
  'id,email,phone_e164,timezone,default_event_duration_minutes,morning_agenda_enabled,reminder_texts_enabled,reminder_lead_minutes'
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

export function isMissingNotificationSettingsColumnError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : ''

  const lower = message.toLowerCase()
  return (
    lower.includes('does not exist') &&
    ['morning_agenda_enabled', 'reminder_texts_enabled', 'reminder_lead_minutes'].some((column) =>
      lower.includes(column),
    )
  )
}

function isMissingProfilePreferenceColumnError(error: unknown) {
  return (
    isMissingDefaultDurationColumnError(error) || isMissingNotificationSettingsColumnError(error)
  )
}

function normalizeProfileRow(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email,
    phone_e164: row.phone_e164,
    timezone: row.timezone,
    default_event_duration_minutes: row.default_event_duration_minutes ?? 30,
    morning_agenda_enabled: row.morning_agenda_enabled ?? true,
    reminder_texts_enabled: row.reminder_texts_enabled ?? true,
    reminder_lead_minutes: row.reminder_lead_minutes ?? 15,
  }
}

async function selectProfileMaybeSingle(
  build: (columns: string) => PromiseLike<{ data: ProfileRow | null; error: unknown }>,
) {
  const result = await build(profileSelectColumns)
  if (result.error && isMissingProfilePreferenceColumnError(result.error)) {
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
  if (result.error && isMissingProfilePreferenceColumnError(result.error)) {
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

async function resolveDashboardCalendarFlags(profileId: string) {
  const { data: calendarConnections, error: calendarError } = await supabaseAdmin
    .from('calendar_connections')
    .select('provider')
    .eq('profile_id', profileId)
    .eq('status', 'active')
    .returns<Array<{ provider: string }>>()

  if (calendarError) throw calendarError

  const connections = calendarConnections || []
  return {
    calendarConnected: connections.length > 0,
    googleCalendarConnected: connections.some((connection) => connection.provider === 'google'),
  }
}

function duplicateAuthUserError(message: string) {
  const lower = message.toLowerCase()
  return (
    lower.includes('already been registered') ||
    lower.includes('already registered') ||
    lower.includes('already exists') ||
    lower.includes('duplicate key') ||
    lower.includes('has already been taken')
  )
}

export class PhoneOwnershipConflictError extends Error {
  constructor() {
    super('That phone number is already connected to another Manoa account.')
    this.name = 'PhoneOwnershipConflictError'
  }
}

export function isPhoneOwnershipConflictError(error: unknown) {
  return error instanceof PhoneOwnershipConflictError
}

export async function ensureAuthUserForEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return

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
  smsConsentGranted = false,
  ensureAuthUser = true,
}: {
  email: string
  phoneE164?: string | null
  smsConsentGranted?: boolean
  ensureAuthUser?: boolean
}) {
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedPhone = phoneE164?.trim() || null
  const consentUpdate = smsConsentGranted
    ? { sms_opted_out_at: null, updated_at: new Date().toISOString() }
    : { updated_at: new Date().toISOString() }

  const byEmail = await selectProfileMaybeSingle((columns) =>
    supabaseAdmin.from('profiles').select(columns).eq('email', normalizedEmail).maybeSingle<ProfileRow>(),
  )

  const byPhone = normalizedPhone
    ? await selectProfileMaybeSingle((columns) =>
        supabaseAdmin
          .from('profiles')
          .select(columns)
          .eq('phone_e164', normalizedPhone)
          .maybeSingle<ProfileRow>(),
      )
    : null

  if (byEmail) {
    if (byPhone && byPhone.id !== byEmail.id) {
      throw new PhoneOwnershipConflictError()
    }

    const update = normalizedPhone
      ? { phone_e164: normalizedPhone, ...consentUpdate }
      : consentUpdate
    const updated = await selectProfileSingle((columns) =>
      supabaseAdmin
        .from('profiles')
        .update(update)
        .eq('id', byEmail.id)
        .select(columns)
        .single<ProfileRow>(),
    )

    if (ensureAuthUser) {
      await ensureAuthUserForEmail(normalizedEmail)
    }
    return updated
  }

  if (byPhone) {
    if (byPhone.email.trim().toLowerCase() !== normalizedEmail) {
      throw new PhoneOwnershipConflictError()
    }

    const updated = await selectProfileSingle((columns) =>
      supabaseAdmin
        .from('profiles')
        .update({ ...consentUpdate })
        .eq('id', byPhone.id)
        .select(columns)
        .single<ProfileRow>(),
    )

    if (ensureAuthUser) {
      await ensureAuthUserForEmail(normalizedEmail)
    }
    return updated
  }

  const created = await supabaseAdmin
    .from('profiles')
      .insert({
        email: normalizedEmail,
        phone_e164: normalizedPhone,
        timezone: defaultTimezone(),
        default_event_duration_minutes: 30,
        morning_agenda_enabled: true,
        reminder_texts_enabled: true,
        reminder_lead_minutes: 15,
        sms_opted_out_at: smsConsentGranted ? null : new Date().toISOString(),
      })
      .select(profileSelectColumns)
      .single<ProfileRow>()

  let createdProfile: Profile
  if (created.error && isMissingProfilePreferenceColumnError(created.error)) {
    const legacyCreated = await supabaseAdmin
      .from('profiles')
      .insert({
        email: normalizedEmail,
        phone_e164: normalizedPhone,
        timezone: defaultTimezone(),
        sms_opted_out_at: smsConsentGranted ? null : new Date().toISOString(),
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

  if (ensureAuthUser) {
    await ensureAuthUserForEmail(normalizedEmail)
  }
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

export async function findProfileByPhone(phoneE164: string) {
  return selectProfileMaybeSingle((columns) =>
    supabaseAdmin.from('profiles').select(columns).eq('phone_e164', phoneE164).maybeSingle<ProfileRow>(),
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
  const calendarFlags = await resolveDashboardCalendarFlags(profile.id)

  return {
    ...profile,
    subscriptionStatus,
    ...calendarFlags,
  } satisfies DashboardProfile
}

export async function getDashboardProfile(profileId: string) {
  const profile = await selectProfileMaybeSingle((columns) =>
    supabaseAdmin.from('profiles').select(columns).eq('id', profileId).maybeSingle<ProfileRow>(),
  )

  if (!profile) return null

  const subscriptionStatus = await resolveDashboardSubscriptionStatus(profile)
  const calendarFlags = await resolveDashboardCalendarFlags(profileId)

  return {
    ...profile,
    subscriptionStatus,
    ...calendarFlags,
  } satisfies DashboardProfile
}
