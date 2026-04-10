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
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

export function defaultTimezone() {
  return process.env.DEFAULT_TIMEZONE || 'America/Chicago'
}
