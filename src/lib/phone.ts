export function normalizePhone(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return ''

  const digits = trimmed.replace(/[^\d]/g, '')
  if (trimmed.startsWith('+')) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

export function formatPhoneForDisplay(input: string) {
  const normalized = normalizePhone(input)
  const digits = normalized.replace(/[^\d]/g, '')

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }

  return normalized || input
}
