import { dateTimePartsInTimeZone } from '../calendar/dates'
import { defaultTimezone } from '../env'
import { parseExplicitDate } from './parser'

type CalendarImageItemPayload = {
  is_confirmed_or_fixed: boolean
  title: string | null
  date_ymd: string | null
  end_date_ymd: string | null
  time_24h: string | null
  is_all_day: boolean
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
  endDateYmd: string | null
  time24h: string | null
  isAllDay: boolean
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
    'For flyers, newsletters, school notices, church bulletins, and "important dates" lists, extract every separate dated event line you can clearly read.\n' +
    'Items like "No School", birthdays, last day of school, graduations, games, and ceremonies should each become their own event if they have a date.\n' +
    'For reservations, hotel stays, campground stays, and travel confirmations, use the arrival date as the start date and the departure date as the final included calendar date when no time is shown.\n' +
    'If no event time is shown but the item clearly spans full dates, mark it as all-day.\n' +
    'If a month/day/time is clear but the year is missing, infer the next upcoming matching year from the current local date.\n' +
    'If the image shows multiple clear events, return them all.\n' +
    'Do not invent a date, time, or location that is not visible or strongly implied.\n' +
    'Use has_calendar_items=false only when no real event can be extracted.'
  )
}

function multiEventImageInstructions(timeZone: string) {
  return (
    `You read photos and screenshots for Manoa, a calendar assistant.\n` +
    `Current timezone: ${timeZone}.\n` +
    `Current local date: ${currentLocalDateString(timeZone)}.\n` +
    'This image may contain a flyer, newsletter, school notice, church bulletin, travel confirmation, or an "important dates" list.\n' +
    'Extract every separate dated calendar item you can clearly read, not just the most prominent one.\n' +
    'Each dated line or block should become its own event.\n' +
    'Examples include no school days, birthdays, graduations, ceremonies, games, deadlines, arrival dates, and departure dates.\n' +
    'If no event time is shown, mark that event as all-day.\n' +
    'If an item spans multiple dates, include both the start date and the end date.\n' +
    'If a month/day/time is clear but the year is missing, infer the next upcoming matching year from the current local date.\n' +
    'Do not merge unrelated dated items into one event.\n' +
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
    'For flyers, newsletters, school notices, church bulletins, and "important dates" lists, output one separate line for each dated event you can clearly read.\n' +
    'For reservations, hotel stays, campground stays, and travel confirmations, include both arrival and departure dates.\n' +
    'If no time is shown and the event clearly spans full dates, use "all day".\n' +
    'Ignore app chrome, chat bubbles, and decorative text unless they contain the event itself.\n' +
    'Each line must start with "add " for fixed/confirmed events or "schedule " for tentative ones.\n' +
    'Use compact numeric dates like "6/6/2026". For multi-day all-day events, write "from 5/22/2026 to 5/26/2026 all day". Include the location when visible.\n' +
    'If a month/day/time is clear but the year is missing, infer the next upcoming matching year.\n' +
    'Return only the command lines. If there is no clear event, return exactly NO_EVENT.'
  )
}

function lineItemImageInstructions(timeZone: string) {
  return (
    `You read photos and screenshots for Manoa, a calendar assistant.\n` +
    `Current timezone: ${timeZone}.\n` +
    `Current local date: ${currentLocalDateString(timeZone)}.\n` +
    'This image may be a school flyer, preschool notice, church bulletin, newsletter, invitation, or important-dates sheet.\n' +
    'Return one line per clear dated event using this exact format:\n' +
    'DATE || TITLE || TIME_OR_ALL_DAY || LOCATION_OR_NOTES\n' +
    'Use compact numeric dates like 5/20/2026.\n' +
    'If the event has no clear time, write ALL_DAY in the third field.\n' +
    'If a section heading provides the event title, use it as the title.\n' +
    'If the dated line adds detail, include it in TITLE or LOCATION_OR_NOTES.\n' +
    'If a month/day is clear but the year is missing, infer the next upcoming matching year.\n' +
    'Return only the lines. If there are no readable dated events, return exactly NO_EVENT.'
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
  instructions,
  userText,
  body,
  timeoutMs = 12_000,
}: {
  dataUrl: string
  timeZone: string
  instructions: string
  userText: string
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
        instructions,
        ...body,
        input: [
          {
            role: 'system',
            content: instructions,
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: userText,
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

function lineItemFallbackLines(outputText: string) {
  return outputText
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .split(/\r?\n+/)
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .filter((line) => !/^no_event$/i.test(line))
    .filter((line) => line.includes('||'))
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

function looksTravelReservationText(value: string) {
  return /\b(reservation|campground|camp site|campsite|rv site|hotel|motel|resort|airbnb|check-in|check out|check-out|arrival|departure|itinerary|travel|flight|boarding|lodging|stay)\b/i.test(
    value,
  )
}

function ymdFromDate(date: Date, timeZone: string) {
  const parts = dateTimePartsInTimeZone(date, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function parseTimeTo24h(value: string | null | undefined) {
  const match = cleanText(value).toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/)
  if (!match) return null
  let hour = Number(match[1]) % 12
  const minute = Number(match[2] || '0')
  if (match[3] === 'pm') hour += 12
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function parseFallbackLineToEvent(line: string, timeZone: string): CalendarImageEvent | null {
  const cleaned = cleanText(line.replace(/^[-*]\s+/, '').replace(/[.]+$/, ''))
  const prefixMatch = cleaned.match(/^(add|schedule)\s+(.+)$/i)
  if (!prefixMatch) return null
  const isConfirmedOrFixed = prefixMatch[1].toLowerCase() === 'add'
  const rest = prefixMatch[2]

  const rangeMatch = rest.match(/^(.+?)\s+from\s+(.+?)\s+to\s+(.+?)\s+all day(?:\s+at\s+(.+))?$/i)
  if (rangeMatch) {
    const startDate = parseExplicitDate(rangeMatch[2], timeZone)
    const endDate = parseExplicitDate(rangeMatch[3], timeZone)
    if (!startDate || !endDate) return null
    const title = cleanText(rangeMatch[1]) || 'event'
    const location = cleanText(rangeMatch[4]) || null
    return {
      title,
      dateYmd: ymdFromDate(startDate, timeZone),
      endDateYmd: ymdFromDate(endDate, timeZone),
      time24h: null,
      isAllDay: true,
      durationMinutes: null,
      location,
      organizerOrSource: null,
      itemType: 'other',
      isConfirmedOrFixed,
      confidence: 'medium',
      notes: null,
      smsText: cleaned,
    }
  }

  const allDayMatch = rest.match(/^(.+?)\s+on\s+(.+?)\s+all day(?:\s+at\s+(.+))?$/i)
  if (allDayMatch) {
    const date = parseExplicitDate(allDayMatch[2], timeZone)
    if (!date) return null
    const title = cleanText(allDayMatch[1]) || 'event'
    const location = cleanText(allDayMatch[3]) || null
    return {
      title,
      dateYmd: ymdFromDate(date, timeZone),
      endDateYmd: null,
      time24h: null,
      isAllDay: true,
      durationMinutes: null,
      location,
      organizerOrSource: null,
      itemType: 'other',
      isConfirmedOrFixed,
      confidence: 'medium',
      notes: null,
      smsText: cleaned,
    }
  }

  const timedMatch = rest.match(/^(.+?)\s+on\s+(.+?)\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))(?:\s+at\s+(.+?))?(?:\s+for\s+(\d+)\s+minutes?)?$/i)
  if (timedMatch) {
    const date = parseExplicitDate(timedMatch[2], timeZone)
    const time24h = parseTimeTo24h(timedMatch[3])
    if (!date || !time24h) return null
    const title = cleanText(timedMatch[1]) || 'event'
    const location = cleanText(timedMatch[4]) || null
    const durationMinutes = timedMatch[5] ? Number(timedMatch[5]) : null
    return {
      title,
      dateYmd: ymdFromDate(date, timeZone),
      endDateYmd: null,
      time24h,
      isAllDay: false,
      durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : null,
      location,
      organizerOrSource: null,
      itemType: 'other',
      isConfirmedOrFixed,
      confidence: 'medium',
      notes: null,
      smsText: cleaned,
    }
  }

  return null
}

function fallbackSmsEvents(lines: string[], timeZone: string) {
  return lines
    .map((line) => parseFallbackLineToEvent(line, timeZone))
    .filter((event): event is CalendarImageEvent => Boolean(event))
}

function parseLineItemToEvent(line: string, timeZone: string): CalendarImageEvent | null {
  const parts = line.split('||').map((part) => cleanText(part))
  if (parts.length < 3) return null

  const date = parseExplicitDate(parts[0], timeZone)
  if (!date) return null

  const title = parts[1] || 'event'
  const timeOrAllDay = (parts[2] || '').toUpperCase()
  const locationOrNotes = parts[3] || ''
  const time24h = timeOrAllDay === 'ALL_DAY' ? null : parseTimeTo24h(parts[2])
  const isAllDay = timeOrAllDay === 'ALL_DAY'
  if (!isAllDay && !time24h) return null

  const dateYmd = ymdFromDate(date, timeZone)
  const location = locationOrNotes || null
  const smsText = isAllDay
    ? `add ${title} on ${displayDate(dateYmd)} all day${location ? ` at ${location}` : ''}`
    : `add ${title} on ${displayDate(dateYmd)} at ${displayTime(time24h)}${location ? ` at ${location}` : ''}`

  return {
    title,
    dateYmd,
    endDateYmd: null,
    time24h,
    isAllDay,
    durationMinutes: null,
    location,
    organizerOrSource: null,
    itemType: 'other',
    isConfirmedOrFixed: true,
    confidence: 'medium',
    notes: null,
    smsText,
  }
}

function lineItemFallbackEvents(lines: string[], timeZone: string) {
  return lines
    .map((line) => parseLineItemToEvent(line, timeZone))
    .filter((event): event is CalendarImageEvent => Boolean(event))
}

function calendarImageSchema() {
  return {
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
            end_date_ymd: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            time_24h: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            is_all_day: { type: 'boolean' },
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
            'end_date_ymd',
            'time_24h',
            'is_all_day',
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
  }
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
  const endDate = displayDate(item.end_date_ymd)
  const time = displayTime(item.time_24h)
  if (!date) return null

  const title =
    cleanText(item.title) ||
    (cleanText(item.organizer_or_source)
      ? `${cleanText(item.organizer_or_source)} ${item.item_type || 'event'}`
      : item.item_type || 'event')
  const location = cleanText(item.location || item.organizer_or_source)
  const sourceText = [title, location, cleanText(item.organizer_or_source), cleanText(item.notes)]
    .filter(Boolean)
    .join(' ')
  const looksTravelReservation =
    item.item_type === 'travel' || looksTravelReservationText(sourceText)
  const hasDateRange = Boolean(endDate && endDate !== date)
  const isAllDay = Boolean(item.is_all_day || (looksTravelReservation && hasDateRange))
  const isConfirmedOrFixed = Boolean(
    item.is_confirmed_or_fixed ||
      (looksTravelReservation &&
        /\b(reservation|confirmed|confirmation|itinerary|booking|arrival|departure)\b/i.test(sourceText)),
  )
  if (!time && !isAllDay) return null

  const duration = item.duration_minutes && item.duration_minutes > 0
    ? ` for ${item.duration_minutes} minutes`
    : ''

  const prefix = isConfirmedOrFixed ? 'add' : 'schedule'
  const smsText = isAllDay
    ? `${prefix} ${title}${endDate && endDate !== date ? ` from ${date} to ${endDate}` : ` on ${date}`} all day${location ? ` at ${location}` : ''}`
    : `${prefix} ${title} on ${date} at ${time}${location ? ` at ${location}` : ''}${duration}`

  return {
    title,
    dateYmd: item.date_ymd as string,
    endDateYmd: item.end_date_ymd || null,
    time24h: isAllDay ? null : item.time_24h || null,
    isAllDay,
    durationMinutes: item.duration_minutes,
    location: location || null,
    organizerOrSource: cleanText(item.organizer_or_source) || null,
    itemType: item.item_type,
    isConfirmedOrFixed,
    confidence: item.confidence,
    notes: item.notes,
    smsText,
  }
}

export async function calendarImageToSmsText({
  dataUrl,
  timeZone = defaultTimezone(),
  mode = 'dashboard',
}: {
  dataUrl: string
  timeZone?: string
  mode?: 'sms' | 'dashboard'
}): Promise<CalendarImageResult> {
  if (!hasCalendarImageUnderstanding()) {
    throw new Error('Photo reading needs OPENAI_API_KEY on the server.')
  }
  const isSmsMode = mode === 'sms'
  const structuredTimeoutMs = isSmsMode ? 4_000 : 12_000
  const secondaryTimeoutMs = isSmsMode ? 3_500 : 10_000
  const finalFallbackTimeoutMs = isSmsMode ? 2_500 : 10_000

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
      instructions: structuredImageInstructions(timeZone),
      userText: 'Read this image and extract the calendar event details.',
      timeoutMs: structuredTimeoutMs,
      body: {
        text: {
          format: {
            type: 'json_schema',
            name: 'manoa_calendar_image',
            strict: true,
            schema: calendarImageSchema(),
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

  if (isSmsMode && smsTexts.length > 1) {
    return {
      smsText: smsTexts[0] || null,
      smsTexts,
      events,
      confidence: payload.confidence,
      notes: payload.notes,
    }
  }

  let lineItemFailure: Error | null = null
  let lineItemLines: string[] = []
  let lineItemEvents: CalendarImageEvent[] = []

  try {
    const lineItemText = await openAiImageResponse({
      dataUrl,
      timeZone,
      instructions: lineItemImageInstructions(timeZone),
      userText: 'Read this image and return one rigid dated line per event.',
      timeoutMs: secondaryTimeoutMs,
      body: {},
    })

    lineItemLines = lineItemText ? lineItemFallbackLines(lineItemText) : []
    lineItemEvents = lineItemFallbackEvents(lineItemLines, timeZone)
  } catch (error) {
    lineItemFailure = error instanceof Error ? error : new Error('Line-item image parsing failed.')
    console.error('Line-item calendar image parsing failed.', {
      error: lineItemFailure.message,
    })
  }

  if (lineItemEvents.length > smsTexts.length && lineItemEvents.length >= 2) {
    return {
      smsText: lineItemEvents[0]?.smsText || null,
      smsTexts: lineItemEvents.map((event) => event.smsText),
      events: lineItemEvents,
      confidence: 'medium',
      notes: payload.notes,
    }
  }

  if (isSmsMode && smsTexts.length) {
    return {
      smsText: smsTexts[0] || null,
      smsTexts,
      events,
      confidence: payload.confidence,
      notes: payload.notes,
    }
  }

  if (smsTexts.length <= 1) {
    try {
      const listOutputText = await openAiImageResponse({
        dataUrl,
        timeZone,
        instructions: multiEventImageInstructions(timeZone),
        userText: 'Read this image and extract every separate dated calendar item you can clearly read.',
        timeoutMs: secondaryTimeoutMs,
        body: {
          text: {
            format: {
              type: 'json_schema',
              name: 'manoa_calendar_image',
              strict: true,
              schema: calendarImageSchema(),
            },
          },
        },
      })

      if (listOutputText) {
        const listPayload = JSON.parse(listOutputText) as CalendarImagePayload
        const listEvents = calendarImagePayloadToEvents(listPayload)
        const listSmsTexts = listEvents.map((event) => event.smsText)

        if (listSmsTexts.length > smsTexts.length) {
          payload = listPayload
          events = listEvents
          smsTexts = listSmsTexts
        }
      }
    } catch (error) {
      const listFailure = error instanceof Error ? error : new Error('List-focused image parsing failed.')
      console.error('List-focused calendar image parsing failed.', {
        error: listFailure.message,
      })
    }
  }

  let fallbackFailure: Error | null = null
  let fallbackSmsLines: string[] = []
  let fallbackEvents: CalendarImageEvent[] = []

  try {
    const fallbackText = await openAiImageResponse({
      dataUrl,
      timeZone,
      instructions: fallbackImageInstructions(timeZone),
      userText: 'Read this image and turn each clear event into one Manoa command line.',
      timeoutMs: finalFallbackTimeoutMs,
      body: {},
    })

    fallbackSmsLines = fallbackText ? fallbackSmsTexts(fallbackText) : []
    fallbackEvents = fallbackSmsEvents(fallbackSmsLines, timeZone)
  } catch (error) {
    fallbackFailure = error instanceof Error ? error : new Error('Fallback image parsing failed.')
    console.error('Fallback calendar image parsing failed.', {
      error: fallbackFailure.message,
    })
  }

  if (lineItemEvents.length > smsTexts.length && lineItemEvents.length >= 2) {
    return {
      smsText: lineItemEvents[0]?.smsText || null,
      smsTexts: lineItemEvents.map((event) => event.smsText),
      events: lineItemEvents,
      confidence: 'medium',
      notes: payload.notes,
    }
  }

  if (fallbackSmsLines.length > smsTexts.length && fallbackEvents.length >= Math.min(2, fallbackSmsLines.length)) {
    return {
      smsText: fallbackSmsLines[0] || null,
      smsTexts: fallbackSmsLines,
      events: fallbackEvents,
      confidence: 'medium',
      notes: payload.notes,
    }
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

  if (fallbackSmsLines.length) {
    return {
      smsText: fallbackSmsLines[0] || null,
      smsTexts: fallbackSmsLines,
      events: fallbackEvents,
      confidence: 'medium',
      notes: payload.notes,
    }
  }

  const meaningfulFailure = fallbackFailure || structuredFailure
  if ((lineItemFailure || meaningfulFailure) && /openai|api key|returned \d+|timed out/i.test((lineItemFailure || meaningfulFailure)!.message)) {
    throw (lineItemFailure || meaningfulFailure)!
  }

  return {
    smsText: null,
    smsTexts: [],
    events,
    confidence: payload.confidence,
    notes: payload.notes,
  }
}
