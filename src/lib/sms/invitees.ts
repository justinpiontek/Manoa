export type Invitee = {
  email: string
  displayName?: string | null
}

type InviteeParse = {
  cleanedText: string
  names: string[]
  directInvitees: Invitee[]
}

export type ExistingEventInviteRequest = {
  eventQuery: string
  names: string[]
  directInvitees: Invitee[]
}

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const inviteeResolutionAbortPattern =
  /^(?:cancel|never mind|nevermind|forget it|leave it|stop|dont book it|don't book it)[.!]*$/i
const inviteeResolutionBookWithoutPattern =
  /\b(?:skip|skip invites?|skip the invites?|just book it|book it anyway|book without(?: invites?| them)?|without invites?|no invites?|dont invite|don't invite|dont send invites?|don't send invites?|no thanks|no thank you)\b/i
const monthStop =
  '(?:jan\\.?|january|feb\\.?|february|mar\\.?|march|apr\\.?|april|may|jun\\.?|june|jul\\.?|july|aug\\.?|august|sep\\.?|sept\\.?|september|oct\\.?|october|nov\\.?|november|dec\\.?|december)'
const weekdayStop =
  '(?:today|tomorrow|tmrw|tomororw|tomororws|next\\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|sunday|monday|tuesday|wednesday|thursday|friday|saturday)'
const relativeDateStop = `(?:tonight|this\\s+(?:morning|afternoon|evening|week|weekend|month)|next\\s+(?:week|month|weekend)|early\\s+next\\s+week|mid\\s+next\\s+week|end\\s+of\\s+(?:the\\s+)?month|in\\s+(?:\\d+\\s+(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?)|${monthStop}))`
const inviteStop = `(?:on|at|for|${weekdayStop}|${relativeDateStop})`
const inviteClausePatterns = [
  new RegExp(`\\bwith\\s+(.+?)(?=\\b${inviteStop}\\b|$)`, 'i'),
  new RegExp(`\\bincluding\\s+(.+?)(?=\\b${inviteStop}\\b|$)`, 'i'),
  new RegExp(`\\binvite\\s+(.+?)(?=\\b(?:to|${inviteStop})\\b|$)`, 'i'),
]

function uniqueInvitees(invitees: Invitee[]) {
  const seen = new Set<string>()
  return invitees.filter((invitee) => {
    const key = invitee.email.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function cleanCandidate(value: string) {
  return value
    .replace(/\b(?:the|my|our)\b/gi, ' ')
    .replace(/\b(?:is|email|e-mail|address)\s*$/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitNames(chunk: string) {
  return chunk
    .split(/\s*(?:,|&| and )\s*/i)
    .map((part) => cleanCandidate(part))
    .filter(Boolean)
}

function extractNamedEmails(text: string) {
  const matches = [...text.matchAll(/([A-Za-z][A-Za-z .'-]{0,40})\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi)]
  return matches.map((match) => ({
    displayName: cleanCandidate(match[1]),
    email: match[2].toLowerCase(),
  }))
}

export function parseInviteesFromText(text: string): InviteeParse {
  let cleanedText = text
  const names = new Set<string>()
  const directInvitees: Invitee[] = []

  for (const pattern of inviteClausePatterns) {
    const match = text.match(pattern)
    if (!match) continue

    const chunk = match[1]
    const keyword = match[0].trim().split(/\s+/)[0]?.toLowerCase()

    const namedEmails = extractNamedEmails(chunk)
    for (const invitee of namedEmails) {
      directInvitees.push(invitee)
    }

    const withoutEmails = chunk.replace(emailPattern, ' ')
    const cleanedChunkWithoutEmails = withoutEmails.replace(/\s+/g, ' ').trim()
    cleanedText = cleanedText.replace(
      match[0],
      keyword === 'with' && cleanedChunkWithoutEmails ? ` with ${cleanedChunkWithoutEmails} ` : ' ',
    )
    const namedEmailNames = namedEmails
      .map((invitee) => invitee.displayName?.trim().toLowerCase())
      .filter(Boolean)
    for (const name of splitNames(withoutEmails)) {
      const normalizedName = name.toLowerCase()
      if (
        namedEmailNames.some(
          (namedEmailName) =>
            namedEmailName === normalizedName ||
            normalizedName.includes(namedEmailName) ||
            namedEmailName.includes(normalizedName),
        )
      ) {
        continue
      }
      if (name.length) names.add(name)
    }
  }

  directInvitees.push(
    ...[...text.matchAll(emailPattern)].map((match) => ({ email: match[0].toLowerCase() })),
  )

  return {
    cleanedText: cleanedText.replace(/\s+/g, ' ').replace(/^\s*to\s+/i, '').trim(),
    names: [...names],
    directInvitees: uniqueInvitees(directInvitees),
  }
}

export function parseExistingEventInviteRequest(text: string): ExistingEventInviteRequest | null {
  const match = text.match(/\b(?:add|invite)\s+(.+?)\s+to\s+(.+)$/i)
  if (!match) return null

  const peopleText = cleanCandidate(match[1])
  const rawEventText = match[2].trim().replace(/[?.!]+$/g, '').trim()
  const genericEventReference = /^(?:the\s+|my\s+|our\s+)?(?:(?:calendar\s+)?event|that|that\s+event|this|this\s+event|it)$/i.test(
    rawEventText,
  )
  const eventQuery = cleanCandidate(
    rawEventText
      .replace(/^(?:the|my|our)\s+/i, '')
      .replace(/\b(?:event|calendar event)\b/gi, ' '),
  )

  if (!peopleText || (!eventQuery && !genericEventReference)) return null

  const parsed = parseInviteesFromText(`with ${peopleText}`)
  if (!parsed.names.length && !parsed.directInvitees.length) return null

  return {
    eventQuery: genericEventReference ? 'that' : eventQuery,
    names: parsed.names,
    directInvitees: parsed.directInvitees,
  }
}

export function resolveInviteeFollowUp(text: string, unresolvedNames: string[]) {
  const namedEmails = extractNamedEmails(text)
  const bareEmails = [...text.matchAll(emailPattern)].map((match) => match[0].toLowerCase())
  const resolved: Invitee[] = []
  const usedEmails = new Set<string>()
  const remainingNames: string[] = []

  for (const unresolvedName of unresolvedNames) {
    const normalized = unresolvedName.toLowerCase()
    const exact = namedEmails.find((invitee) => invitee.displayName?.toLowerCase().includes(normalized))
    if (exact) {
      resolved.push(exact)
      usedEmails.add(exact.email)
      continue
    }

    const nextBareEmail = bareEmails.find((email) => !usedEmails.has(email))
    if (nextBareEmail) {
      resolved.push({
        email: nextBareEmail,
        displayName: unresolvedName,
      })
      usedEmails.add(nextBareEmail)
      continue
    }

    remainingNames.push(unresolvedName)
  }

  return {
    resolved: uniqueInvitees(resolved),
    unresolvedNames: remainingNames,
  }
}

export function isInviteeResolutionAbort(text: string) {
  return inviteeResolutionAbortPattern.test(text.trim())
}

export function isInviteeResolutionBookWithoutInvites(text: string) {
  return inviteeResolutionBookWithoutPattern.test(text.trim())
}

export function isInviteeEmailFollowUp(text: string, unresolvedNames: string[]) {
  if (!unresolvedNames.length) return false

  const lower = text.trim().toLowerCase()
  if (
    /^(?:no|nope|nah|n|leave it|do not|don't|dont|not now)\b/.test(lower) ||
    isInviteeResolutionAbort(lower) ||
    isInviteeResolutionBookWithoutInvites(lower)
  ) {
    return false
  }

  return resolveInviteeFollowUp(text, unresolvedNames).resolved.length > 0
}

export function inviteeLabel(invitee: Invitee) {
  return invitee.displayName ? `${invitee.displayName} <${invitee.email}>` : invitee.email
}
