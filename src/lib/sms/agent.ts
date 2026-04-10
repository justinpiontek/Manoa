import {
  createCalendarEvent,
  deleteCalendarEvent,
  findScheduleOptions,
  getCalendarEvent,
  hasGoogleCalendar,
  listAgenda,
  listUpcomingEvents,
  updateCalendarEvent,
  type EventSummary,
  type ScheduleOption,
} from '../calendar/google'
import {
  addMinutes,
  formatSmsDate,
  formatSmsTime,
  nextDateForWeekday,
  setTime,
  startOfDay,
} from '../calendar/dates'
import { parseGoogleRecurrence, recurrenceSummary, type RecurrenceSpec } from '../calendar/recurrence'
import {
  buildBusinessAliases,
  extractPhoneFromText,
  inferBusinessContact,
  saveOrUpdateBusinessContact,
  type BusinessContact,
} from '../businessContacts'
import {
  buildPersonAliases,
  findPersonContact,
  saveOrUpdatePersonContact,
} from '../peopleContacts'
import {
  classifyEventAuthority,
  looksExternalAppointment,
  type EventAuthority,
} from '../eventAuthority'
import { supabaseAdmin } from '../supabaseAdmin'
import { inviteeLabel, parseInviteesFromText, resolveInviteeFollowUp, type Invitee } from './invitees'
import { parseSmsIntentWithAI } from './aiIntent'
import { resolvePendingChoice } from './pendingChoice'
import { parseSmsIntent, parseSmsTime } from './parser'

type SmsProfile = {
  id: string
  email: string
  phone_e164: string
  timezone: string
  phone_confirmed_at: string | null
  sms_opted_out_at: string | null
  subscriptionStatus: string
}

type PendingKind =
  | 'schedule'
  | 'resolve_invitees'
  | 'reschedule'
  | 'select_reschedule_target'
  | 'invited_reschedule_action'
  | 'invited_reschedule_hold'
  | 'invited_cancel_action'
  | 'external_call_prep'
  | 'external_cancel_confirm'
  | 'external_reschedule_confirm'
  | 'save_business_contact_phone'

type PendingPayload = {
  options?: ScheduleOption[]
  selectedOption?: ScheduleOption
  events?: EventSummary[]
  target?: EventSummary
  seriesTarget?: EventSummary
  businessName?: string
  phoneE164?: string | null
  callNote?: string
  requestedBaseDate?: string
  exactTime?: { hour: number; minute: number } | null
  authority?: EventAuthority
  recurrence?: RecurrenceSpec | null
  stage?: 'scope' | 'options'
  scope?: 'single' | 'series'
  followUpKind?: PendingKind | null
  holdEventId?: string | null
  holdCalendarId?: string | null
  attendees?: Invitee[]
  unresolvedInvitees?: string[]
}

type PendingAction = {
  id: string
  kind: PendingKind
  payload: PendingPayload
}

const activeSubscriptionStatuses = new Set(['active', 'trialing'])
const backgroundPendingKinds: PendingKind[] = [
  'external_cancel_confirm',
  'external_reschedule_confirm',
]
const weekdayNumbers: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

const stopWords = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'])
const startWords = new Set(['start', 'unstop'])

function optionList(options: ScheduleOption[]) {
  return options
    .map(
      (option, index) =>
        `${index + 1}. ${option.dayLabel} at ${option.timeLabel} on ${option.calendarName}`,
    )
    .join('\n')
}

function callPrepOptionList(options: ScheduleOption[]) {
  return options
    .map((option, index) => `${index + 1}. ${option.dayLabel} at ${option.timeLabel}`)
    .join('\n')
}

function recurrenceLine(options: ScheduleOption[]) {
  const firstOption = options[0]
  const summary = recurrenceSummary(firstOption?.recurrence, firstOption?.start || '')
  return summary || null
}

function bookingText(option: ScheduleOption) {
  const summary = recurrenceSummary(option.recurrence, option.start)
  if (summary) {
    return `Booked ${option.title} starting ${option.dayLabel} at ${option.timeLabel}.\n${summary}`
  }

  return `Booked ${option.title} for ${option.dayLabel} at ${option.timeLabel}.`
}

function agendaText(day: 'today' | 'tomorrow', events: EventSummary[]) {
  if (!events.length) {
    return day === 'tomorrow'
      ? "Tomorrow's schedule is clear."
      : "You're clear today."
  }

  const heading = day === 'tomorrow' ? "Tomorrow's schedule:" : 'Today:'
  return `${heading}\n${events
    .map((event) => `${event.timeLabel} ${event.title} (${event.calendarName})`)
    .join('\n')}`
}

function choose<T>(items: T[] | undefined, choice: number) {
  return items?.[choice - 1] || null
}

function isShortAcknowledgement(text: string) {
  const lower = text.trim().toLowerCase()
  return (
    lower.split(/\s+/).length <= 4 &&
    /\b(ok|okay|got it|sounds good|cool|thanks|thank you|perfect|nice)\b/.test(lower)
  )
}

function reminderForPending(pending: PendingAction) {
  switch (pending.kind) {
    case 'schedule':
    case 'invited_reschedule_hold':
    case 'external_call_prep':
      return 'Reply with the option you want, like 1, 2, or 3.'
    case 'reschedule':
      if (pending.payload.stage === 'scope') {
        return 'Reply 1 for just this one, 2 for the whole series, or 3 to keep it.'
      }
      return 'Reply with the option you want, like 1, 2, or 3.'
    case 'select_reschedule_target':
      return 'Reply with which one you mean, like 1, 2, or 3.'
    case 'invited_reschedule_action':
      return 'Reply 1 to hold a time, 2 for a draft to the organizer, or 3 to keep it.'
    case 'invited_cancel_action':
      if (pending.payload.stage === 'scope') {
        return 'Reply 1 for just this one, 2 for the whole series, or 3 to keep it.'
      }
      return 'Reply 1 to remove it from your calendar, 2 for a draft message, or 3 to keep it.'
    case 'resolve_invitees':
      return 'Reply with the missing email, like "Priya priya@company.com", or say "book it without invites."'
    case 'save_business_contact_phone':
      return "Reply with the office number, or say SKIP if you don't want to save it yet."
    default:
      return 'Tell me what you want to do next.'
  }
}

function eventDateLabel(event: EventSummary) {
  const start = new Date(event.start)
  if (Number.isNaN(start.getTime())) return event.timeLabel
  return `${formatSmsDate(start)} at ${formatSmsTime(start)}`
}

function eventDurationMinutes(event: EventSummary) {
  const start = new Date(event.start).getTime()
  const end = new Date(event.end).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 30
  return Math.max(15, Math.round((end - start) / 60_000))
}

function isRecurringEvent(event: EventSummary) {
  return Boolean(event.recurringEventId || event.recurrence?.length)
}

async function loadSeriesMaster(profileId: string, target: EventSummary) {
  const seriesId = target.recurringEventId || target.id
  const seriesTarget = await getCalendarEvent(profileId, seriesId, target.calendarId)
  if (!seriesTarget) return null

  return {
    seriesTarget,
    recurrence: parseGoogleRecurrence(seriesTarget.recurrence),
  }
}

function recurringReschedulePrompt(target: EventSummary) {
  return `${target.title} is part of a repeating series.\nDo you want me to:\n1. Move just this one\n2. Move the whole series\n3. Keep it as is`
}

function recurringCancelPrompt(target: EventSummary) {
  return `${target.title} is part of a repeating series.\nDo you want me to:\n1. Cancel just this one\n2. Cancel the whole series\n3. Keep it`
}

function buildCallNote(target: EventSummary, options: ScheduleOption[]) {
  const bestTimes = options.map((option) => `${option.dayLabel} ${option.timeLabel}`).join(', ')
  return `Need to move ${target.title} from ${eventDateLabel(target)}. Best times: ${bestTimes}.`
}

function buildCancelNote(target: EventSummary) {
  return `Need to cancel ${target.title} scheduled for ${eventDateLabel(target)}.`
}

function tokenizeText(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function referencesExternalTarget(
  text: string,
  target?: EventSummary | null,
  businessName?: string | null,
) {
  const lower = text.trim().toLowerCase()
  if (/\b(it|that|appointment|visit|booking)\b/.test(lower)) return true

  const targetTokens = [target?.title, businessName, target?.location]
    .flatMap((value) => tokenizeText(value || ''))
    .filter((token) => token.length > 2)

  return targetTokens.some((token) => lower.includes(token))
}

function confirmsExternalCancellation(
  text: string,
  target?: EventSummary | null,
  businessName?: string | null,
) {
  const lower = text.trim().toLowerCase()
  const referencesTarget = referencesExternalTarget(lower, target, businessName)
  return (
    referencesTarget &&
    /\b(i|we|they)\b/.test(lower) &&
    /\b(called|call|confirmed|finished|done|all set)\b/.test(lower) &&
    /\b(cancel|canceled|cancelled)\b/.test(lower)
  ) ||
    (referencesTarget && /\b(cancel|canceled|cancelled)\s+(it|that|the appointment)?\b/.test(lower)) ||
    (referencesTarget && /\b(it'?s|its)\s+canceled\b/.test(lower))
}

function mentionsOfficeDelay(
  text: string,
  target?: EventSummary | null,
  businessName?: string | null,
) {
  const lower = text.trim().toLowerCase()
  return (
    referencesExternalTarget(lower, target, businessName) &&
    /\b(voicemail|message|no answer|didn'?t answer|didnt answer|couldn'?t reach|couldnt reach|waiting to hear back|call me back|hear back)\b/.test(lower)
  )
}

function mentionsFailedExternalReschedule(
  text: string,
  target?: EventSummary | null,
  businessName?: string | null,
) {
  const lower = text.trim().toLowerCase()
  return (
    referencesExternalTarget(lower, target, businessName) &&
    /\b(couldn'?t do|couldnt do|no openings|no availability|nothing available|didn'?t work|didnt work|not available)\b/.test(lower)
  )
}

function parseExternalFollowUpDate(text: string) {
  const lower = text.toLowerCase()
  if (/\btoday\b/.test(lower)) return startOfDay(0)
  if (/\btomorrow'?s?\b|\btmrw\b|\btomororws?\b/.test(lower)) return startOfDay(1)

  const dayMatch = lower.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)
  if (!dayMatch) return null
  return nextDateForWeekday(weekdayNumbers[dayMatch[1]])
}

function parseExternalRescheduleConfirmation(
  text: string,
  target?: EventSummary | null,
  businessName?: string | null,
) {
  const lower = text.trim().toLowerCase()
  const referencesTarget = referencesExternalTarget(lower, target, businessName)
  const exactTime = parseSmsTime(text)
  const explicitDate = parseExternalFollowUpDate(text)
  const mentionsReschedule =
    /\b(reschedule|rescheduled|move|moved|change|changed|rebooked|booked)\b/.test(lower) ||
    /\bthey can do\b/.test(lower) ||
    /\bit is now\b/.test(lower) ||
    /\bnew time\b/.test(lower)
  const hasCallContext = /\b(called|office|they|confirmed)\b/.test(lower)

  if (!referencesTarget || (!mentionsReschedule && !(hasCallContext && exactTime && explicitDate))) {
    return { kind: 'none' as const }
  }

  if (!exactTime || !explicitDate) {
    return { kind: 'needs_details' as const }
  }

  return {
    kind: 'confirmed_reschedule' as const,
    baseDate: explicitDate,
    exactTime,
  }
}

function optionFromExactExternalTime(target: EventSummary, baseDate: Date, exactTime: { hour: number; minute: number }): ScheduleOption {
  const start = setTime(baseDate, exactTime)
  const end = addMinutes(start, eventDurationMinutes(target))
  return {
    title: target.title,
    start: start.toISOString(),
    end: end.toISOString(),
    calendarId: target.calendarId,
    calendarName: target.calendarName,
    dayLabel: formatSmsDate(start),
    timeLabel: formatSmsTime(start),
  }
}

function buildOrganizerRescheduleDraft(target: EventSummary, options: ScheduleOption[]) {
  const bestTimes = options.map((option) => `${option.dayLabel} ${option.timeLabel}`).join(', ')
  return `Draft: Hi, I need to move ${target.title}. I can do ${bestTimes}. Let me know what works.`
}

function buildOrganizerCancelDraft(target: EventSummary) {
  return `Draft: Hi, I need to decline ${target.title} scheduled for ${eventDateLabel(target)}.`
}

const queryNoiseWords = new Set([
  'the',
  'that',
  'this',
  'my',
  'one',
  'thing',
  'stuff',
  'event',
  'appointment',
  'meeting',
  'calendar',
  'schedule',
])

function queryWords(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((word) => !queryNoiseWords.has(word))
}

function eventMatchScore(event: EventSummary, words: string[]) {
  if (!words.length) return 0
  const haystack = [event.title, event.location, event.description].join(' ').toLowerCase()
  return words.reduce((score, word) => (haystack.includes(word) ? score + 1 : score), 0)
}

function sortEventsByStart<T extends { start: string }>(events: T[]) {
  return [...events].sort((left, right) => {
    return new Date(left.start).getTime() - new Date(right.start).getTime()
  })
}

function uniqueEvents(events: EventSummary[]) {
  const seen = new Set<string>()
  return events.filter((event) => {
    const key = `${event.id}:${event.start}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function matchingEventsByQuery(events: EventSummary[], query: string) {
  const words = queryWords(query)
  if (!words.length) return []

  const scored = events
    .map((event) => ({
      event,
      score: eventMatchScore(event, words),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      return new Date(left.event.start).getTime() - new Date(right.event.start).getTime()
    })

  return scored.map((item) => item.event)
}

function bestEventByQuery(events: EventSummary[], query: string) {
  const matches = matchingEventsByQuery(events, query)
  if (!matches.length) return null
  if (matches.length === 1) return matches[0]

  const words = queryWords(query)
  const topScore = eventMatchScore(matches[0], words)
  const topMatches = matches.filter((event) => eventMatchScore(event, words) === topScore)
  return topMatches.length === 1 ? topMatches[0] : null
}

function inviteeSummary(invitees: Invitee[]) {
  return invitees.map((invitee) => inviteeLabel(invitee)).join(', ')
}

function unresolvedInviteeSummary(names: string[]) {
  return names.join(', ')
}

async function resolveScheduleInvitees(profileId: string, body: string) {
  const parsed = parseInviteesFromText(body)
  const resolvedInvitees = [...parsed.directInvitees]
  const unresolvedNames: string[] = []

  for (const name of parsed.names) {
    const match = await findPersonContact(profileId, name)
    if (match) {
      resolvedInvitees.push({
        email: match.email,
        displayName: match.label,
      })
    } else {
      unresolvedNames.push(name)
    }
  }

  const dedupedInvitees = resolvedInvitees.filter((invitee, index, list) => {
    return list.findIndex((item) => item.email.toLowerCase() === invitee.email.toLowerCase()) === index
  })

  return {
    cleanedText: parsed.cleanedText,
    invitees: dedupedInvitees,
    unresolvedNames,
  }
}

function findEventByQuery(events: EventSummary[], query: string) {
  return bestEventByQuery(events, query)
}

function agendaDayForBaseDate(baseDate: Date) {
  return baseDate.toDateString() === startOfDay(0).toDateString() ? 'today' : 'tomorrow'
}

async function searchUpcomingEvents(profileId: string) {
  return listUpcomingEvents({
    profileId,
    startAt: startOfDay(0),
    windowMinutes: 14 * 24 * 60,
    maxResults: 30,
  })
}

async function profileForPhone(phoneE164: string) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id,email,phone_e164,timezone,phone_confirmed_at,sms_opted_out_at')
    .eq('phone_e164', phoneE164)
    .maybeSingle<{
      id: string
      email: string
      phone_e164: string
      timezone: string
      phone_confirmed_at: string | null
      sms_opted_out_at: string | null
    }>()

  if (error) throw error
  if (!profile) return null

  if (!profile.phone_confirmed_at) {
    await supabaseAdmin
      .from('profiles')
      .update({
        phone_confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', profile.id)
  }

  const { data: subscription, error: subscriptionError } = await supabaseAdmin
    .from('subscriptions')
    .select('status')
    .eq('profile_id', profile.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ status: string }>()

  if (subscriptionError) throw subscriptionError

  return {
    ...profile,
    subscriptionStatus: subscription?.status || 'missing',
  } satisfies SmsProfile
}

async function logSms({
  profileId,
  from,
  body,
  direction,
  twilioMessageSid,
}: {
  profileId?: string
  from: string
  body: string
  direction: 'inbound' | 'outbound'
  twilioMessageSid?: string
}) {
  await supabaseAdmin.from('sms_messages').insert({
    profile_id: profileId || null,
    from_e164: from,
    body,
    direction,
    twilio_message_sid: twilioMessageSid || null,
  })
}

async function loadPendingAction(
  profileId: string,
  smsFrom: string,
  options?: { excludeKinds?: PendingKind[]; onlyKind?: PendingKind },
) {
  let query = supabaseAdmin
    .from('pending_actions')
    .select('id,kind,payload')
    .eq('profile_id', profileId)
    .eq('sms_from', smsFrom)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)

  if (options?.onlyKind) {
    query = query.eq('kind', options.onlyKind)
  }

  if (options?.excludeKinds?.length) {
    query = query.not('kind', 'in', `(${options.excludeKinds.join(',')})`)
  }

  const { data, error } = await query.maybeSingle<PendingAction>()

  if (error) throw error
  return data
}

async function storePendingAction({
  profileId,
  smsFrom,
  kind,
  payload,
}: {
  profileId: string
  smsFrom: string
  kind: PendingKind
  payload: PendingPayload
}) {
  let supersede = supabaseAdmin
    .from('pending_actions')
    .update({ status: 'superseded' })
    .eq('profile_id', profileId)
    .eq('sms_from', smsFrom)
    .eq('status', 'pending')

  if (backgroundPendingKinds.includes(kind)) {
    supersede = supersede.eq('kind', kind)
  } else {
    supersede = supersede.not('kind', 'in', `(${backgroundPendingKinds.join(',')})`)
  }

  await supersede

  const expiresAt = new Date(Date.now() + 20 * 60_000).toISOString()
  const { error } = await supabaseAdmin.from('pending_actions').insert({
    profile_id: profileId,
    sms_from: smsFrom,
    kind,
    payload,
    expires_at: expiresAt,
    status: 'pending',
  })

  if (error) throw error
}

async function clearPendingAction(id: string) {
  const { error } = await supabaseAdmin
    .from('pending_actions')
    .update({ status: 'completed' })
    .eq('id', id)

  if (error) throw error
}

async function markSmsOptOut(profileId: string, optedOut: boolean) {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      sms_opted_out_at: optedOut ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profileId)

  if (error) throw error
}

async function clearPendingRemindersForEvent(profileId: string, calendarEventId?: string | null) {
  if (!calendarEventId) return

  const { error } = await supabaseAdmin
    .from('reminders')
    .update({
      status: 'canceled',
      updated_at: new Date().toISOString(),
    })
    .eq('profile_id', profileId)
    .eq('calendar_event_id', calendarEventId)
    .eq('status', 'pending')

  if (error) throw error
}

async function queueReminderForEvent({
  profileId,
  phoneE164,
  calendarEventId,
  calendarId,
  title,
  start,
  leadMinutes = 30,
}: {
  profileId: string
  phoneE164: string
  calendarEventId?: string | null
  calendarId?: string | null
  title: string
  start: string
  leadMinutes?: number
}) {
  const startsAt = new Date(start)
  if (Number.isNaN(startsAt.getTime())) return

  const dueAt = new Date(startsAt.getTime() - leadMinutes * 60_000)
  if (dueAt.getTime() <= Date.now()) return

  await clearPendingRemindersForEvent(profileId, calendarEventId)
  const { error } = await supabaseAdmin.from('reminders').insert({
    profile_id: profileId,
    phone_e164: phoneE164,
    calendar_event_id: calendarEventId || null,
    calendar_id: calendarId || null,
    event_starts_at: startsAt.toISOString(),
    due_at: dueAt.toISOString(),
    body: `Reminder: ${title} starts at ${formatSmsTime(startsAt)}.`,
    status: 'pending',
  })

  if (error) throw error
}

async function maybeQueueReminderForOption({
  profile,
  option,
  calendarEventId,
  calendarId,
  title,
  leadMinutes,
}: {
  profile: SmsProfile
  option: ScheduleOption
  calendarEventId?: string | null
  calendarId?: string | null
  title?: string
  leadMinutes?: number
}) {
  if (option.recurrence) return

  await queueReminderForEvent({
    profileId: profile.id,
    phoneE164: profile.phone_e164,
    calendarEventId: calendarEventId || null,
    calendarId: calendarId || option.calendarId,
    title: title || option.title,
    start: option.start,
    leadMinutes,
  })
}

async function classifyTargetEvent(
  profile: SmsProfile,
  target: EventSummary,
): Promise<{ authority: EventAuthority; contact: BusinessContact | null }> {
  const contact = await inferBusinessContact({
    profileId: profile.id,
    query: target.title,
    location: target.location,
    description: target.description,
  })

  return {
    authority: classifyEventAuthority({
      event: target,
      profileEmail: profile.email,
      businessContact: contact,
    }),
    contact,
  }
}

async function prepareExternalCallPrep({
  profile,
  smsFrom,
  target,
  baseDate,
  exactTime,
  contact,
}: {
  profile: SmsProfile
  smsFrom: string
  target: EventSummary
  baseDate: Date
  exactTime: { hour: number; minute: number } | null
  contact?: BusinessContact | null
}) {
  const inferredContact =
    contact ||
    (await inferBusinessContact({
      profileId: profile.id,
      query: target.title,
      location: target.location,
      description: target.description,
    }))

  const businessName = inferredContact?.label || target.title
  const options = await findScheduleOptions({
    profileId: profile.id,
    title: `Call ${businessName} to reschedule`,
    baseDate,
    exactTime,
    calendarHint: 'Personal',
    durationMinutes: 20,
  })

  if (!options.length) {
    return `I found ${target.title}, but I could not find a good time for the call. Try another day or time.`
  }

  const callNote = buildCallNote(target, options)
  await storePendingAction({
    profileId: profile.id,
    smsFrom,
    kind: 'external_call_prep',
    payload: {
      target,
      options,
      businessName,
      phoneE164: inferredContact?.phone_e164 || null,
      callNote,
      requestedBaseDate: baseDate.toISOString(),
      exactTime,
      authority: 'external_appointment',
    },
  })

  let reply = `I can't change ${target.title} with the office by text, but I can get you ready to call.\nHere are your next openings:\n${callPrepOptionList(options)}\nReply 1, 2, or 3 and I'll hold that time for your call.`

  if (inferredContact?.phone_e164) {
    reply += `\nOffice number: ${inferredContact.phone_e164}.`
  }

  reply += `\nCall note: ${callNote}`
  return reply
}

async function prepareInvitedReschedule({
  profile,
  smsFrom,
  target,
  baseDate,
  exactTime,
}: {
  profile: SmsProfile
  smsFrom: string
  target: EventSummary
  baseDate: Date
  exactTime: { hour: number; minute: number } | null
}) {
  await storePendingAction({
    profileId: profile.id,
    smsFrom,
    kind: 'invited_reschedule_action',
    payload: {
      target,
      requestedBaseDate: baseDate.toISOString(),
      exactTime,
      authority: 'invited_meeting',
    },
  })

  return `I can't move ${target.title} for everyone from your side.\nDo you want me to:\n1. Hold a new time on my calendar only\n2. Draft a message to the organizer\n3. Keep it and add a reminder`
}

async function prepareInvitedCancel({
  profileId,
  smsFrom,
  target,
}: {
  profileId: string
  smsFrom: string
  target: EventSummary
}) {
  await storePendingAction({
    profileId,
    smsFrom,
    kind: 'invited_cancel_action',
    payload: {
      target,
      authority: 'invited_meeting',
    },
  })

  return `I can't cancel ${target.title} for everyone from your side.\nDo you want me to:\n1. Remove it from my calendar only\n2. Draft a decline message\n3. Keep it`
}

async function prepareRecurringRescheduleScope({
  profileId,
  smsFrom,
  target,
  authority,
  baseDate,
  exactTime,
}: {
  profileId: string
  smsFrom: string
  target: EventSummary
  authority: EventAuthority
  baseDate: Date
  exactTime: { hour: number; minute: number } | null
}) {
  await storePendingAction({
    profileId,
    smsFrom,
    kind: 'reschedule',
    payload: {
      target,
      authority,
      requestedBaseDate: baseDate.toISOString(),
      exactTime,
      stage: 'scope',
    },
  })

  return recurringReschedulePrompt(target)
}

async function prepareRecurringCancelScope({
  profileId,
  smsFrom,
  target,
  authority,
}: {
  profileId: string
  smsFrom: string
  target: EventSummary
  authority: EventAuthority
}) {
  await storePendingAction({
    profileId,
    smsFrom,
    kind: 'invited_cancel_action',
    payload: {
      target,
      authority,
      stage: 'scope',
    },
  })

  return recurringCancelPrompt(target)
}

async function handleSaveBusinessPhoneReply({
  profile,
  from,
  body,
  pending,
}: {
  profile: SmsProfile
  from: string
  body: string
  pending: PendingAction
}) {
  const lower = body.trim().toLowerCase()
  if (lower === 'skip') {
    await clearPendingAction(pending.id)
    return 'Okay. I will not save a business number yet.'
  }

  const phone = extractPhoneFromText(body)
  if (!phone) {
    return "Reply with the office phone number, or send SKIP if you don't want to save it yet."
  }

  const businessName = pending.payload.businessName || pending.payload.target?.title || 'Office'
  const aliases = buildBusinessAliases([
    businessName,
    pending.payload.target?.title,
    pending.payload.target?.location,
  ])

  await saveOrUpdateBusinessContact({
    profileId: profile.id,
    label: businessName,
    phoneE164: phone,
    category: looksExternalAppointment(pending.payload.target || ({
      title: businessName,
      location: '',
      description: '',
      start: '',
      end: '',
      id: '',
      calendarId: '',
      calendarName: '',
      timeLabel: '',
      organizerEmail: '',
      attendeeCount: 0,
    } as EventSummary))
      ? 'appointment'
      : 'business',
    notes: 'Saved by SMS during external appointment flow',
    aliases,
  })

  if (pending.payload.followUpKind === 'external_cancel_confirm') {
    await storePendingAction({
      profileId: profile.id,
      smsFrom: from,
      kind: 'external_cancel_confirm',
      payload: {
        target: pending.payload.target,
        businessName,
        phoneE164: phone,
        callNote: pending.payload.callNote,
        authority: 'external_appointment',
      },
    })
    await clearPendingAction(pending.id)
    return `Saved ${businessName} as ${phone} for next time.\nWhen the office confirms the cancellation, text something like "I called and canceled it" and I'll clear it from your calendar.`
  }

  if (pending.payload.followUpKind === 'external_reschedule_confirm') {
    await storePendingAction({
      profileId: profile.id,
      smsFrom: from,
      kind: 'external_reschedule_confirm',
      payload: {
        target: pending.payload.target,
        businessName,
        phoneE164: phone,
        callNote: pending.payload.callNote,
        authority: 'external_appointment',
        holdEventId: pending.payload.holdEventId || null,
        holdCalendarId: pending.payload.holdCalendarId || null,
      },
    })
    await clearPendingAction(pending.id)
    return `Saved ${businessName} as ${phone} for next time.\nWhen the office confirms the new time, text something like "They moved it to Tuesday at 2pm" and I'll update your calendar.\nYou can keep texting me other things in the meantime.`
  }

  await clearPendingAction(pending.id)

  return `Saved ${businessName} as ${phone} for next time.`
}

async function handleResolveInviteesReply({
  profile,
  from,
  body,
  pending,
}: {
  profile: SmsProfile
  from: string
  body: string
  pending: PendingAction
}) {
  const option = pending.payload.selectedOption
  if (!option) {
    return 'Send the scheduling request again and I will set it up.'
  }

  const lower = body.trim().toLowerCase()
  const existingInvitees = pending.payload.attendees || []
  const unresolvedNames = pending.payload.unresolvedInvitees || []

  if (
    /\b(skip|just book it|book it anyway|without invites|without invite|no invites|dont invite|don't invite)\b/.test(
      lower,
    )
  ) {
    const created = await createCalendarEvent(profile.id, {
      ...option,
      attendees: existingInvitees,
    })
    await maybeQueueReminderForOption({
      profile,
      option,
      calendarEventId: created.id || null,
      calendarId: option.calendarId,
      title: option.title,
    })
    await clearPendingAction(pending.id)

    if (existingInvitees.length) {
      return `${bookingText(option)}\nI invited ${inviteeSummary(existingInvitees)}.\nI did not invite ${unresolvedInviteeSummary(unresolvedNames)} yet.`
    }

    return `${bookingText(option)}\nI did not invite ${unresolvedInviteeSummary(unresolvedNames)} because I still need their email.`
  }

  const resolution = resolveInviteeFollowUp(body, unresolvedNames)
  if (!resolution.resolved.length) {
    return `I still need email${unresolvedNames.length > 1 ? 's' : ''} for ${unresolvedInviteeSummary(
      unresolvedNames,
    )}.\nReply like "Sam sam@company.com, Priya priya@company.com" or say "book it without invites."`
  }

  for (const invitee of resolution.resolved) {
    if (!invitee.displayName) continue
    await saveOrUpdatePersonContact({
      profileId: profile.id,
      label: invitee.displayName,
      email: invitee.email,
      aliases: buildPersonAliases([invitee.displayName, invitee.email]),
    })
  }

  const mergedInvitees = [...existingInvitees]
  for (const invitee of resolution.resolved) {
    if (mergedInvitees.some((item) => item.email.toLowerCase() === invitee.email.toLowerCase())) {
      continue
    }
    mergedInvitees.push(invitee)
  }

  if (resolution.unresolvedNames.length) {
    await storePendingAction({
      profileId: profile.id,
      smsFrom: from,
      kind: 'resolve_invitees',
      payload: {
        selectedOption: option,
        attendees: mergedInvitees,
        unresolvedInvitees: resolution.unresolvedNames,
      },
    })

    return `Got ${inviteeSummary(resolution.resolved)}.\nI still need email${
      resolution.unresolvedNames.length > 1 ? 's' : ''
    } for ${unresolvedInviteeSummary(resolution.unresolvedNames)}.`
  }

  const created = await createCalendarEvent(profile.id, {
    ...option,
    attendees: mergedInvitees,
  })
  await maybeQueueReminderForOption({
    profile,
    option,
    calendarEventId: created.id || null,
    calendarId: option.calendarId,
    title: option.title,
  })
  await clearPendingAction(pending.id)

  return `${bookingText(option)}\nI invited ${inviteeSummary(mergedInvitees)}.`
}

async function handleChoice({
  profile,
  smsFrom,
  choice,
  pending,
}: {
  profile: SmsProfile
  smsFrom: string
  choice: number
  pending: PendingAction
}) {
  if (pending.kind === 'schedule') {
    const option = choose(pending.payload.options, choice)
    if (!option) return 'Reply with 1, 2, or 3.'

    const attendees = pending.payload.attendees || []
    const unresolvedInvitees = pending.payload.unresolvedInvitees || []

    if (unresolvedInvitees.length) {
      await storePendingAction({
        profileId: profile.id,
        smsFrom,
        kind: 'resolve_invitees',
        payload: {
          selectedOption: option,
          attendees,
          unresolvedInvitees,
        },
      })

      return `I can send the invite, but I still need email${
        unresolvedInvitees.length > 1 ? 's' : ''
      } for ${unresolvedInviteeSummary(unresolvedInvitees)}.\nReply like "Sam sam@company.com" or say "book it without invites."`
    }

    const created = await createCalendarEvent(profile.id, {
      ...option,
      attendees,
    })
    await maybeQueueReminderForOption({
      profile,
      option,
      calendarEventId: created.id || null,
      calendarId: option.calendarId,
      title: option.title,
    })
    await clearPendingAction(pending.id)

    if (attendees.length) {
      return `${bookingText(option)}\nI invited ${inviteeSummary(attendees)} and I'll remind you before it starts.`
    }

    return `${bookingText(option)}\nI'll remind you before it starts.`
  }

  if (pending.kind === 'select_reschedule_target') {
    const event = choose(pending.payload.events, choice)
    if (!event) return 'Reply with 1, 2, or 3 for the meeting you want to move.'

    const { authority, contact } = await classifyTargetEvent(profile, event)

    if (authority === 'external_appointment') {
      return prepareExternalCallPrep({
        profile,
        smsFrom,
        target: event,
        baseDate: new Date(Date.now() + 24 * 60 * 60_000),
        exactTime: null,
        contact,
      })
    }

    if (authority === 'invited_meeting' || authority === 'unknown') {
      return prepareInvitedReschedule({
        profile,
        smsFrom,
        target: event,
        baseDate: new Date(Date.now() + 24 * 60 * 60_000),
        exactTime: null,
      })
    }

    if (isRecurringEvent(event)) {
      return prepareRecurringRescheduleScope({
        profileId: profile.id,
        smsFrom,
        target: event,
        authority,
        baseDate: new Date(Date.now() + 24 * 60 * 60_000),
        exactTime: null,
      })
    }

    const options = await findScheduleOptions({
      profileId: profile.id,
      title: event.title,
      baseDate: new Date(Date.now() + 24 * 60 * 60_000),
      exactTime: null,
      calendarHint: event.calendarName,
      durationMinutes: eventDurationMinutes(event),
    })

    if (!options.length) {
      return `I found ${event.title}, but I could not find an opening to move it. Try another day or time.`
    }

    await storePendingAction({
      profileId: profile.id,
      smsFrom,
      kind: 'reschedule',
      payload: { target: event, options, authority },
    })

    return `I can move ${event.title} to one of these:\n${optionList(options)}\nReply 1, 2, or 3.`
  }

  if (pending.kind === 'reschedule') {
    const target = pending.payload.target
    if (!target) return 'Reply with 1, 2, or 3.'

    if (pending.payload.stage === 'scope') {
      if (choice === 1) {
        const baseDate = pending.payload.requestedBaseDate
          ? new Date(pending.payload.requestedBaseDate)
          : new Date(Date.now() + 24 * 60 * 60_000)

        const options = await findScheduleOptions({
          profileId: profile.id,
          title: target.title,
          baseDate,
          exactTime: pending.payload.exactTime || null,
          calendarHint: target.calendarName,
          durationMinutes: eventDurationMinutes(target),
        })

        if (!options.length) {
          return `I found ${target.title}, but I could not find an opening to move it. Try another day or time.`
        }

        await storePendingAction({
          profileId: profile.id,
          smsFrom,
          kind: 'reschedule',
          payload: {
            target,
            options,
            authority: pending.payload.authority,
            stage: 'options',
            scope: 'single',
          },
        })

        return `I can move just this ${target.title} to:\n${optionList(options)}\nReply 1, 2, or 3.`
      }

      if (choice === 2) {
        const series = await loadSeriesMaster(profile.id, target)
        if (!series?.seriesTarget || !series.recurrence) {
          return `I can move just this occurrence by text, but ${target.title} uses a custom repeat pattern I can't safely change yet.\nReply 1 if you want to move just this one, or 3 to keep it as is.`
        }

        const baseDate = pending.payload.requestedBaseDate
          ? new Date(pending.payload.requestedBaseDate)
          : new Date(Date.now() + 24 * 60 * 60_000)

        const options = await findScheduleOptions({
          profileId: profile.id,
          title: series.seriesTarget.title,
          baseDate,
          exactTime: pending.payload.exactTime || null,
          calendarHint: series.seriesTarget.calendarName,
          durationMinutes: eventDurationMinutes(series.seriesTarget),
          recurrence: series.recurrence,
        })

        if (!options.length) {
          return `I found ${target.title}, but I could not find an opening to move the whole series. Try another day or time.`
        }

        await storePendingAction({
          profileId: profile.id,
          smsFrom,
          kind: 'reschedule',
          payload: {
            target,
            seriesTarget: series.seriesTarget,
            recurrence: series.recurrence,
            options,
            authority: pending.payload.authority,
            stage: 'options',
            scope: 'series',
          },
        })

        let reply = `I can move the whole series to:\n${optionList(options)}\nReply 1, 2, or 3.`
        const recurring = recurrenceLine(options)
        if (recurring) {
          reply += `\n${recurring}`
        }
        return reply
      }

      if (choice === 3) {
        await clearPendingAction(pending.id)
        return `Okay. I left ${target.title} where it is.`
      }

      return 'Reply with 1, 2, or 3.'
    }

    const option = choose(pending.payload.options, choice)
    if (!option || !target) return 'Reply with 1, 2, or 3.'

    const sendUpdates = pending.payload.authority === 'owned_meeting' ? 'all' : 'none'
    if (pending.payload.scope === 'series' && pending.payload.seriesTarget && pending.payload.recurrence) {
      await updateCalendarEvent(
        profile.id,
        pending.payload.seriesTarget.id,
        {
          ...option,
          title: pending.payload.seriesTarget.title,
          calendarId: pending.payload.seriesTarget.calendarId,
          calendarName: pending.payload.seriesTarget.calendarName,
          recurrence: pending.payload.recurrence,
        },
        sendUpdates,
      )
      await clearPendingRemindersForEvent(profile.id, target.id)
      await clearPendingRemindersForEvent(profile.id, pending.payload.seriesTarget.id)
      await clearPendingAction(pending.id)

      if (pending.payload.authority === 'owned_meeting') {
        return `Moved the whole ${target.title} series to ${option.dayLabel} at ${option.timeLabel} and sent the update.`
      }

      return `Moved the whole ${target.title} series to ${option.dayLabel} at ${option.timeLabel}.`
    }

    await updateCalendarEvent(profile.id, target.id, option, sendUpdates)
    await maybeQueueReminderForOption({
      profile,
      option,
      calendarEventId: target.id,
      calendarId: target.calendarId,
      title: option.title,
    })
    await clearPendingAction(pending.id)

    if (pending.payload.authority === 'owned_meeting') {
      return `Moved ${target.title} to ${option.dayLabel} at ${option.timeLabel} and sent the update.`
    }

    return `Moved ${target.title} to ${option.dayLabel} at ${option.timeLabel}.`
  }

  if (pending.kind === 'invited_reschedule_action') {
    const target = pending.payload.target
    if (!target) return 'Send the request again and I will pick it up.'

    if (choice === 1) {
      const baseDate = pending.payload.requestedBaseDate
        ? new Date(pending.payload.requestedBaseDate)
        : new Date(Date.now() + 24 * 60 * 60_000)

      const options = await findScheduleOptions({
        profileId: profile.id,
        title: `Tentative: ${target.title}`,
        baseDate,
        exactTime: pending.payload.exactTime || null,
        calendarHint: 'Personal',
        durationMinutes: eventDurationMinutes(target),
      })

      if (!options.length) {
        return `I could not find a clean hold time for ${target.title}. Try another day or time.`
      }

      await storePendingAction({
        profileId: profile.id,
        smsFrom,
        kind: 'invited_reschedule_hold',
        payload: {
          target,
          options,
          authority: 'invited_meeting',
        },
      })

      return `I can hold one of these times on your calendar while you coordinate with the organizer:\n${optionList(options)}\nReply 1, 2, or 3.`
    }

    if (choice === 2) {
      const baseDate = pending.payload.requestedBaseDate
        ? new Date(pending.payload.requestedBaseDate)
        : new Date(Date.now() + 24 * 60 * 60_000)
      const options = await findScheduleOptions({
        profileId: profile.id,
        title: target.title,
        baseDate,
        exactTime: pending.payload.exactTime || null,
        calendarHint: target.calendarName,
        durationMinutes: eventDurationMinutes(target),
      })
      await clearPendingAction(pending.id)
      return buildOrganizerRescheduleDraft(target, options.slice(0, 3))
    }

    if (choice === 3) {
      await queueReminderForEvent({
        profileId: profile.id,
        phoneE164: profile.phone_e164,
        calendarEventId: target.id,
        calendarId: target.calendarId,
        title: target.title,
        start: target.start,
      })
      await clearPendingAction(pending.id)
      return `Okay. I left ${target.title} alone and will remind you before it starts.`
    }

    return 'Reply with 1, 2, or 3.'
  }

  if (pending.kind === 'invited_reschedule_hold') {
    const option = choose(pending.payload.options, choice)
    const target = pending.payload.target
    if (!option || !target) return 'Reply with 1, 2, or 3.'

    const created = await createCalendarEvent(profile.id, option)
    await maybeQueueReminderForOption({
      profile,
      option,
      calendarEventId: created.id || null,
      calendarId: option.calendarId,
      title: option.title,
      leadMinutes: 15,
    })
    await clearPendingAction(pending.id)

    return `Held ${option.dayLabel} at ${option.timeLabel} on your calendar for ${target.title}. The organizer still needs to confirm the real meeting move.`
  }

  if (pending.kind === 'invited_cancel_action') {
    const target = pending.payload.target
    if (!target) return 'Send the cancel request again and I will pick it up.'

    if (pending.payload.stage === 'scope') {
      const sendUpdates = pending.payload.authority === 'owned_meeting' ? 'all' : 'none'

      if (choice === 1) {
        await deleteCalendarEvent(profile.id, target.id, target.calendarId, sendUpdates)
        await clearPendingRemindersForEvent(profile.id, target.id)
        await clearPendingAction(pending.id)
        return pending.payload.authority === 'owned_meeting'
          ? `Canceled this ${target.title} occurrence and sent the update.`
          : `Canceled just this ${target.title} occurrence.`
      }

      if (choice === 2) {
        const series = await loadSeriesMaster(profile.id, target)
        const seriesTarget = series?.seriesTarget
        if (!seriesTarget) {
          return `I couldn't find the full ${target.title} series right now.\nReply 1 if you want to cancel just this occurrence, or 3 to keep it.`
        }

        await deleteCalendarEvent(profile.id, seriesTarget.id, seriesTarget.calendarId, sendUpdates)
        await clearPendingRemindersForEvent(profile.id, target.id)
        await clearPendingRemindersForEvent(profile.id, seriesTarget.id)
        await clearPendingAction(pending.id)
        return pending.payload.authority === 'owned_meeting'
          ? `Canceled the whole ${target.title} series and sent the update.`
          : `Canceled the whole ${target.title} series.`
      }

      if (choice === 3) {
        await clearPendingAction(pending.id)
        return `Okay. I left ${target.title} on your calendar.`
      }

      return 'Reply with 1, 2, or 3.'
    }

    if (choice === 1) {
      await deleteCalendarEvent(profile.id, target.id, target.calendarId, 'none')
      await clearPendingRemindersForEvent(profile.id, target.id)
      await clearPendingAction(pending.id)
      return `Removed ${target.title} from your calendar. I did not cancel it for everyone.`
    }

    if (choice === 2) {
      await clearPendingAction(pending.id)
      return buildOrganizerCancelDraft(target)
    }

    if (choice === 3) {
      await clearPendingAction(pending.id)
      return `Okay. I left ${target.title} on your calendar.`
    }

    return 'Reply with 1, 2, or 3.'
  }

  if (pending.kind === 'external_call_prep') {
    const option = choose(pending.payload.options, choice)
    const target = pending.payload.target
    if (!option || !target) return 'Reply with 1, 2, or 3.'

    const created = await createCalendarEvent(profile.id, option)
    await maybeQueueReminderForOption({
      profile,
      option,
      calendarEventId: created.id || null,
      calendarId: option.calendarId,
      title: option.title,
      leadMinutes: 15,
    })

    const businessName = pending.payload.businessName || target.title
    const callNote = pending.payload.callNote || buildCallNote(target, [option])
    const knownPhone = pending.payload.phoneE164 || null

    if (knownPhone) {
      await clearPendingAction(pending.id)
      await storePendingAction({
        profileId: profile.id,
        smsFrom,
        kind: 'external_reschedule_confirm',
        payload: {
          target,
          businessName,
          phoneE164: knownPhone,
          callNote,
          authority: 'external_appointment',
          holdEventId: created.id || null,
          holdCalendarId: option.calendarId,
        },
      })
      return `Held ${option.dayLabel} at ${option.timeLabel} for your call about ${target.title}.\nOffice number: ${knownPhone}.\nCall note: ${callNote}\nWhen the office confirms the new time, text something like "They moved it to Tuesday at 2pm" and I'll update your calendar.\nYou can keep texting me other things in the meantime.`
    }

    await storePendingAction({
      profileId: profile.id,
      smsFrom,
      kind: 'save_business_contact_phone',
      payload: {
        target,
        businessName,
        callNote,
        authority: 'external_appointment',
        followUpKind: 'external_reschedule_confirm',
        holdEventId: created.id || null,
        holdCalendarId: option.calendarId,
      },
    })

    return `Held ${option.dayLabel} at ${option.timeLabel} for your call about ${target.title}.\nI don't have the office number yet. Reply with it and I'll save it for next time.\nCall note: ${callNote}\nWhen the office confirms the new time, text something like "They moved it to Tuesday at 2pm" and I'll update your calendar.`
  }

  if (pending.kind === 'save_business_contact_phone') {
    return "Reply with the office phone number, or send SKIP if you don't want to save it yet."
  }

  return 'I lost track of that request. Send it again?'
}

export async function handleIncomingSms({
  from,
  body,
  twilioMessageSid,
}: {
  from: string
  body: string
  twilioMessageSid?: string
}) {
  const profile = await profileForPhone(from)
  await logSms({ profileId: profile?.id, from, body, direction: 'inbound', twilioMessageSid })

  const lowerBody = body.trim().toLowerCase()

  if (stopWords.has(lowerBody)) {
    if (profile) {
      await markSmsOptOut(profile.id, true)
    }
    const reply = "You won't receive Manoa texts anymore. Reply START to turn them back on."
    await logSms({ profileId: profile?.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (startWords.has(lowerBody)) {
    if (!profile) {
      const reply = "I don't recognize this number yet. Sign up for Manoa first, then text START from this phone."
      await logSms({ from, body: reply, direction: 'outbound' })
      return reply
    }

    await markSmsOptOut(profile.id, false)
    const reply = 'Manoa texts are back on.'
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (lowerBody === 'help') {
    const reply = profile
      ? 'Manoa can schedule, reschedule, cancel, and send your agenda. Reply STOP to opt out or START to opt back in.'
      : 'Sign up for Manoa first, then text this number from your saved phone.'
    await logSms({ profileId: profile?.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (!profile) {
    const reply = "I don't recognize this number yet. Sign up for Manoa first, then text START from this phone."
    await logSms({ from, body: reply, direction: 'outbound' })
    return reply
  }

  if (profile.sms_opted_out_at) {
    const reply = 'You are currently opted out. Reply START to turn Manoa texts back on.'
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (!activeSubscriptionStatuses.has(profile.subscriptionStatus)) {
    const reply = 'Your Manoa subscription is not active yet. Finish checkout, then text me again.'
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (!(await hasGoogleCalendar(profile.id))) {
    const reply = 'Your subscription is active. Connect Google Calendar from your signup success page, then text me again.'
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  const externalCancelPending = await loadPendingAction(profile.id, from, {
    onlyKind: 'external_cancel_confirm',
  })
  if (
    externalCancelPending?.payload.target &&
    confirmsExternalCancellation(
      body,
      externalCancelPending.payload.target,
      externalCancelPending.payload.businessName,
    )
  ) {
    const target = externalCancelPending.payload.target
    await deleteCalendarEvent(profile.id, target.id, target.calendarId, 'none')
    await clearPendingRemindersForEvent(profile.id, target.id)
    await clearPendingAction(externalCancelPending.id)
    const reply = `Removed ${target.title} from your calendar.\nIf you want, I can help you add a follow-up appointment next.`
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (
    externalCancelPending?.payload.target &&
    mentionsOfficeDelay(
      body,
      externalCancelPending.payload.target,
      externalCancelPending.payload.businessName,
    )
  ) {
    const target = externalCancelPending.payload.target
    const reply = `Okay. I left ${target.title} on your calendar.\nWhen the office confirms the cancellation, text me and I'll clear it.`
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  const externalReschedulePending = await loadPendingAction(profile.id, from, {
    onlyKind: 'external_reschedule_confirm',
  })
  if (externalReschedulePending?.payload.target) {
    if (
      mentionsOfficeDelay(
        body,
        externalReschedulePending.payload.target,
        externalReschedulePending.payload.businessName,
      ) ||
      mentionsFailedExternalReschedule(
        body,
        externalReschedulePending.payload.target,
        externalReschedulePending.payload.businessName,
      )
    ) {
      const target = externalReschedulePending.payload.target
      if (externalReschedulePending.payload.holdEventId) {
        await deleteCalendarEvent(
          profile.id,
          externalReschedulePending.payload.holdEventId,
          externalReschedulePending.payload.holdCalendarId || target.calendarId,
          'none',
        )
        await clearPendingRemindersForEvent(profile.id, externalReschedulePending.payload.holdEventId)
      }

      const reply = mentionsFailedExternalReschedule(
        body,
        externalReschedulePending.payload.target,
        externalReschedulePending.payload.businessName,
      )
        ? `Okay. I cleared the temporary call hold and left ${target.title} where it was.\nIf the office offers another time later, text me the new day and time and I'll update your calendar.`
        : `Okay. I cleared the temporary call hold and left ${target.title} where it was.\nWhen the office gets back to you with a new time, text me and I'll update your calendar.`
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    const followUp = parseExternalRescheduleConfirmation(
      body,
      externalReschedulePending.payload.target,
      externalReschedulePending.payload.businessName,
    )

    if (followUp.kind === 'confirmed_reschedule') {
      const target = externalReschedulePending.payload.target
      const option = optionFromExactExternalTime(target, followUp.baseDate, followUp.exactTime)
      await updateCalendarEvent(profile.id, target.id, option, 'none')
      await queueReminderForEvent({
        profileId: profile.id,
        phoneE164: profile.phone_e164,
        calendarEventId: target.id,
        calendarId: target.calendarId,
        title: target.title,
        start: option.start,
      })

      if (externalReschedulePending.payload.holdEventId) {
        await deleteCalendarEvent(
          profile.id,
          externalReschedulePending.payload.holdEventId,
          externalReschedulePending.payload.holdCalendarId || option.calendarId,
          'none',
        )
        await clearPendingRemindersForEvent(profile.id, externalReschedulePending.payload.holdEventId)
      }

      await clearPendingAction(externalReschedulePending.id)
      const reply = `Updated ${target.title} to ${option.dayLabel} at ${option.timeLabel} on your calendar.\nI also cleared the call hold.`
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    if (followUp.kind === 'needs_details') {
      const target = externalReschedulePending.payload.target
      const reply = `Tell me the new day and time the office confirmed for ${target.title}, like "They moved it to Tuesday at 2pm."`
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }
  }

  const pending = await loadPendingAction(profile.id, from, {
    excludeKinds: backgroundPendingKinds,
  })
  if (pending?.kind === 'save_business_contact_phone') {
    const reply = await handleSaveBusinessPhoneReply({ profile, from, body, pending })
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (pending?.kind === 'resolve_invitees') {
    const reply = await handleResolveInviteesReply({ profile, from, body, pending })
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (pending && isShortAcknowledgement(body)) {
    const reply = reminderForPending(pending)
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  const intent = (await parseSmsIntentWithAI(body)) || parseSmsIntent(body)
  const pendingChoice = pending ? resolvePendingChoice(body, pending) : null

  if (pending && (intent.type === 'choice' || pendingChoice)) {
    const reply = await handleChoice({
      profile,
      smsFrom: from,
      choice: intent.type === 'choice' ? intent.choice : (pendingChoice as number),
      pending,
    })
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (intent.type === 'agenda') {
    const events = await listAgenda(profile.id, intent.day)
    const reply = agendaText(intent.day, events)
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (intent.type === 'schedule') {
    const inviteeContext = await resolveScheduleInvitees(profile.id, body)
    const cleanedIntent =
      inviteeContext.cleanedText && inviteeContext.cleanedText !== body
        ? parseSmsIntent(inviteeContext.cleanedText)
        : intent
    const scheduleIntent =
      cleanedIntent.type === 'schedule'
        ? cleanedIntent
        : intent

    const options = await findScheduleOptions({
      profileId: profile.id,
      title: scheduleIntent.title,
      baseDate: scheduleIntent.baseDate,
      exactTime: scheduleIntent.exactTime,
      calendarHint: scheduleIntent.calendarHint,
      durationMinutes: scheduleIntent.durationMinutes,
      recurrence: scheduleIntent.recurrence,
    })

    if (!options.length) {
      const reply = 'I could not find an opening there. Try another day or time.'
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    await storePendingAction({
      profileId: profile.id,
      smsFrom: from,
      kind: 'schedule',
      payload: {
        options,
        attendees: inviteeContext.invitees,
        unresolvedInvitees: inviteeContext.unresolvedNames,
      },
    })

    let reply = `I found these${scheduleIntent.recurrence ? ' starting' : ''} times:\n${optionList(
      options,
    )}\nReply 1, 2, or 3.`
    const recurring = recurrenceLine(options)
    if (recurring) {
      reply += `\n${recurring}`
    }
    if (inviteeContext.invitees.length) {
      reply += `\nReady to invite: ${inviteeSummary(inviteeContext.invitees)}.`
    }
    if (inviteeContext.unresolvedNames.length) {
      reply += `\nI still need email${
        inviteeContext.unresolvedNames.length > 1 ? 's' : ''
      } for ${unresolvedInviteeSummary(inviteeContext.unresolvedNames)}.`
    }
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (intent.type === 'reschedule') {
    const preferredDay = agendaDayForBaseDate(intent.baseDate)
    const fallbackDay = preferredDay === 'today' ? 'tomorrow' : 'today'
    const preferredEvents = await listAgenda(profile.id, preferredDay)
    const fallbackEvents = await listAgenda(profile.id, fallbackDay)
    const upcomingEvents = await searchUpcomingEvents(profile.id)
    const nearbyEvents = sortEventsByStart([...preferredEvents, ...fallbackEvents])
    const candidateEvents = sortEventsByStart(uniqueEvents([...nearbyEvents, ...upcomingEvents]))
    const target =
      findEventByQuery(preferredEvents, intent.query) ||
      findEventByQuery(nearbyEvents, intent.query) ||
      findEventByQuery(candidateEvents, intent.query)

    if (!target) {
      const matchedUpcomingEvents = matchingEventsByQuery(candidateEvents, intent.query)
      const topEvents = (matchedUpcomingEvents.length ? matchedUpcomingEvents : candidateEvents).slice(0, 3)
      if (!topEvents.length) {
        const reply = "I don't see anything to move there."
        await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
        return reply
      }

      await storePendingAction({
        profileId: profile.id,
        smsFrom: from,
        kind: 'select_reschedule_target',
        payload: { events: topEvents },
      })

      const reply = `Which one should I move?\n${topEvents
        .map((event, index) => `${index + 1}. ${event.timeLabel} ${event.title}`)
        .join('\n')}\nReply 1, 2, or 3.`
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    const { authority, contact } = await classifyTargetEvent(profile, target)

    if (authority === 'external_appointment') {
      const reply = await prepareExternalCallPrep({
        profile,
        smsFrom: from,
        target,
        baseDate: intent.baseDate,
        exactTime: intent.exactTime,
        contact,
      })
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    if (authority === 'invited_meeting' || authority === 'unknown') {
      const reply = await prepareInvitedReschedule({
        profile,
        smsFrom: from,
        target,
        baseDate: intent.baseDate,
        exactTime: intent.exactTime,
      })
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    if (isRecurringEvent(target)) {
      const reply = await prepareRecurringRescheduleScope({
        profileId: profile.id,
        smsFrom: from,
        target,
        authority,
        baseDate: intent.baseDate,
        exactTime: intent.exactTime,
      })
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    const options = await findScheduleOptions({
      profileId: profile.id,
      title: target.title,
      baseDate: intent.baseDate,
      exactTime: intent.exactTime,
      calendarHint: target.calendarName,
      durationMinutes: eventDurationMinutes(target),
    })

    if (!options.length) {
      const reply = `I found ${target.title}, but I could not find an opening to move it. Try another day or time.`
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    await storePendingAction({
      profileId: profile.id,
      smsFrom: from,
      kind: 'reschedule',
      payload: { target, options, authority },
    })

    const reply = `I can move ${target.title} to:\n${optionList(options)}\nReply 1, 2, or 3.`
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  if (intent.type === 'cancel') {
    const events = await searchUpcomingEvents(profile.id)
    const target = findEventByQuery(events, intent.query)
    if (!target) {
      const reply = 'Which event should I cancel? Try: cancel dentist.'
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    const { authority, contact } = await classifyTargetEvent(profile, target)

    if (authority === 'external_appointment') {
      await storePendingAction({
        profileId: profile.id,
        smsFrom: from,
        kind: contact?.phone_e164 ? 'external_cancel_confirm' : 'save_business_contact_phone',
        payload: contact?.phone_e164
          ? {
              target,
              businessName: contact?.label || target.title,
              phoneE164: contact.phone_e164,
              callNote: buildCancelNote(target),
              authority,
            }
          : {
              target,
              businessName: target.title,
              callNote: buildCancelNote(target),
              authority,
              followUpKind: 'external_cancel_confirm',
            },
      })

      let reply = `I haven't canceled ${target.title} with the office.`
      if (contact?.phone_e164) {
        reply += `\nOffice number: ${contact.phone_e164}.`
      } else {
        reply += "\nI don't have the office number yet. Reply with it and I'll save it for next time."
      }
      reply += `\nCall note: ${buildCancelNote(target)}`
      reply += `\nWhen the office confirms, text something like "I called and canceled it" and I'll clear it from your calendar.\nYou can keep texting me other things in the meantime.`
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    if (authority === 'invited_meeting' || authority === 'unknown') {
      const reply = await prepareInvitedCancel({
        profileId: profile.id,
        smsFrom: from,
        target,
      })
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    if (isRecurringEvent(target)) {
      const reply = await prepareRecurringCancelScope({
        profileId: profile.id,
        smsFrom: from,
        target,
        authority,
      })
      await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
      return reply
    }

    await deleteCalendarEvent(
      profile.id,
      target.id,
      target.calendarId,
      authority === 'owned_meeting' ? 'all' : 'none',
    )
    await clearPendingRemindersForEvent(profile.id, target.id)

    const reply =
      authority === 'owned_meeting'
        ? `Canceled ${target.title} and sent the update.`
        : `Canceled ${target.title}.`
    await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
    return reply
  }

  const reply =
    'I can schedule, reschedule, cancel, or send your agenda. Try: 9am meeting Tuesday on work calendar.'
  await logSms({ profileId: profile.id, from, body: reply, direction: 'outbound' })
  return reply
}
