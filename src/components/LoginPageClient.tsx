'use client'

import ManoaWordmark from '@/src/components/ManoaWordmark'
import { createSupabaseMagicLinkBrowser } from '@/src/lib/supabase/browser'
import { useEffect, useMemo, useState } from 'react'

type LoginPageClientProps = {
  loginStatus?: string
  isSupabaseConfigured: boolean
  appUrl?: string | null
  initialEmail?: string
}

function friendlyLoginError(message: string) {
  const lower = message.toLowerCase()

  if (lower.includes('email rate limit exceeded') || lower.includes('rate limit')) {
    return 'Too many login emails were sent in a short stretch. Wait a minute, then try again. If you already got one, use the newest email in your inbox.'
  }

  if (lower.includes('signup') && lower.includes('not allowed')) {
    return 'That email is not ready for dashboard login yet. Try again in a minute. If it keeps happening, Manoa still needs to finish linking your account.'
  }

  return message || 'We could not send your login link yet. Try again in a minute.'
}

function isAccountLookupStyleAuthMiss(message: string) {
  const lower = message.toLowerCase()
  return (
    (lower.includes('signup') && lower.includes('not allowed')) ||
    lower.includes('user not found') ||
    lower.includes('email not found') ||
    lower.includes('invalid login')
  )
}

export default function LoginPageClient({
  loginStatus,
  isSupabaseConfigured,
  appUrl,
  initialEmail = '',
}: LoginPageClientProps) {
  const [email, setEmail] = useState(initialEmail)
  const [pending, setPending] = useState(false)
  const [localMessage, setLocalMessage] = useState<{
    tone: 'success' | 'warning'
    text: string
  } | null>(null)

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const accessToken = hash.get('access_token')
    const refreshToken = hash.get('refresh_token')

    if (!accessToken || !refreshToken) return
    const recoveredAccessToken = accessToken
    const recoveredRefreshToken = refreshToken

    let cancelled = false

    async function recoverHashSession() {
      try {
        const response = await fetch('/api/auth/finalize-login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            next: '/dashboard',
            accessToken: recoveredAccessToken,
            refreshToken: recoveredRefreshToken,
          }),
        })

        if (cancelled) return
        if (!response.ok) {
          setLocalMessage({
            tone: 'warning',
            text: 'That login link did not work. Send yourself a fresh one below.',
          })
          return
        }

        window.location.replace('/dashboard')
      } catch {
        if (cancelled) return
        setLocalMessage({
          tone: 'warning',
          text: 'That login link did not work. Send yourself a fresh one below.',
        })
      }
    }

    void recoverHashSession()

    return () => {
      cancelled = true
    }
  }, [])

  const statusMessage = useMemo(() => {
    if (loginStatus === 'error') {
      return {
        tone: 'warning' as const,
        text: 'That login link did not work. Send yourself a fresh one below.',
      }
    }
    if (loginStatus === 'signed_out') {
      return {
        tone: 'success' as const,
        text: 'You signed out. Use a new login link any time.',
      }
    }
    return null
  }, [loginStatus])

  async function sendMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail.includes('@')) {
      setLocalMessage({
        tone: 'warning',
        text: 'Enter the email you used with Manoa and we will send the link there.',
      })
      return
    }

    setPending(true)
    setLocalMessage(null)

    try {
      if (!isSupabaseConfigured) {
        setLocalMessage({
          tone: 'warning',
          text: 'Login links are not configured in this deployment yet. Redeploy after adding the public Supabase keys in Vercel.',
        })
        return
      }

      const prepareResponse = await fetch('/api/auth/prepare-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: normalizedEmail }),
      })

      if (!prepareResponse.ok) {
        const payload = (await prepareResponse.json().catch(() => null)) as { error?: string } | null
        setLocalMessage({
          tone: 'warning',
          text:
            payload?.error || 'We could not get your Manoa login ready yet. Try again in a minute.',
        })
        return
      }

      const supabase = createSupabaseMagicLinkBrowser()
      const redirectBase = window.location.origin.replace(/\/$/, '') || (appUrl || '').replace(/\/$/, '')
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${redirectBase}/auth/callback?next=/dashboard`,
        },
      })

      if (error) {
        if (isAccountLookupStyleAuthMiss(error.message || '')) {
          setLocalMessage({
            tone: 'success',
            text: `If ${normalizedEmail} is ready for Manoa, we sent a login link there.`,
          })
          setEmail('')
          return
        }

        setLocalMessage({
          tone: 'warning',
          text: friendlyLoginError(error.message || ''),
        })
        return
      }

      setLocalMessage({
        tone: 'success',
        text: `If ${normalizedEmail} is ready for Manoa, we sent a login link there.`,
      })
      setEmail('')
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? friendlyLoginError(error.message)
          : 'We could not send your login link yet. Try again in a minute.'
      setLocalMessage({
        tone: 'warning',
        text: message,
      })
    } finally {
      setPending(false)
    }
  }

  const message = localMessage || statusMessage

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <ManoaWordmark className="legal-back compact" href="/" />
        <p className="legal-eyebrow">Log in</p>
        <h1 className="auth-title">Open your Manoa dashboard.</h1>
        <p className="auth-lede">
          Enter the email you signed up with and Manoa will send you a secure login link. No
          password to remember.
        </p>

        {!isSupabaseConfigured ? (
          <div className="notice warning" role="status" aria-live="polite">
            This deployment is still missing the public Supabase keys needed for login links.
          </div>
        ) : null}

        {message ? (
          <div className={`notice ${message.tone}`} role="status" aria-live="polite">
            {message.text}
          </div>
        ) : null}

        <form className="auth-form" onSubmit={sendMagicLink}>
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <button className="button" type="submit">
            {pending ? 'Sending link...' : 'Email me a login link'}
          </button>
        </form>

        <p className="auth-help">
          After you open the email, the link will take you straight back to your dashboard.
        </p>
      </div>
    </main>
  )
}
