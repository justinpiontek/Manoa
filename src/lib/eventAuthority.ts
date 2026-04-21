import type { BusinessContact } from './businessContacts'
import type { EventSummary } from './calendar/google'

export type EventAuthority =
  | 'personal'
  | 'owned_meeting'
  | 'invited_meeting'
  | 'external_appointment'
  | 'unknown'

const externalAppointmentKeywords = [
  'doctor',
  'dentist',
  'orthodontist',
  'therapy',
  'therapist',
  'vet',
  'veterinarian',
  'medical',
  'clinic',
  'salon',
  'haircut',
  'hair cut',
  'hair appointment',
  'barber',
  'repair',
  'service',
  'inspection',
  'appointment',
  'cleaning',
]

function normalizeEmail(value: string | null | undefined) {
  return (value || '').trim().toLowerCase()
}

export function looksExternalAppointment(event: EventSummary) {
  const haystack = [event.title, event.location, event.description]
    .join(' ')
    .toLowerCase()

  return externalAppointmentKeywords.some((keyword) => haystack.includes(keyword))
}

export function classifyEventAuthority({
  event,
  profileEmail,
  businessContact,
}: {
  event: EventSummary
  profileEmail?: string | null
  businessContact?: BusinessContact | null
}): EventAuthority {
  if (businessContact || looksExternalAppointment(event)) {
    return 'external_appointment'
  }

  if (event.attendeeCount === 0) {
    return 'personal'
  }

  const organizerEmail = normalizeEmail(event.organizerEmail)
  const ownerEmail = normalizeEmail(event.ownerEmail)
  const userEmail = normalizeEmail(profileEmail)

  if (
    organizerEmail &&
    ((userEmail && organizerEmail === userEmail) || (ownerEmail && organizerEmail === ownerEmail))
  ) {
    return 'owned_meeting'
  }

  if (
    organizerEmail &&
    ((userEmail && organizerEmail !== userEmail) || (ownerEmail && organizerEmail !== ownerEmail))
  ) {
    return 'invited_meeting'
  }

  if (ownerEmail && !event.selfResponseStatus) {
    return 'owned_meeting'
  }

  return 'unknown'
}
