export const siteTitle = 'Manoa | Calendar assistant by text'

export const siteDescription =
  'Manoa is your calendar assistant by text. Schedule events, move plans, add events from screenshots and flyers, and get agenda and reminder texts without opening another app.'

export const siteSupportEmail = 'justin@textmanoa.com'

export function supportMailtoHref(subject?: string, body?: string) {
  const params = new URLSearchParams()
  if (subject) params.set('subject', subject)
  if (body) params.set('body', body)
  const query = params.toString()
  return `mailto:${siteSupportEmail}${query ? `?${query}` : ''}`
}
