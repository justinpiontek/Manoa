import crypto from 'node:crypto'

export type CalendarOAuthProvider = 'google' | 'outlook'

type CalendarOAuthCookiePayload = {
  nonce: string
  profileId: string
  accountId: string | null
  issuedAt: number
}

const oauthCookieMaxAgeSeconds = 10 * 60

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

  return {
    state: cookiePayload.nonce,
    cookie: {
      name: cookieName(provider),
      value: Buffer.from(JSON.stringify(cookiePayload), 'utf8').toString('base64url'),
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
    const parsed = JSON.parse(
      Buffer.from(cookieValue, 'base64url').toString('utf8'),
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
