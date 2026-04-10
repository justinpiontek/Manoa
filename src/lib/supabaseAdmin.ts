import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requiredEnv } from './env'

let client: SupabaseClient | null = null

export function getSupabaseAdmin() {
  client ??= createClient(
    requiredEnv('SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )

  return client
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const value = Reflect.get(getSupabaseAdmin(), property)
    return typeof value === 'function' ? value.bind(getSupabaseAdmin()) : value
  },
})
