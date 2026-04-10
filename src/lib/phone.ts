export function normalizePhone(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return ''

  const digits = trimmed.replace(/[^\d]/g, '')
  if (trimmed.startsWith('+')) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}
