import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

function requiredPublicEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

type CookieSetPayload = {
  name: string
  value: string
  options?: Parameters<(typeof cookies extends never ? never : Awaited<ReturnType<typeof cookies>>)['set']>[2]
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    requiredPublicEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredPublicEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Server Components can read cookies even when they cannot write them.
          }
        },
      },
    },
  )
}

export async function createSupabaseRouteHandlerClient(
  onSetCookies?: (cookiesToSet: CookieSetPayload[]) => void,
) {
  const cookieStore = await cookies()

  return createServerClient(
    requiredPublicEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredPublicEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Route handlers still need the cookies passed back on the response object.
          }

          onSetCookies?.(cookiesToSet)
        },
      },
    },
  )
}
