import type { RecurrenceSpec } from '../calendar/recurrence'
import { defaultTimezone } from '../env'
import { dateFromTimeZoneParts, nextDateForWeekday, startOfDay } from '../calendar/dates'
import type { ParsedSmsIntent } from './parser'
import { parseDateWindow, parseExplicitDate, parseScheduleLocation } from './parser'

type AiIntentPayload = {
  intent_type: 'choice' | 'agenda' | 'schedule' | 'reschedule' | 'cancel' | 'unknown'
  choice: 1 | 2 | 3 | null
  day: 'today' | 'tomorrow' | null
  date_ymd: string | null
  weekday:
    | 'sunday'
    | 'monday'
    | 'tuesday'
    | 'wednesday'
    | 'thursday'
    | 'friday'
    | 'saturday'
    | null
  title: string | null
  query: string | null
  exact_time_24h: string | null
  calendar_hint: string | null
  location: string | null
  duration_minutes: number | null
  recurrence_unit: 'week' | 'month' | null
  recurrence_interval: 1 | 2 | null
  recurrence_mode: 'month_day' | 'nth_weekday' | null
}

const weekdayNumbers: Record<NonNullable<AiIntentPayload['weekday']>, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

const aiIntentTimeoutMs = 12_000

function hasAiSmsUnderstanding() {
  return Boolean(process.env.OPENAI_API_KEY)
}

export type AiParseResult = {
  intent: ParsedSmsIntent | null
  understoodBy: 'AI' | 'Fallback parser'
  reason?: string
}

export type AiConversationTurn = {
  role: 'user' | 'assistant'
  content: string
}

function parseExactTime(value: string | null) {
  if (!value) return null
  const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!match) return null
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  }
}

function sameDay(left: Date, right: Date, timeZone: string) {
  return left.toLocaleDateString('en-CA', { timeZone }) === right.toLocaleDateString('en-CA', { timeZone })
}

function parseBaseDate(
  dateYmd: string | null,
  day: AiIntentPayload['day'],
  weekday: AiIntentPayload['weekday'],
  timeZone: string,
  originalText: string,
) {
  const explicitFromText = parseExplicitDate(originalText, timeZone)
  if (explicitFromText) return explicitFromText

  const ymdMatch = dateYmd?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (ymdMatch) {
    return dateFromTimeZoneParts(
      {
        year: Number(ymdMatch[1]),
        month: Number(ymdMatch[2]),
        day: Number(ymdMatch[3]),
        hour: 0,
        minute: 0,
        second: 0,
      },
      timeZone,
    )
  }

  if (day === 'today') return startOfDay(0, timeZone)
  if (day === 'tomorrow') return startOfDay(1, timeZone)
  if (weekday) return nextDateForWeekday(weekdayNumbers[weekday], timeZone)
  if (/\bthis week\b/i.test(originalText)) return startOfDay(0, timeZone)
  return startOfDay(1, timeZone)
}

function parseRecurrence(payload: AiIntentPayload): RecurrenceSpec | null {
  if (payload.recurrence_unit === 'week') {
    return {
      unit: 'week',
      interval: payload.recurrence_interval === 2 ? 2 : 1,
    }
  }

  if (payload.recurrence_unit === 'month') {
    return {
      unit: 'month',
      interval: 1,
      mode: payload.recurrence_mode === 'nth_weekday' ? 'nth_weekday' : 'month_day',
    }
  }

  return null
}

function parseTopLevelOutputText(response: unknown) {
  if (!response || typeof response !== 'object') return null

  const candidate = (response as { output_text?: unknown }).output_text
  if (typeof candidate === 'string' && candidate.trim()) return candidate

  const output = (response as { output?: Array<{ content?: Array<{ text?: string; type?: string }> }> }).output
  if (!Array.isArray(output)) return null

  for (const item of output) {
    for (const content of item.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) {
        return content.text
      }
    }
  }

  return null
}

function aiIntentBodyPreview(body: string) {
  return body.replace(/\s+/g, ' ').trim().slice(0, 120)
}

function compactConversation(conversation: AiConversationTurn[]) {
  return conversation
    .map((turn) => ({
      role: turn.role,
      content: turn.content.trim(),
    }))
    .filter((turn) => turn.content)
    .slice(-4)
}

function logAiIntentFallback({
  body,
  timeZone,
  reason,
}: {
  body: string
  timeZone: string
  reason?: string
}) {
  console.warn('[sms-ai-intent] Falling back to parser', {
    reason: reason || 'Unknown fallback reason.',
    timeZone,
    bodyLength: body.length,
    bodyPreview: aiIntentBodyPreview(body),
  })
}

function toParsedSmsIntent(payload: AiIntentPayload, timeZone: string, originalText: string): ParsedSmsIntent {
  switch (payload.intent_type) {
    case 'choice':
      return payload.choice ? { type: 'choice', choice: payload.choice } : { type: 'unknown' }

    case 'agenda':
      const agendaWindow = parseDateWindow(originalText, timeZone)
      if (payload.day || agendaWindow) {
        return {
          type: 'agenda',
          day: payload.day || (agendaWindow && sameDay(agendaWindow.start, startOfDay(1, timeZone), timeZone) ? 'tomorrow' : 'today'),
          dateWindow: agendaWindow,
          label: agendaWindow?.label,
        }
      }
      return { type: 'unknown' }

    case 'schedule':
      const locationContext = parseScheduleLocation(originalText, timeZone)
      return {
        type: 'schedule',
        title: payload.title?.trim() || 'meeting',
        baseDate: parseBaseDate(payload.date_ymd, payload.day, payload.weekday, timeZone, originalText),
        dateWindow: parseDateWindow(originalText, timeZone),
        exactTime: parseExactTime(payload.exact_time_24h),
        calendarHint: payload.calendar_hint || 'Calendar',
        durationMinutes: payload.duration_minutes,
        recurrence: parseRecurrence(payload),
        location: payload.location?.trim() || locationContext.location,
      }

    case 'reschedule':
      return {
        type: 'reschedule',
        query: payload.query?.trim() || payload.title?.trim() || 'meeting',
        baseDate: parseBaseDate(payload.date_ymd, payload.day, payload.weekday, timeZone, originalText),
        dateWindow: parseDateWindow(originalText, timeZone),
        exactTime: parseExactTime(payload.exact_time_24h),
        calendarHint: payload.calendar_hint || 'Calendar',
      }

    case 'cancel':
      return {
        type: 'cancel',
        query: payload.query?.trim() || payload.title?.trim() || 'meeting',
      }

    default:
      return { type: 'unknown' }
  }
}

export async function parseSmsIntentWithAIResult(
  body: string,
  timeZone = defaultTimezone(),
  conversation: AiConversationTurn[] = [],
): Promise<AiParseResult> {
  if (!hasAiSmsUnderstanding()) {
    const result: AiParseResult = {
      intent: null,
      understoodBy: 'Fallback parser',
      reason: 'OPENAI_API_KEY is missing on the server.',
    }
    logAiIntentFallback({ body, timeZone, reason: result.reason })
    return result
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), aiIntentTimeoutMs)
  const recentConversation = compactConversation(conversation)

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_SMS_MODEL || 'gpt-5.4-mini',
        input: [
          {
            role: 'system',
            content:
              `You extract structured intent for Manoa, an SMS calendar assistant.\n` +
              `Current timezone: ${timeZone}.\n` +
              `Current local date: ${new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                timeZone,
              })}.\n` +
              `Return only structured data.\n` +
              `Rules:\n` +
              `- agenda means the user wants to see today's or tomorrow's schedule or availability.\n` +
              `- schedule means creating a new event.\n` +
              `- reschedule means moving an existing event.\n` +
              `- cancel means canceling or removing an existing event.\n` +
              `- choice means direct option-selection like first, second, third, 1, 2, 3.\n` +
              `- unknown if the text is too vague or not a calendar action.\n` +
              `- If the user pastes or forwards event details from an email, invitation, school flyer, appointment reminder, sports schedule, or text thread, treat it as schedule when there is one clear calendar event.\n` +
              `- If pasted details contain multiple events and no single main event is obvious, use unknown instead of guessing.\n` +
              `- For explicit dates like "May 17", "5/17", or "17 May", set date_ymd to YYYY-MM-DD in the current local year unless that date has passed; then use next year. Prefer date_ymd over weekday.\n` +
              `- For loose times, map morning to 09:00, afternoon to 14:00, evening/tonight to 18:00, noon/lunchtime to 12:00.\n` +
              `- Detect recurring scheduling like every Tuesday, weekly, every other Friday, biweekly, and monthly.\n` +
              `- Use recurrence_unit week for weekly or every-other-week repeats, and month for monthly repeats.\n` +
              `- For monthly phrases tied to a weekday like "monthly Tuesday", use recurrence_mode nth_weekday. Otherwise use month_day.\n` +
              `- Keep event titles short. Strip date, time, calendar, and location details from title/query when possible.\n` +
              `- Put obvious location phrases into location, like "at Mary's house", "at Starbucks", "near Union Square", or "in conference room B". Do not put times like "at 10am" in location.\n` +
              `- Preserve the user's calendar label when they name one, like "Personal", "Metonga Media", or "Part-time job". Use "Calendar" only if they did not name one.\n` +
              `- Strip invitee names/emails from the title/query if possible.\n` +
              `- Use the recent conversation turns as context for follow-ups like "actually make it an hour", "change it to Thursday instead", "cancel that", or "book the second one".\n` +
              `- Treat the final user turn as the message to parse right now. Earlier turns are only context.`,
          },
          ...recentConversation,
          {
            role: 'user',
            content: body,
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'manoa_sms_intent',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                intent_type: {
                  type: 'string',
                  enum: ['choice', 'agenda', 'schedule', 'reschedule', 'cancel', 'unknown'],
                },
                choice: {
                  anyOf: [
                    { type: 'integer', enum: [1, 2, 3] },
                    { type: 'null' },
                  ],
                },
                day: {
                  anyOf: [
                    { type: 'string', enum: ['today', 'tomorrow'] },
                    { type: 'null' },
                  ],
                },
                date_ymd: {
                  anyOf: [
                    { type: 'string' },
                    { type: 'null' },
                  ],
                },
                weekday: {
                  anyOf: [
                    {
                      type: 'string',
                      enum: [
                        'sunday',
                        'monday',
                        'tuesday',
                        'wednesday',
                        'thursday',
                        'friday',
                        'saturday',
                      ],
                    },
                    { type: 'null' },
                  ],
                },
                title: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                },
                query: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                },
                exact_time_24h: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                },
                calendar_hint: {
                  anyOf: [
                    { type: 'string' },
                    { type: 'null' },
                  ],
                },
                location: {
                  anyOf: [
                    { type: 'string' },
                    { type: 'null' },
                  ],
                },
                duration_minutes: {
                  anyOf: [{ type: 'integer' }, { type: 'null' }],
                },
                recurrence_unit: {
                  anyOf: [
                    { type: 'string', enum: ['week', 'month'] },
                    { type: 'null' },
                  ],
                },
                recurrence_interval: {
                  anyOf: [{ type: 'integer', enum: [1, 2] }, { type: 'null' }],
                },
                recurrence_mode: {
                  anyOf: [
                    { type: 'string', enum: ['month_day', 'nth_weekday'] },
                    { type: 'null' },
                  ],
                },
              },
              required: [
                'intent_type',
                'choice',
                'day',
                'date_ymd',
                'weekday',
                'title',
                'query',
                'exact_time_24h',
                'calendar_hint',
                'location',
                'duration_minutes',
                'recurrence_unit',
                'recurrence_interval',
                'recurrence_mode',
              ],
            },
          },
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      const result: AiParseResult = {
        intent: null,
        understoodBy: 'Fallback parser',
        reason: `OpenAI returned ${response.status}: ${errorText.slice(0, 220)}`,
      }
      logAiIntentFallback({ body, timeZone, reason: result.reason })
      return result
    }
    const json = (await response.json()) as unknown
    const outputText = parseTopLevelOutputText(json)
    if (!outputText) {
      const result: AiParseResult = {
        intent: null,
        understoodBy: 'Fallback parser',
        reason: 'OpenAI returned no structured output text.',
      }
      logAiIntentFallback({ body, timeZone, reason: result.reason })
      return result
    }

    const parsed = JSON.parse(outputText) as AiIntentPayload
    return {
        intent: toParsedSmsIntent(parsed, timeZone, body),
        understoodBy: 'AI',
      }
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === 'AbortError'
        ? `OpenAI intent parsing timed out after ${Math.round(aiIntentTimeoutMs / 1000)}s.`
        : error instanceof Error
          ? error.message
          : 'Unknown AI parsing error.'
    const result: AiParseResult = {
      intent: null,
      understoodBy: 'Fallback parser',
      reason: message,
    }
    logAiIntentFallback({ body, timeZone, reason: result.reason })
    return result
  } finally {
    clearTimeout(timeout)
  }
}

export async function parseSmsIntentWithAI(
  body: string,
  timeZone = defaultTimezone(),
  conversation: AiConversationTurn[] = [],
): Promise<ParsedSmsIntent | null> {
  const result = await parseSmsIntentWithAIResult(body, timeZone, conversation)
  return result.intent
}
