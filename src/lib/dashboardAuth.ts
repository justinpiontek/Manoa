import { createSupabaseRouteHandlerClient, createSupabaseServerClient } from '@/src/lib/supabase/server'
import { getDashboardProfileByEmail, type DashboardProfile } from '@/src/lib/profiles'

export async function getAuthenticatedDashboardProfile() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) return null
  return getDashboardProfileByEmail(user.email)
}

export async function getAuthenticatedDashboardProfileForRoute() {
  const supabase = await createSupabaseRouteHandlerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) return null
  return getDashboardProfileByEmail(user.email)
}

export function assertMatchingDashboardProfile(
  submittedProfileId: string,
  profile: DashboardProfile,
) {
  return !submittedProfileId || submittedProfileId === profile.id
}
