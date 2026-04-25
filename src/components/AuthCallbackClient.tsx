'use client'

import type { EmailOtpType } from '@supabase/supabase-js'
import ManoaWordmark from '@/src/components/ManoaWordmark'
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

        const finalizeResponse = await fetch('/api/auth/finalize-login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            next,
            code,
            tokenHash,
            type,
            accessToken,
            refreshToken,
          }),
        })

        if (cancelled) return

        if (!finalizeResponse.ok) {
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
