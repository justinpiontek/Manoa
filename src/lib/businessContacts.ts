import { normalizePhone } from './phone'
import { supabaseAdmin } from './supabaseAdmin'

export type BusinessContact = {
  id: string
  profile_id: string
  label: string
  phone_e164: string
  category: string
  notes: string | null
  aliases: string[] | null
}

const officePhonePattern =
  /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function buildBusinessAliases(values: Array<string | null | undefined>) {
  return [...new Set(values.flatMap((value) => {
    const cleaned = (value || '').trim()
    if (!cleaned) return []

    const tokens = tokenize(cleaned)
    const joined = tokens.join(' ')
    if (!joined) return []

    return [cleaned, joined]
  }))]
}

function contactMatches(contact: BusinessContact, query: string) {
  const queryWords = tokenize(query)
  if (!queryWords.length) return false

  const haystacks = [contact.label, ...(contact.aliases || [])].map((value) =>
    value.toLowerCase(),
  )

  return (
    queryWords.some((word) => haystacks.some((value) => value.includes(word))) ||
    haystacks.some((value) => queryWords.every((word) => value.includes(word)))
  )
}

export function extractPhoneFromText(text: string | null | undefined) {
  if (!text) return null
  const match = text.match(officePhonePattern)
  if (!match) return null

  const phone = normalizePhone(match[0])
  return phone.length >= 8 ? phone : null
}

export async function getBusinessContacts(profileId: string) {
  const { data, error } = await supabaseAdmin
    .from('business_contacts')
    .select('id,profile_id,label,phone_e164,category,notes,aliases')
    .eq('profile_id', profileId)
    .returns<BusinessContact[]>()

  if (error) throw error
  return data || []
}

export async function findBusinessContact(profileId: string, query: string) {
  const data = await getBusinessContacts(profileId)
  return data.find((contact) => contactMatches(contact, query)) || null
}

export async function inferBusinessContact({
  profileId,
  query,
  location,
  description,
}: {
  profileId: string
  query: string
  location?: string
  description?: string
}) {
  const saved = await findBusinessContact(
    profileId,
    [query, location || '', description || ''].join(' '),
  )
  if (saved) return saved

  const inferredPhone = extractPhoneFromText([description || '', location || ''].join('\n'))
  if (!inferredPhone) return null

  return {
    id: '',
    profile_id: profileId,
    label: query,
    phone_e164: inferredPhone,
    category: 'business',
    notes: 'Inferred from calendar details',
    aliases: [],
  } satisfies BusinessContact
}

export async function saveBusinessContact({
  profileId,
  label,
  phoneE164,
  category = 'business',
  notes = null,
  aliases = [],
}: {
  profileId: string
  label: string
  phoneE164: string
  category?: string
  notes?: string | null
  aliases?: string[]
}) {
  const { data, error } = await supabaseAdmin
    .from('business_contacts')
    .upsert(
      {
        profile_id: profileId,
        label,
        phone_e164: phoneE164,
        category,
        notes,
        aliases,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id,label' },
    )
    .select('id,profile_id,label,phone_e164,category,notes,aliases')
    .single<BusinessContact>()

  if (error) throw error
  return data
}

export async function saveOrUpdateBusinessContact({
  profileId,
  label,
  phoneE164,
  category = 'business',
  notes = null,
  aliases = [],
}: {
  profileId: string
  label: string
  phoneE164: string
  category?: string
  notes?: string | null
  aliases?: string[]
}) {
  const match = await findBusinessContact(profileId, [label, ...aliases].join(' '))
  if (!match) {
    return saveBusinessContact({
      profileId,
      label,
      phoneE164,
      category,
      notes,
      aliases,
    })
  }

  const mergedAliases = [...new Set([...(match.aliases || []), ...aliases, label])]
  const { data, error } = await supabaseAdmin
    .from('business_contacts')
    .update({
      phone_e164: phoneE164,
      category,
      notes,
      aliases: mergedAliases,
      updated_at: new Date().toISOString(),
    })
    .eq('id', match.id)
    .select('id,profile_id,label,phone_e164,category,notes,aliases')
    .single<BusinessContact>()

  if (error) throw error
  return data
}
