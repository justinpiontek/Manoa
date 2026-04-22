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
  if (!payload.has_calendar_items || payload.confidence === 'low') return []

  return payload.items.flatMap((item) => {
    const event = calendarImageItemToEvent(item)
    return event ? [event] : []
  })
}

function calendarImageItemToEvent(item: CalendarImageItemPayload): CalendarImageEvent | null {
  if (item.confidence === 'low') return null

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

  const prefix = item.is_confirmed_or_fixed ? 'already scheduled' : 'schedule'
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

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_CALENDAR_IMAGE_MODEL || process.env.OPENAI_SMS_MODEL || 'gpt-5.4-mini',
        input: [
          {
            role: 'system',
            content:
              `You read photos and screenshots for Manoa, a calendar assistant.\n` +
              `Extract clear calendar items from the image when possible.\n` +
              `Examples include appointment reminder cards, screenshots of texts or emails, school flyers, birthday invitations, sports schedules, work meeting screenshots, travel details, and deadline notices.\n` +
              `Current timezone: ${timeZone}.\n` +
              `Current local date: ${new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                timeZone,
              })}.\n` +
              `Do not invent missing dates, times, locations, people, teams, offices, or event names.\n` +
              `If the image is a full schedule, extract up to 12 clearly readable items.\n` +
              `If the image has many rows, only include rows with a clear date and time.\n` +
              `If there are no clear dates and times, set has_calendar_items false.\n` +
              `Set is_confirmed_or_fixed true when the image shows a fixed event, invitation, flyer, reminder card, or confirmed plan.\n` +
              `Set is_confirmed_or_fixed false when the image only shows a proposed time or tentative conversation.\n` +
              `Use YYYY-MM-DD for date_ymd and HH:MM 24-hour time for time_24h.\n` +
              `Set confidence low when the date or time is hard to read.`,
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
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI image reading returned ${response.status}: ${errorText.slice(0, 220)}`)
    }

    const outputText = parseTopLevelOutputText(await response.json())
    if (!outputText) throw new Error('OpenAI returned no calendar event details.')

    const payload = JSON.parse(outputText) as CalendarImagePayload
    const events = calendarImagePayloadToEvents(payload)
    const smsTexts = events.map((event) => event.smsText)
    return {
      smsText: smsTexts[0] || null,
      smsTexts,
      events,
      confidence: payload.confidence,
      notes: payload.notes,
    }
  } finally {
    clearTimeout(timeout)
  }
}
