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
    'For poster-style flyers, use the main event name or headline as the title, not a weekday or a date fragment.\n' +
    'Items like "No School", birthdays, last day of school, graduations, games, and ceremonies should each become their own event if they have a date.\n' +
    'For reservations, hotel stays, campground stays, and travel confirmations, use the arrival date as the start date and the departure date as the final included calendar date when no time is shown.\n' +
    'If a timed event shows a range like "5:00 - 7:00 PM", use the first time as the event start and the full span as the duration.\n' +
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
    'For poster-style flyers, use the main event name or headline as the title, not a weekday or a date fragment.\n' +
    'Each dated line or block should become its own event.\n' +
    'If a timed event shows a range like "5:00 - 7:00 PM", use the first time as the event start and the full span as the duration.\n' +
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
    'For poster-style flyers, use the main event name or headline as the title, not a weekday or a date fragment.\n' +
    'For reservations, hotel stays, campground stays, and travel confirmations, include both arrival and departure dates.\n' +
    'If a timed event shows a range like "5:00 - 7:00 PM", use the first time as the event start and include the duration instead of the ending time as the start.\n' +
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
    'For poster-style flyers, use the main event name or headline as the title, not a weekday or a date fragment.\n' +
    'Return one line per clear dated event using this exact format:\n' +
    'DATE || TITLE || TIME_OR_ALL_DAY || LOCATION_OR_NOTES\n' +
    'If the flyer shows a time range, put the full range in TIME_OR_ALL_DAY, not just the ending time.\n' +
    'Use compact numeric dates like 5/20/2026.\n' +
    'If the event has no clear time, write ALL_DAY in the third field.\n' +
    'If a section heading provides the event title, use it as the title.\n' +
    'If the dated line adds detail, include it in TITLE or LOCATION_OR_NOTES.\n' +
    'If a month/day is clear but the year is missing, infer the next upcoming matching year.\n' +
    'Return only the lines. If there are no readable dated events, return exactly NO_EVENT.'
  )
}

function transcriptImageInstructions(timeZone: string) {
  return (
    `You transcribe visible text from photos and screenshots for Manoa, a calendar assistant.\n` +
    `Current timezone: ${timeZone}.\n` +
    `Current local date: ${currentLocalDateString(timeZone)}.\n` +
    'Return only the visible text from the image.\n' +
    'Preserve one line per visible line when possible.\n' +
    'Do not summarize, interpret, or label the text.\n' +
    'Do not add commentary.\n' +
    'If the image is unreadable, return exactly NO_EVENT.'
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

function parseClockTokenToMinutes(token: string, meridiem: 'am' | 'pm') {
  const match = cleanText(token).toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?$/)
  if (!match) return null
  let hour = Number(match[1]) % 12
  const minute = Number(match[2] || '0')
  if (meridiem === 'pm') hour += 12
  return hour * 60 + minute
}

function minutesTo24h(totalMinutes: number) {
  const minutes = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function extractTimeRangeDetails(text: string) {
  const match = text.match(
    /\b(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)?\b/i,
  )
  if (!match) return null

  let startSuffix = (match[2]?.toLowerCase() as 'am' | 'pm' | undefined) || undefined
  let endSuffix = (match[4]?.toLowerCase() as 'am' | 'pm' | undefined) || undefined
  if (!startSuffix && !endSuffix) return null

  const startHour = Number((match[1].match(/^\d{1,2}/) || ['0'])[0])
  const endHour = Number((match[3].match(/^\d{1,2}/) || ['0'])[0])

  if (!startSuffix && endSuffix) {
    startSuffix = endSuffix
    if (startHour > endHour) {
      startSuffix = endSuffix === 'pm' ? 'am' : 'pm'
    }
  }

  if (!endSuffix && startSuffix) {
    endSuffix = startSuffix
  }

  if (!startSuffix || !endSuffix) return null

  const startMinutes = parseClockTokenToMinutes(match[1], startSuffix)
  let endMinutes = parseClockTokenToMinutes(match[3], endSuffix)
  if (startMinutes == null || endMinutes == null) return null

  while (endMinutes <= startMinutes) {
    endMinutes += 12 * 60
    if (endMinutes - startMinutes > 12 * 60) break
  }

  const durationMinutes = endMinutes - startMinutes
  if (durationMinutes <= 0) return null

  return {
    startTime24h: minutesTo24h(startMinutes),
    endTime24h: minutesTo24h(endMinutes),
    durationMinutes,
  }
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
  const range = timeOrAllDay === 'ALL_DAY' ? null : extractTimeRangeDetails(parts[2])
  const time24h =
    timeOrAllDay === 'ALL_DAY' ? null : range?.startTime24h || parseTimeTo24h(parts[2])
  const isAllDay = timeOrAllDay === 'ALL_DAY'
  if (!isAllDay && !time24h) return null

  const dateYmd = ymdFromDate(date, timeZone)
  const location = locationOrNotes || null
  const smsText = isAllDay
    ? `add ${title} on ${displayDate(dateYmd)} all day${location ? ` at ${location}` : ''}`
    : `add ${title} on ${displayDate(dateYmd)} at ${displayTime(time24h)}${location ? ` at ${location}` : ''}${range?.durationMinutes ? ` for ${range.durationMinutes} minutes` : ''}`

  return {
    title,
    dateYmd,
    endDateYmd: null,
    time24h,
    isAllDay,
    durationMinutes: range?.durationMinutes || null,
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

const transcriptMonthNameSource =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const transcriptWeekdaySource =
  'sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday|rday)?|fri(?:day)?|sat(?:urday)?'
const transcriptDatePrefixPattern = new RegExp(
  `^\\s*(?:${transcriptWeekdaySource}\\s+)?((?:${transcriptMonthNameSource})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${transcriptMonthNameSource})\\.?\\b(?:,?\\s+\\d{4})?)\\*?\\s*(?:[-:–—]\\s*)?(.*)$`,
  'i',
)
const transcriptDateAnywherePattern = new RegExp(
  `(?:${transcriptWeekdaySource}\\s+)?((?:${transcriptMonthNameSource})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${transcriptMonthNameSource})\\.?\\b(?:,?\\s+\\d{4})?)\\*?`,
  'ig',
)
const transcriptWeekdayOnlyPattern = new RegExp(`^\\s*(?:${transcriptWeekdaySource})\\s*$`, 'i')

function normalizeTranscriptLine(line: string) {
  return cleanText(
    line
      .replace(/```[a-z]*\n?/gi, '')
      .replace(/```/g, '')
      .replace(/^[•*\-]+\s*/, '')
      .replace(/\s+/g, ' '),
  )
}

function isGenericTranscriptHeading(line: string) {
  return /\b(important dates?|preschool|school calendar|newsletter|upcoming events?)\b/i.test(line)
}

function isStandaloneWeekdayLine(line: string) {
  return transcriptWeekdayOnlyPattern.test(line)
}

function looksTimeOnlyLine(line: string) {
  const cleaned = line.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!cleaned) return false
  if (!/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(cleaned)) return false
  return !/[a-z]{3,}.*\b(?:street|st|road|rd|drive|dr|avenue|ave|boulevard|blvd|lane|ln|court|ct|highway|hwy|parkway|pkwy|suite|level|room|center|centre|library|museum|school|church|gym|field|park)\b/i.test(
    cleaned,
  )
}

function looksLocationLine(line: string) {
  return /\b(center|centre|library|museum|school|church|gym|field|park|hall|campus|campground|auditorium|room|suite|level|drive|dr|street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|court|ct|highway|hwy|wisconsin|wi)\b/i.test(
    line,
  )
}

function looksAddressLikeLine(line: string) {
  return /^\d{2,}\s+.+\b(?:street|st|road|rd|drive|dr|avenue|ave|boulevard|blvd|lane|ln|court|ct|highway|hwy)\b/i.test(
    line,
  )
}

function extractLocationFromSupportingLines(lines: string[]) {
  const startIndex = lines.findIndex((line) => looksLocationLine(line) || looksAddressLikeLine(line))
  if (startIndex === -1) return null

  const collected: string[] = []
  for (let index = startIndex; index < lines.length && collected.length < 2; index += 1) {
    const line = lines[index]
    if (!line || looksTimeOnlyLine(line)) continue
    if (
      collected.length > 0 &&
      !looksLocationLine(line) &&
      !looksAddressLikeLine(line) &&
      !/^[A-Z][A-Z\s,&-]{4,}$/i.test(line)
    ) {
      break
    }
    collected.push(line)
  }

  const combined = cleanText(collected.join(', '))
  return combined || null
}

function extractVisibleTimes(text: string) {
  return Array.from(
    new Set(
      (text.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi) || [])
        .map((value) => parseTimeTo24h(value))
        .filter((value): value is string => Boolean(value)),
    ),
  )
}

function looksTranscriptHeading(line: string) {
  if (!line || parseExplicitDate(line) || isStandaloneWeekdayLine(line)) return false
  const stripped = line.replace(/[!:.]/g, '').trim()
  if (!stripped) return false
  const lettersOnly = stripped.replace(/[^A-Za-z]/g, '')
  if (lettersOnly.length < 3) return false
  return stripped === stripped.toUpperCase()
}

function parseTranscriptEvents(outputText: string, timeZone: string) {
  const lines = outputText
    .split(/\r?\n+/)
    .map((line) => normalizeTranscriptLine(line))
    .filter(Boolean)
    .filter((line) => !/^no_event$/i.test(line))

  const events: CalendarImageEvent[] = []
  let currentHeading: string | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (looksTranscriptHeading(line)) {
      currentHeading = isGenericTranscriptHeading(line) ? null : line
      continue
    }

    const match = line.match(transcriptDatePrefixPattern)
    if (!match) continue

    const dateText = cleanText(match[1])
    const remainder = cleanText((match[2] || '').replace(/\*+/g, ''))
    const date = parseExplicitDate(dateText, timeZone)
    if (!date) continue

    const supportingLines: string[] = []
    for (let offset = index + 1; offset < lines.length && supportingLines.length < 3; offset += 1) {
      const candidate = lines[offset]
      if (!candidate) break
      if (looksTranscriptHeading(candidate)) break
      if (candidate.match(transcriptDatePrefixPattern)) break
      supportingLines.push(candidate)
    }

    const supportingText = [remainder, ...supportingLines].filter(Boolean).join(' ')
    let title = ''
    let notes: string | null = null

    if ((remainder.startsWith('(') || !remainder || looksTimeOnlyLine(remainder) || looksLocationLine(remainder)) && currentHeading) {
      title = currentHeading
      notes = cleanText(remainder.replace(/^\((.*)\)$/, '$1') || supportingText) || null
    } else if (remainder.includes('(')) {
      const [beforeParen, ...rest] = remainder.split('(')
      title = cleanText(beforeParen)
      const noteText = cleanText(rest.join('(').replace(/\)+$/, ''))
      notes = noteText || null
    } else {
      title = remainder
    }

    if (!title) title = currentHeading || 'event'

    const detailText = [line, ...supportingLines].join(' ')
    const visibleTimeRange = extractTimeRangeDetails(detailText)
    const visibleTimes = visibleTimeRange ? [visibleTimeRange.startTime24h] : extractVisibleTimes(detailText)
    const location = extractLocationFromSupportingLines(supportingLines)

    const isAllDay = visibleTimes.length === 0
    const time24h = isAllDay ? null : visibleTimes[0]
    const dateYmd = ymdFromDate(date, timeZone)
    const smsText = isAllDay
      ? `add ${title} on ${displayDate(dateYmd)} all day${location ? ` at ${location}` : ''}`
      : `add ${title} on ${displayDate(dateYmd)} at ${displayTime(time24h)}${location ? ` at ${location}` : ''}${visibleTimeRange?.durationMinutes ? ` for ${visibleTimeRange.durationMinutes} minutes` : ''}`

    events.push({
      title,
      dateYmd,
      endDateYmd: null,
      time24h,
      isAllDay,
      durationMinutes: visibleTimeRange?.durationMinutes || null,
      location,
      organizerOrSource: null,
      itemType: 'school',
      isConfirmedOrFixed: true,
      confidence: 'medium',
      notes,
      smsText,
    })
  }

  return events
}

function parseTranscriptEventsFromBlocks(outputText: string, timeZone: string) {
  const text = cleanText(
    outputText
      .replace(/```[a-z]*\n?/gi, '')
      .replace(/```/g, '')
      .replace(/\r?\n+/g, '\n'),
  )
  if (!text || /^no_event$/i.test(text)) return []

  const lines = outputText
    .split(/\r?\n+/)
    .map((line) => normalizeTranscriptLine(line))
    .filter(Boolean)
    .filter((line) => !/^no_event$/i.test(line))

  const headingCandidates = lines.filter(looksTranscriptHeading).map((line) =>
    isGenericTranscriptHeading(line) ? null : line,
  )
  let currentHeading: string | null = null
  const events: CalendarImageEvent[] = []
  const seen = new Set<string>()

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    if (looksTranscriptHeading(line)) {
      currentHeading = isGenericTranscriptHeading(line) ? null : line
      continue
    }

    const matches = Array.from(line.matchAll(transcriptDateAnywherePattern))
    if (!matches.length) continue

    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index]
      const dateText = cleanText(match[1])
      const date = parseExplicitDate(dateText, timeZone)
      if (!date) continue

      const matchStart = match.index || 0
      const matchEnd = matchStart + match[0].length
      const nextMatchStart = index + 1 < matches.length ? matches[index + 1].index || line.length : line.length

      const prefix = cleanText(line.slice(0, matchStart).replace(/[:\-–—]+$/, ''))
      const remainder = cleanText(line.slice(matchEnd, nextMatchStart).replace(/^[:\-–—)\]]+\s*/, ''))

      const inlineHeading =
        prefix && looksTranscriptHeading(prefix) && !isGenericTranscriptHeading(prefix) ? prefix : null
      const heading = inlineHeading || currentHeading || null

      const supportingLines: string[] = []
      for (let offset = lineIndex + 1; offset < lines.length && supportingLines.length < 3; offset += 1) {
        const candidate = lines[offset]
        if (!candidate) break
        if (looksTranscriptHeading(candidate)) break
        if (candidate.match(transcriptDatePrefixPattern)) break
        supportingLines.push(candidate)
      }

      let title = ''
      let notes: string | null = null

      if ((remainder.startsWith('(') || !remainder || looksTimeOnlyLine(remainder) || looksLocationLine(remainder)) && heading) {
        title = heading
        notes = cleanText(remainder.replace(/^\((.*)\)$/, '$1') || [remainder, ...supportingLines].join(' ')) || null
      } else if (heading && remainder) {
        title = heading
        notes = remainder
      } else if (remainder.includes('(')) {
        const [beforeParen, ...rest] = remainder.split('(')
        title = cleanText(beforeParen)
        const noteText = cleanText(rest.join('(').replace(/\)+$/, ''))
        notes = noteText || null
      } else {
        title = remainder
      }

      if (!title) title = heading || 'event'

      const detailText = [remainder, ...supportingLines].join(' ')
      const visibleTimeRange = extractTimeRangeDetails(detailText)
      const visibleTimes = visibleTimeRange ? [visibleTimeRange.startTime24h] : extractVisibleTimes(detailText)
      const location = extractLocationFromSupportingLines(supportingLines)

      const isAllDay = visibleTimes.length === 0
      const time24h = isAllDay ? null : visibleTimes[0]
      const dateYmd = ymdFromDate(date, timeZone)
      const key = `${dateYmd}::${title.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)

      events.push({
        title,
        dateYmd,
        endDateYmd: null,
        time24h,
        isAllDay,
        durationMinutes: visibleTimeRange?.durationMinutes || null,
        location,
        organizerOrSource: null,
        itemType: 'school',
        isConfirmedOrFixed: true,
        confidence: 'medium',
        notes,
        smsText: isAllDay
          ? `add ${title} on ${displayDate(dateYmd)} all day${location ? ` at ${location}` : ''}`
          : `add ${title} on ${displayDate(dateYmd)} at ${displayTime(time24h)}${location ? ` at ${location}` : ''}${visibleTimeRange?.durationMinutes ? ` for ${visibleTimeRange.durationMinutes} minutes` : ''}`,
      })
    }
  }

  return events
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
  const visibleTimeRange = extractTimeRangeDetails(sourceText)
  const looksTravelReservation =
    item.item_type === 'travel' || looksTravelReservationText(sourceText)
  const hasDateRange = Boolean(endDate && endDate !== date)
  const isAllDay = Boolean(
    (item.is_all_day || (looksTravelReservation && hasDateRange)) &&
      !visibleTimeRange,
  )
  const isConfirmedOrFixed = Boolean(
    item.is_confirmed_or_fixed ||
      (looksTravelReservation &&
        /\b(reservation|confirmed|confirmation|itinerary|booking|arrival|departure)\b/i.test(sourceText)),
  )
  const resolvedTime = isAllDay ? null : item.time_24h || visibleTimeRange?.startTime24h || null
  const resolvedDuration =
    item.duration_minutes && item.duration_minutes > 0
      ? item.duration_minutes
      : visibleTimeRange?.durationMinutes || null
  const time = displayTime(resolvedTime)
  if (!time && !isAllDay) return null

  const duration = resolvedDuration && resolvedDuration > 0
    ? ` for ${resolvedDuration} minutes`
    : ''

  const prefix = isConfirmedOrFixed ? 'add' : 'schedule'
  const smsText = isAllDay
    ? `${prefix} ${title}${endDate && endDate !== date ? ` from ${date} to ${endDate}` : ` on ${date}`} all day${location ? ` at ${location}` : ''}`
    : `${prefix} ${title} on ${date} at ${time}${location ? ` at ${location}` : ''}${duration}`

  return {
    title,
    dateYmd: item.date_ymd as string,
    endDateYmd: item.end_date_ymd || null,
    time24h: isAllDay ? null : resolvedTime,
    isAllDay,
    durationMinutes: resolvedDuration,
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
  const structuredTimeoutMs = isSmsMode ? 5_500 : 12_000
  const secondaryTimeoutMs = isSmsMode ? 4_500 : 10_000
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

  if (isSmsMode) {
    let transcriptFailure: Error | null = null

    try {
      const transcriptText = await openAiImageResponse({
        dataUrl,
        timeZone,
        instructions: transcriptImageInstructions(timeZone),
        userText: 'Transcribe the visible text from this image.',
        timeoutMs: secondaryTimeoutMs,
        body: {},
      })

      const transcriptEvents = transcriptText
        ? (() => {
            const lineEvents = parseTranscriptEvents(transcriptText, timeZone)
            if (lineEvents.length >= 2) return lineEvents
            const blockEvents = parseTranscriptEventsFromBlocks(transcriptText, timeZone)
            return blockEvents.length > lineEvents.length ? blockEvents : lineEvents
          })()
        : []

      if (transcriptEvents.length) {
        return {
          smsText: transcriptEvents[0]?.smsText || null,
          smsTexts: transcriptEvents.map((event) => event.smsText),
          events: transcriptEvents,
          confidence: 'medium',
          notes: payload.notes,
        }
      }
    } catch (error) {
      transcriptFailure = error instanceof Error ? error : new Error('Transcript image parsing failed.')
      console.error('Transcript calendar image parsing failed.', {
        error: transcriptFailure.message,
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

    const meaningfulFailure = transcriptFailure || structuredFailure
    if (meaningfulFailure && /openai|api key|returned \d+|timed out|aborted/i.test(meaningfulFailure.message)) {
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

  try {
    const transcriptText = await openAiImageResponse({
      dataUrl,
      timeZone,
      instructions: transcriptImageInstructions(timeZone),
      userText: 'Transcribe the visible text from this image.',
      timeoutMs: finalFallbackTimeoutMs,
      body: {},
    })

    const transcriptEvents = transcriptText
      ? (() => {
          const lineEvents = parseTranscriptEvents(transcriptText, timeZone)
          if (lineEvents.length >= 2) return lineEvents
          const blockEvents = parseTranscriptEventsFromBlocks(transcriptText, timeZone)
          return blockEvents.length > lineEvents.length ? blockEvents : lineEvents
        })()
      : []
    if (transcriptEvents.length > smsTexts.length && transcriptEvents.length >= 2) {
      return {
        smsText: transcriptEvents[0]?.smsText || null,
        smsTexts: transcriptEvents.map((event) => event.smsText),
        events: transcriptEvents,
        confidence: 'medium',
        notes: payload.notes,
      }
    }
  } catch (error) {
    const transcriptFailure = error instanceof Error ? error : new Error('Transcript image parsing failed.')
    console.error('Transcript calendar image parsing failed.', {
      error: transcriptFailure.message,
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
