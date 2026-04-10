export type Invitee = {
  email: string
  displayName?: string | null
}

type InviteeParse = {
  cleanedText: string
  names: string[]
  directInvitees: Invitee[]
}

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const weekdayStop =
  '(?:today|tomorrow|tmrw|tomororw|tomororws|next\\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|sunday|monday|tuesday|wednesday|thursday|friday|saturday)'
const inviteClausePatterns = [
  new RegExp(`\\bwith\\s+(.+?)(?=\\b(?:on|at|for|${weekdayStop})\\b|$)`, 'i'),
  new RegExp(`\\bincluding\\s+(.+?)(?=\\b(?:on|at|for|${weekdayStop})\\b|$)`, 'i'),
  new RegExp(`\\binvite\\s+(.+?)(?=\\b(?:to|on|at|for|${weekdayStop})\\b|$)`, 'i'),
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
  const directInvitees = [...uniqueInvitees(
    [...text.matchAll(emailPattern)].map((match) => ({ email: match[0].toLowerCase() })),
  )]

  for (const pattern of inviteClausePatterns) {
    const match = text.match(pattern)
    if (!match) continue

    cleanedText = cleanedText.replace(match[0], ' ')
    const chunk = match[1]

    const namedEmails = extractNamedEmails(chunk)
    for (const invitee of namedEmails) {
      directInvitees.push(invitee)
    }

    const withoutEmails = chunk.replace(emailPattern, ' ')
    for (const name of splitNames(withoutEmails)) {
      if (name.length) names.add(name)
    }
  }

  return {
    cleanedText: cleanedText.replace(/\s+/g, ' ').trim(),
    names: [...names],
    directInvitees: uniqueInvitees(directInvitees),
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

export function inviteeLabel(invitee: Invitee) {
  return invitee.displayName ? `${invitee.displayName} <${invitee.email}>` : invitee.email
}
