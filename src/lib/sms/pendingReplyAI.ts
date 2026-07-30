import type { CalendarPlacementOption } from '../calendar/google'
import { defaultTimezone } from '../env'

type PendingCalendarReplyPayload = {
  calendar_choice: number | null
  title_override: string | null
}

export type PendingCalendarReplyInterpretation = {
  calendarChoice: number | null
  titleOverride: string | null
}

const pendingCalendarReplyTimeoutMs = 2_500

function hasPendingReplyAiUnderstanding() {
  return Boolean(process.env.OPENAI_API_KEY)
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

function cleanTitleOverride(value: string | null) {
  if (!value) return null

  const cleaned = value
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || null
}

export async function interpretPendingCalendarReplyWithAI({
  body,
  currentTitle,
  calendarChoices,
  visibleCalendarChoiceCount,
  timeZone = defaultTimezone(),
}: {
  body: string
  currentTitle: string
  calendarChoices: CalendarPlacementOption[]
  visibleCalendarChoiceCount?: number
  timeZone?: string
}): Promise<PendingCalendarReplyInterpretation | null> {
  if (!hasPendingReplyAiUnderstanding()) return null

  const visibleCalendars = calendarChoices.slice(
    0,
    Math.max(0, visibleCalendarChoiceCount || calendarChoices.length),
  )
  if (!visibleCalendars.length) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), pendingCalendarReplyTimeoutMs)

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
              `You interpret one SMS reply for Manoa, a calendar assistant.\n` +
              `Current timezone: ${timeZone}.\n` +
              `The user is replying to a "Which calendar should I put this on?" prompt.\n` +
              `Return only structured data.\n` +
              `Rules:\n` +
              `- The reply may include BOTH a calendar choice and a title correction.\n` +
              `- calendar_choice should be the visible option number when the user clearly chooses one of the shown calendars by number or name.\n` +
              `- title_override should be the corrected event title only when the user is clearly changing the event name.\n` +
              `- Do not invent a title.\n` +
              `- If the user is only picking a calendar, leave title_override null.\n` +
              `- If the user is only renaming the event, leave calendar_choice null.\n` +
              `- Ignore filler like "actually", "just", or "please".\n` +
              `- If the user says something like 2 and change the name to "Correct Name", return both fields.\n` +
              `- If unsure, use null rather than guessing.\n` +
              `Current event title: ${JSON.stringify(currentTitle)}.\n` +
              `Visible calendar options:\n` +
              visibleCalendars
                .map((calendar, index) => `${index + 1}. ${calendar.calendarLabel}`)
                .join('\n'),
          },
          {
            role: 'user',
            content: body,
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'manoa_pending_calendar_reply',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                calendar_choice: {
                  anyOf: [
                    {
                      type: 'integer',
                      minimum: 1,
                      maximum: Math.max(1, visibleCalendars.length),
                    },
                    { type: 'null' },
                  ],
                },
                title_override: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                },
              },
              required: ['calendar_choice', 'title_override'],
            },
          },
        },
      }),
    })

    if (!response.ok) return null

    const json = (await response.json()) as unknown
    const outputText = parseTopLevelOutputText(json)
    if (!outputText) return null

    const parsed = JSON.parse(outputText) as PendingCalendarReplyPayload
    return {
      calendarChoice: parsed.calendar_choice,
      titleOverride: cleanTitleOverride(parsed.title_override),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
