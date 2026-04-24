'use client'

import type { EmailOtpType } from '@supabase/supabase-js'
import ManoaWordmark from '@/src/components/ManoaWordmark'
import { getSupabaseBrowser } from '@/src/lib/supabase/browser'
import { useEffect, useState } from 'react'

type AuthCallbackClientProps = {
  nextPath: string
}

function safeNextPath(nextPath: string) {
  return nextPath.startsWith('/') ? nextPath : '/dashboard'
}

export default function AuthCallbackClient({ nextPath }: AuthCallbackClientProps) {
  const [message, setMessage] = useState('Checking your login link...')

  useEffect(() => {
    let cancelled = false

    async function finishLogin() {
      const next = safeNextPath(nextPath)

      try {
        const supabase = getSupabaseBrowser()
        const url = new URL(window.location.href)
        const query = url.searchParams
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
        const code = query.get('code')
        const tokenHash = query.get('token_hash')
        const type = query.get('type') as EmailOtpType | null
        const accessToken = hash.get('access_token')
        const refreshToken = hash.get('refresh_token')
        const urlError =
          query.get('error_description') ||
          query.get('error') ||
          hash.get('error_description') ||
          hash.get('error')

        if (urlError) {
          window.location.replace('/login?login=error')
          return
        }

        setMessage('Signing you in...')

        let error: Error | null = null

        if (code) {
          const result = await supabase.auth.exchangeCodeForSession(code)
          error = result.error
        } else if (tokenHash && type) {
          const result = await supabase.auth.verifyOtp({
            type,
            token_hash: tokenHash,
          })
          error = result.error
        } else if (accessToken && refreshToken) {
          const result = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          error = result.error
        } else {
          error = new Error('Missing login data.')
        }

        if (cancelled) return

        if (error) {
          window.location.replace('/login?login=error')
          return
        }

        setMessage('Opening your dashboard...')
        window.location.replace(next)
      } catch {
        if (cancelled) return
        window.location.replace('/login?login=error')
      }
    }

    void finishLogin()

    return () => {
      cancelled = true
    }
  }, [nextPath])

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <ManoaWordmark className="legal-back compact" href="/" />
        <p className="legal-eyebrow">Log in</p>
        <h1 className="auth-title">Finishing your login.</h1>
        <p className="auth-lede">
          {message}
        </p>
        <p className="auth-help">
          If nothing happens in a few seconds, head back to the login page and use the newest email
          link.
        </p>
      </div>
    </main>
  )
}
