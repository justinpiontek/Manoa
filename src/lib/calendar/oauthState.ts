import crypto from 'node:crypto'

export type CalendarOAuthProvider = 'google' | 'outlook'

type CalendarOAuthCookiePayload = {
  nonce: string
  profileId: string
  accountId: string | null
  issuedAt: number
}

const oauthCookieMaxAgeSeconds = 10 * 60

function oauthStateSecret() {
  const explicit = process.env.CALENDAR_OAUTH_STATE_SECRET?.trim()
  if (explicit) return explicit

  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (fallback) return fallback

  throw new Error(
    'Missing required environment variable: CALENDAR_OAUTH_STATE_SECRET or SUPABASE_SERVICE_ROLE_KEY',
  )
}

function signCookieValue(provider: CalendarOAuthProvider, payloadBase64: string) {
  return crypto
    .createHmac('sha256', oauthStateSecret())
    .update(`${provider}.${payloadBase64}`)
    .digest('base64url')
}

function timingSafeEqualString(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function cookieName(provider: CalendarOAuthProvider) {
  return `manoa_${provider}_oauth`
}

function callbackPath(provider: CalendarOAuthProvider) {
  return provider === 'google'
    ? '/api/calendar/google/callback'
    : '/api/calendar/outlook/callback'
}

export function createCalendarOAuthState(
  provider: CalendarOAuthProvider,
  payload: { profileId: string; accountId?: string | null },
) {
  const cookiePayload: CalendarOAuthCookiePayload = {
    nonce: crypto.randomUUID(),
    profileId: payload.profileId,
    accountId: payload.accountId?.trim() || null,
    issuedAt: Date.now(),
  }

  const payloadBase64 = Buffer.from(JSON.stringify(cookiePayload), 'utf8').toString('base64url')
  const signature = signCookieValue(provider, payloadBase64)

  return {
    state: cookiePayload.nonce,
    cookie: {
      name: cookieName(provider),
      value: `${payloadBase64}.${signature}`,
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        secure: process.env.NODE_ENV === 'production',
        path: callbackPath(provider),
        maxAge: oauthCookieMaxAgeSeconds,
      },
    },
  }
}

export function readCalendarOAuthState(
  provider: CalendarOAuthProvider,
  cookieValue: string | undefined,
  state: string | null,
) {
  if (!cookieValue || !state) return null

  try {
    const [payloadBase64, signature] = cookieValue.split('.')
    if (!payloadBase64 || !signature) return null
    const expectedSignature = signCookieValue(provider, payloadBase64)
    if (!timingSafeEqualString(signature, expectedSignature)) return null

    const parsed = JSON.parse(
      Buffer.from(payloadBase64, 'base64url').toString('utf8'),
    ) as CalendarOAuthCookiePayload

    if (!parsed?.nonce || !parsed?.profileId) return null
    if (parsed.nonce !== state) return null
    if (Date.now() - parsed.issuedAt > oauthCookieMaxAgeSeconds * 1000) return null

    return parsed
  } catch {
    return null
  }
}

export function clearCalendarOAuthCookie(provider: CalendarOAuthProvider) {
  return {
    name: cookieName(provider),
    value: '',
    options: {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: callbackPath(provider),
      maxAge: 0,
    },
  }
}
