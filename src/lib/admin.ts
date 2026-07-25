import { createSupabaseServerClient } from '@/src/lib/supabase/server'
import { siteSupportEmail } from '@/src/lib/siteMetadata'

const adminEmails = new Set([siteSupportEmail.trim().toLowerCase()])

export function isAdminEmail(email: string | null | undefined) {
  return Boolean(email && adminEmails.has(email.trim().toLowerCase()))
}

export async function getAuthenticatedUserEmail() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user?.email?.trim().toLowerCase() || null
}

export async function getAuthenticatedAdminEmail() {
  const email = await getAuthenticatedUserEmail()
  return isAdminEmail(email) ? email : null
}
