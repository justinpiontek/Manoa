import { supabaseAdmin } from '@/src/lib/supabaseAdmin'

export type SmsThreadEntry = {
  id: string
  body: string
  direction: 'inbound' | 'outbound'
  created_at: string
}

export type SmsThreadMessage = {
  id: string
  role: 'user' | 'manoa'
  lines: string[]
  createdAt: string
}

export async function listSmsThreadEntries(profileId: string, limit = 18) {
  const { data, error } = await supabaseAdmin
    .from('sms_messages')
    .select('id,body,direction,created_at')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  return ((data || []) as SmsThreadEntry[]).reverse()
}

export function toSmsThreadMessages(entries: SmsThreadEntry[]): SmsThreadMessage[] {
  return entries.map((entry) => ({
    id: entry.id,
    role: entry.direction === 'inbound' ? 'user' : 'manoa',
    lines: entry.body.split(/\n+/).filter(Boolean),
    createdAt: entry.created_at,
  }))
}
