export function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export function missingEnv(names: string[]) {
  return names.filter((name) => !process.env[name])
}

export function appUrl() {
  const value = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  try {
    const url = new URL(value)

    if (url.hostname === 'textmanoa.com') {
      url.hostname = 'www.textmanoa.com'
      return url.toString().replace(/\/$/, '')
    }

    return url.toString().replace(/\/$/, '')
  } catch {
    return value.replace(/\/$/, '')
  }
}

export function defaultTimezone() {
  return process.env.DEFAULT_TIMEZONE || 'America/Chicago'
}
