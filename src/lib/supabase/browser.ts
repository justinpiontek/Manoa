import { createBrowserClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

function publicBrowserEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!url) {
    throw new Error('Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL')
  }

  if (!publishableKey) {
    throw new Error('Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  }

  return { url, publishableKey }
}

export function getSupabaseBrowser() {
  const { url, publishableKey } = publicBrowserEnv()

  client ??= createBrowserClient(
    url,
    publishableKey,
  )

  return client
}

export function createSupabaseMagicLinkBrowser() {
  const { url, publishableKey } = publicBrowserEnv()

  return createClient(url, publishableKey, {
    auth: {
      flowType: 'implicit',
      detectSessionInUrl: false,
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
