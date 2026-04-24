import { supabaseAdmin } from '@/src/lib/supabaseAdmin'
import type { AiConversationTurn } from './aiIntent'

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
    .order('direction', { ascending: false })
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

export async function listSmsAiIntentContext(
  profileId: string,
  currentInboundBody?: string,
  limit = 4,
): Promise<AiConversationTurn[]> {
  const entries = await listSmsThreadEntries(profileId, currentInboundBody ? limit + 1 : limit)
  const contextEntries = [...entries]
  const trimmedCurrentBody = currentInboundBody?.trim()
  const newestEntry = contextEntries.at(-1)

  if (
    trimmedCurrentBody &&
    newestEntry?.direction === 'inbound' &&
    newestEntry.body.trim() === trimmedCurrentBody
  ) {
    contextEntries.pop()
  }

  return contextEntries.slice(-limit).map((entry) => ({
    role: entry.direction === 'inbound' ? 'user' : 'assistant',
    content: entry.body,
  }))
}
