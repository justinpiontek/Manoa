import { defaultTimezone } from '../env'

type CalendarImageItemPayload = {
  is_confirmed_or_fixed: boolean
  title: string | null
  date_ymd: string | null
  time_24h: string | null
  duration_minutes: number | null
  location: string | null
  organizer_or_source: string | null
  item_type: 'appointment' | 'meeting' | 'party' | 'school' | 'sports' | 'travel' | 'deadline' | 'other' | null
  confidence: 'high' | 'medium' | 'low'
  notes: string | null
}

type CalendarImagePayload = {
  has_calendar_items: boolean
  items: CalendarImageItemPayload[]
  confidence: 'high' | 'medium' | 'low'
  notes: string | null
}

export type CalendarImageEvent = {
  title: string
  dateYmd: string
  time24h: string
  durationMinutes: number | null
  location: string | null
  organizerOrSource: string | null
  itemType: CalendarImageItemPayload['item_type']
  isConfirmedOrFixed: boolean
  confidence: CalendarImageItemPayload['confidence']
  notes: string | null
  smsText: string
}

export type CalendarImageResult = {
  smsText: string | null
  smsTexts: string[]
  events: CalendarImageEvent[]
  confidence: CalendarImagePayload['confidence']
  notes?: string | null
}

function hasCalendarImageUnderstanding() {
  return Boolean(process.env.OPENAI_API_KEY)
}

function currentLocalDateString(timeZone: string) {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  })
}

function structuredImageInstructions(timeZone: string) {
  return (
    `You read photos and screenshots for Manoa, a calendar assistant.\n` +
    `Current timezone: ${timeZone}.\n` +
    `Current local date: ${currentLocalDateString(timeZone)}.\n` +
    'Extract clear calendar events from screenshots, invitation cards, reminder cards, email screenshots, text screenshots, flyers, and calendar-event screenshots.\n' +
    'Focus on the event details, not the surrounding app chrome.\n' +
    'For screenshots of a single calendar item or invitation, prefer the obvious main event.\n' +
    'If a month/day/time is clear but the year is missing, infer the next upcoming matching year from the current local date.\n' +
    'If the image shows multiple clear events, return them all.\n' +
    'Do not invent a date, time, or location that is not visible or strongly implied.\n' +
    'Use has_calendar_items=false only when no real event can be extracted.'
  )
}

function fallbackImageInstructions(timeZone: string) {
  return (
    `You read photos and screenshots for Manoa, a calendar assistant.\n` +
    `Current timezone: ${timeZone}.\n` +
    `Current local date: ${currentLocalDateString(timeZone)}.\n` +
    'Read the image and turn each clear event into one direct Manoa command line.\n' +
    'This includes screenshots of calendar events, invitation cards, reminder cards, email screenshots, and text screenshots.\n' +
    'Ignore app chrome, chat bubbles, and decorative text unless they contain the event itself.\n' +
    'Each line must start with "add " for fixed/confirmed events or "schedule " for tentative ones.\n' +
    'Use natural date phrases like "Saturday, June 6, 2026" and include the location when visible.\n' +
    'If a month/day/time is clear but the year is missing, infer the next upcoming matching year.\n' +
    'Return only the command lines. If there is no clear event, return exactly NO_EVENT.'
  )
}

function parseTopLevelOutputText(response: unknown) {
  if (!response || typeof response !== 'object') return null

  const candidate = (response as { output_text?: unknown }).output_text
  if (typeof candidate === 'string' && candidate.trim()) return candidate

  const output = (response as {
    output?: Array<{
      content?: Array<
        | { text?: string; type?: string }
        | { type?: string; json?: unknown }
      >
    }>
  }).output
  if (!Array.isArray(output)) return null

  for (const item of output) {
    for (const content of item.content || []) {
      const contentText = (content as { text?: unknown }).text
      if (content?.type === 'output_text' && typeof contentText === 'string' && contentText.trim()) {
        return contentText
      }
      if (typeof contentText === 'string' && contentText.trim()) {
        return contentText
      }
      if ((content as { type?: string }).type === 'output_json' && (content as { json?: unknown }).json) {
        try {
          return JSON.stringify((content as { json: unknown }).json)
        } catch {
          // ignore and keep looking
        }
      }
    }
  }

  return null
}

async function openAiImageResponse({
  dataUrl,
  timeZone,
  body,
  timeoutMs = 12_000,
}: {
  dataUrl: string
  timeZone: string
  body: Record<string, unknown>
  timeoutMs?: number
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_CALENDAR_IMAGE_MODEL || 'gpt-4.1',
        ...body,
        input: [
          {
            role: 'system',
            content: structuredImageInstructions(timeZone),
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'Read this image and extract the calendar event details.',
              },
              {
                type: 'input_image',
                image_url: dataUrl,
                detail: 'high',
              },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI image reading returned ${response.status}: ${errorText.slice(0, 220)}`)
    }

    return parseTopLevelOutputText(await response.json())
  } finally {
    clearTimeout(timeout)
  }
}

function fallbackSmsTexts(outputText: string) {
  return outputText
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .split(/\r?\n+/)
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .filter((line) => !/^no_event$/i.test(line))
    .filter((line) => /^(add|schedule)\b/i.test(line))
}

function displayDate(value: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`
}

function displayTime(value: string | null) {
  const match = value?.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!match) return null

  const hour24 = Number(match[1])
  const hour12 = hour24 % 12 || 12
  const suffix = hour24 >= 12 ? 'pm' : 'am'
  return `${hour12}:${match[2]}${suffix}`
}

function cleanText(value: string | null | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim()
}

export function calendarImagePayloadToSmsText(payload: CalendarImagePayload) {
  return calendarImagePayloadToSmsTexts(payload)[0] || null
}

export function calendarImagePayloadToSmsTexts(payload: CalendarImagePayload) {
  return calendarImagePayloadToEvents(payload).map((event) => event.smsText)
}

export function calendarImagePayloadToEvents(payload: CalendarImagePayload): CalendarImageEvent[] {
  if (!payload.has_calendar_items) return []

  return payload.items.flatMap((item) => {
    const event = calendarImageItemToEvent(item)
    return event ? [event] : []
  })
}

function calendarImageItemToEvent(item: CalendarImageItemPayload): CalendarImageEvent | null {
  const date = displayDate(item.date_ymd)
  const time = displayTime(item.time_24h)
  if (!date || !time) return null

  const title =
    cleanText(item.title) ||
    (cleanText(item.organizer_or_source)
      ? `${cleanText(item.organizer_or_source)} ${item.item_type || 'event'}`
      : item.item_type || 'event')
  const location = cleanText(item.location || item.organizer_or_source)
  const duration = item.duration_minutes && item.duration_minutes > 0
    ? ` for ${item.duration_minutes} minutes`
    : ''

  const prefix = item.is_confirmed_or_fixed ? 'add' : 'schedule'
  const smsText = `${prefix} ${title} on ${date} at ${time}${location ? ` at ${location}` : ''}${duration}`

  return {
    title,
    dateYmd: item.date_ymd as string,
    time24h: item.time_24h as string,
    durationMinutes: item.duration_minutes,
    location: location || null,
    organizerOrSource: cleanText(item.organizer_or_source) || null,
    itemType: item.item_type,
    isConfirmedOrFixed: item.is_confirmed_or_fixed,
    confidence: item.confidence,
    notes: item.notes,
    smsText,
  }
}

export async function calendarImageToSmsText({
  dataUrl,
  timeZone = defaultTimezone(),
}: {
  dataUrl: string
  timeZone?: string
}): Promise<CalendarImageResult> {
  if (!hasCalendarImageUnderstanding()) {
    throw new Error('Photo reading needs OPENAI_API_KEY on the server.')
  }
  let payload: CalendarImagePayload = {
    has_calendar_items: false,
    items: [],
    confidence: 'low',
    notes: null,
  }
  let events: CalendarImageEvent[] = []
  let smsTexts: string[] = []
  let structuredFailure: Error | null = null

  try {
    const outputText = await openAiImageResponse({
      dataUrl,
      timeZone,
      body: {
        instructions: structuredImageInstructions(timeZone),
        text: {
          format: {
            type: 'json_schema',
            name: 'manoa_calendar_image',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                has_calendar_items: { type: 'boolean' },
                items: {
                  type: 'array',
                  maxItems: 12,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      is_confirmed_or_fixed: { type: 'boolean' },
                      title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                      date_ymd: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                      time_24h: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                      duration_minutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
                      location: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                      organizer_or_source: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                      item_type: {
                        anyOf: [
                          {
                            type: 'string',
                            enum: [
                              'appointment',
                              'meeting',
                              'party',
                              'school',
                              'sports',
                              'travel',
                              'deadline',
                              'other',
                            ],
                          },
                          { type: 'null' },
                        ],
                      },
                      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                      notes: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                    },
                    required: [
                      'is_confirmed_or_fixed',
                      'title',
                      'date_ymd',
                      'time_24h',
                      'duration_minutes',
                      'location',
                      'organizer_or_source',
                      'item_type',
                      'confidence',
                      'notes',
                    ],
                  },
                },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                notes: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              },
              required: [
                'has_calendar_items',
                'items',
                'confidence',
                'notes',
              ],
            },
          },
        },
      },
    })

    if (!outputText) throw new Error('OpenAI returned no calendar event details.')

    payload = JSON.parse(outputText) as CalendarImagePayload
    events = calendarImagePayloadToEvents(payload)
    smsTexts = events.map((event) => event.smsText)
  } catch (error) {
    structuredFailure = error instanceof Error ? error : new Error('Structured image parsing failed.')
    console.error('Structured calendar image parsing failed.', {
      error: structuredFailure.message,
    })
  }

  if (smsTexts.length) {
    return {
      smsText: smsTexts[0] || null,
      smsTexts,
      events,
      confidence: payload.confidence,
      notes: payload.notes,
    }
  }

  let fallbackFailure: Error | null = null
  let fallbackSmsLines: string[] = []

  try {
    const fallbackText = await openAiImageResponse({
      dataUrl,
      timeZone,
      timeoutMs: 10_000,
      body: {
        instructions: fallbackImageInstructions(timeZone),
      },
    })

    fallbackSmsLines = fallbackText ? fallbackSmsTexts(fallbackText) : []
  } catch (error) {
    fallbackFailure = error instanceof Error ? error : new Error('Fallback image parsing failed.')
    console.error('Fallback calendar image parsing failed.', {
      error: fallbackFailure.message,
    })
  }

  if (fallbackSmsLines.length) {
    return {
      smsText: fallbackSmsLines[0] || null,
      smsTexts: fallbackSmsLines,
      events,
      confidence: 'medium',
      notes: payload.notes,
    }
  }

  const meaningfulFailure = fallbackFailure || structuredFailure
  if (meaningfulFailure && /openai|api key|returned \d+|timed out/i.test(meaningfulFailure.message)) {
    throw meaningfulFailure
  }

  return {
    smsText: null,
    smsTexts: [],
    events,
    confidence: payload.confidence,
    notes: payload.notes,
  }
}
