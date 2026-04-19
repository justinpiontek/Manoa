import { supabaseAdmin } from './supabaseAdmin'

export type PersonContact = {
  id: string
  profile_id: string
  label: string
  email: string
  aliases: string[] | null
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9@._+-]+/)
    .filter(Boolean)
}

export function buildPersonAliases(values: Array<string | null | undefined>) {
  return [...new Set(values.flatMap((value) => {
    const cleaned = (value || '').trim()
    if (!cleaned) return []

    const tokens = tokenize(cleaned)
    const joined = tokens.join(' ')
    if (!joined) return []

    return [cleaned, joined]
  }))]
}

function contactMatches(contact: PersonContact, query: string) {
  const queryWords = tokenize(query)
  if (!queryWords.length) return false

  const haystacks = [contact.label, contact.email, ...(contact.aliases || [])].map((value) =>
    value.toLowerCase(),
  )

  return (
    queryWords.some((word) => haystacks.some((value) => value.includes(word))) ||
    haystacks.some((value) => queryWords.every((word) => value.includes(word)))
  )
}

function isMissingPeopleContactsTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : ''

  return code === 'PGRST205' || /people_contacts.*schema cache|could not find.*people_contacts/i.test(message)
}

export async function getPeopleContacts(profileId: string) {
  const { data, error } = await supabaseAdmin
    .from('people_contacts')
    .select('id,profile_id,label,email,aliases')
    .eq('profile_id', profileId)
    .returns<PersonContact[]>()

  if (error) {
    if (isMissingPeopleContactsTableError(error)) return []
    throw error
  }
  return data || []
}

export async function findPersonContact(profileId: string, query: string) {
  const data = await getPeopleContacts(profileId)
  return data.find((contact) => contactMatches(contact, query)) || null
}

export async function saveOrUpdatePersonContact({
  profileId,
  label,
  email,
  aliases = [],
}: {
  profileId: string
  label: string
  email: string
  aliases?: string[]
}) {
  const existingByEmail = await getPeopleContacts(profileId)
  const match =
    existingByEmail.find((contact) => contact.email.toLowerCase() === email.toLowerCase()) ||
    existingByEmail.find((contact) => contactMatches(contact, [label, ...aliases].join(' '))) ||
    null

  if (!match) {
    const { data, error } = await supabaseAdmin
      .from('people_contacts')
      .upsert(
        {
          profile_id: profileId,
          label,
          email,
          aliases,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'profile_id,email' },
      )
      .select('id,profile_id,label,email,aliases')
      .single<PersonContact>()

    if (error) {
      if (isMissingPeopleContactsTableError(error)) return null
      throw error
    }
    return data
  }

  const mergedAliases = [...new Set([...(match.aliases || []), ...aliases, label, email])]
  const { data, error } = await supabaseAdmin
    .from('people_contacts')
    .update({
      label,
      email,
      aliases: mergedAliases,
      updated_at: new Date().toISOString(),
    })
    .eq('id', match.id)
    .select('id,profile_id,label,email,aliases')
    .single<PersonContact>()

  if (error) {
    if (isMissingPeopleContactsTableError(error)) return null
    throw error
  }
  return data
}
