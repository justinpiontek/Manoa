import crypto from 'node:crypto'
import type { NextRequest } from 'next/server'

type RateLimitEntry = {
  count: number
  resetAt: number
}

type RateLimitStore = Map<string, RateLimitEntry>

const globalRateLimitStoreKey = Symbol.for('manoa.rate-limit-store')
const globalForRateLimit = globalThis as typeof globalThis & {
  [globalRateLimitStoreKey]?: RateLimitStore
}

function rateLimitStore() {
  if (!globalForRateLimit[globalRateLimitStoreKey]) {
    globalForRateLimit[globalRateLimitStoreKey] = new Map<string, RateLimitEntry>()
  }

  return globalForRateLimit[globalRateLimitStoreKey]!
}

function hashedIdentity(identity: string) {
  return crypto.createHash('sha256').update(identity).digest('base64url')
}

function pruneExpiredEntries(store: RateLimitStore, now: number) {
  if (store.size < 5000) return

  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) {
      store.delete(key)
    }
  }
}

export function clientIp(request: NextRequest) {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const first = forwardedFor
      .split(',')
      .map((value) => value.trim())
      .find(Boolean)
    if (first) return first
  }

  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  return 'unknown'
}

export function checkRateLimit({
  scope,
  identity,
  limit,
  windowMs,
}: {
  scope: string
  identity: string
  limit: number
  windowMs: number
}) {
  const now = Date.now()
  const store = rateLimitStore()
  pruneExpiredEntries(store, now)

  const windowStart = Math.floor(now / windowMs) * windowMs
  const resetAt = windowStart + windowMs
  const key = `${scope}:${hashedIdentity(identity)}:${windowStart}`
  const entry = store.get(key)

  if (!entry) {
    store.set(key, { count: 1, resetAt })
    return {
      allowed: true,
      remaining: Math.max(limit - 1, 0),
      retryAfterSeconds: Math.max(Math.ceil((resetAt - now) / 1000), 1),
    }
  }

  if (entry.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(Math.ceil((entry.resetAt - now) / 1000), 1),
    }
  }

  entry.count += 1
  store.set(key, entry)

  return {
    allowed: true,
    remaining: Math.max(limit - entry.count, 0),
    retryAfterSeconds: Math.max(Math.ceil((entry.resetAt - now) / 1000), 1),
  }
}
