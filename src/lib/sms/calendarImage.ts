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

export type CalendarImageMode =
  | 'single_screenshot'
  | 'list_flyer'
  | 'poster'
  | 'social_post'

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
  mode: CalendarImageMode
  needsClarification?: boolean
  needsTimeClarification?: boolean
  needsTitleClarification?: boolean
}

function buildCalendarImageSmsText(event: Omit<CalendarImageEvent, 'smsText'>) {
  const date = displayDate(event.dateYmd)
  const endDate = displayDate(event.endDateYmd)
  if (!date) return null

  const prefix = event.isConfirmedOrFixed ? 'add' : 'schedule'
  if (event.isAllDay) {
    return `${prefix} ${event.title}${endDate && endDate !== date ? ` from ${date} to ${endDate}` : ` on ${date}`} all day${event.location ? ` at ${event.location}` : ''}`
  }

  const time = displayTime(event.time24h)
  if (!time) return null

  const duration =
    event.durationMinutes && event.durationMinutes > 0
      ? ` for ${event.durationMinutes} minutes`
      : ''

  return `${prefix} ${event.title} on ${date} at ${time}${event.location ? ` at ${event.location}` : ''}${duration}`
}

function enrichSingleEventLocationFromTranscript(
  events: CalendarImageEvent[],
  transcriptText: string,
) {
  if (events.length !== 1) return events

  const [event] = events
  if (event.location) return events

  const transcriptLocation = extractLocationFromFreeformText(transcriptText)
  if (!transcriptLocation) return events

  const enrichedEvent: CalendarImageEvent = {
    ...event,
    location: transcriptLocation,
    smsText:
      buildCalendarImageSmsText({
        title: event.title,
        dateYmd: event.dateYmd,
        endDateYmd: event.endDateYmd,
        time24h: event.time24h,
        isAllDay: event.isAllDay,
        durationMinutes: event.durationMinutes,
        location: transcriptLocation,
        organizerOrSource: event.organizerOrSource,
        itemType: event.itemType,
        isConfirmedOrFixed: event.isConfirmedOrFixed,
        confidence: event.confidence,
        notes: event.notes,
      }) || event.smsText,
  }

  return [enrichedEvent]
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

function singleScreenshotImageInstructions(timeZone: string) {
  return (
    `You read photos and screenshots for Manoa, a calendar assistant.\n` +
    `Current timezone: ${timeZone}.\n` +
    `Current local date: ${currentLocalDateString(timeZone)}.\n` +
    'Extract one clear calendar event from a screenshot, invitation card, reminder card, calendar-event screenshot, email screenshot, or text screenshot.\n' +
    'Focus on the event details, not the surrounding app chrome.\n' +
    'Use the obvious event title, not the organizer, sender, account name, or app name.\n' +
    'Do not use generic titles like "Event", "Meeting", or "Appointment" unless that is literally the visible event name.\n' +
    'For reservations, hotel stays, campground stays, and travel confirmations, use the reservation name as the title when visible.\n' +
    'If a timed event shows a range like "5:00 - 7:00 PM", use the first time as the event start and the full span as the duration.\n' +
    'If no event time is shown but the item clearly spans full dates, mark it as all-day. Otherwise do not invent a time.\n' +
    'If a month/day/time is clear but the year is missing, infer the next upcoming matching year from the current local date.\n' +
    'If the image really contains multiple unrelated events, return only the most obvious main event.\n' +
    'Do not invent a date, time, or location that is not visible or strongly implied.\n' +
    'Use has_calendar_items=false only when no real event can be extracted.'
  )
}

function listFlyerImageInstructions(timeZone: string) {
  return (
    `You read photos and screenshots for Manoa, a calendar assistant.\n` +
    `Current timezone: ${timeZone}.\n` +
    `Current local date: ${currentLocalDateString(timeZone)}.\n` +
    'This image is a list, flyer, newsletter, school notice, church bulletin, or important-dates sheet.\n' +
    'Extract every separate dated calendar item you can clearly read, not just the most prominent one.\n' +
    'For each event, use the clearest event title from the dated line or its section heading, not the organization name.\n' +
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

function posterImageInstructions(timeZone: string) {
  return (
    `You read photos and screenshots for Manoa, a calendar assistant.\n` +
    `Current timezone: ${timeZone}.\n` +
    `Current local date: ${currentLocalDateString(timeZone)}.\n` +
    'This image is a poster or event flyer for one main event.\n' +
    'Use the main event headline as the title.\n' +
    'Do not use the organization, venue, sponsor, or department name as the title unless it is also the visible event headline.\n' +
    'Prefer event titles like "Family Night", "Coffee Talk", "Veterans Powwow", or "Fry Bread Contest" over organization names.\n' +
    'Read the date carefully. If the poster shows one event date, use that exact date.\n' +
    'If a timed event shows a range like "5:00 - 7:00 PM", use the first time as the event start and the full span as the duration.\n' +
    'If the poster shows multiple-day coverage without times, mark it all-day across the full span.\n' +
    'Do not invent a date, time, or location that is not visible or strongly implied.\n' +
    'Use has_calendar_items=false only when no real event can be extracted.'
  )
}

function socialPostImageInstructions(timeZone: string) {
  return (
    `You read photos and screenshots for Manoa, a calendar assistant.\n` +
    `Current timezone: ${timeZone}.\n` +
    `Current local date: ${currentLocalDateString(timeZone)}.\n` +
    'This image is a social post screenshot that contains one main event.\n' +
    'Ignore app chrome, tabs, page names, buttons, like counts, comments, and navigation.\n' +
    'Use the event name from the post or flyer, not the Facebook page name, organization name, or app UI.\n' +
    'Read the event date, time, and location from the post body or embedded flyer.\n' +
    'If a timed event shows a range like "12 - 2 PM", use the first time as the event start and the full span as the duration.\n' +
    'Do not invent a date, time, or location that is not visible or strongly implied.\n' +
    'Use has_calendar_items=false only when no real event can be extracted.'
  )
}

function structuredImageInstructionsForMode(mode: CalendarImageMode, timeZone: string) {
  if (mode === 'list_flyer') return listFlyerImageInstructions(timeZone)
  if (mode === 'poster') return posterImageInstructions(timeZone)
  if (mode === 'social_post') return socialPostImageInstructions(timeZone)
  return singleScreenshotImageInstructions(timeZone)
}

function multiEventImageInstructions(timeZone: string) {
  return structuredImageInstructionsForMode('list_flyer', timeZone)
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
    'This image is a school flyer, preschool notice, church bulletin, newsletter, invitation, or important-dates sheet.\n' +
    'For each line, use the clearest event title from the dated line or section heading, not the organization name.\n' +
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
  const location = locationOrNotes || extractLocationFromFreeformText(locationOrNotes) || null
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

function transcriptLines(outputText: string) {
  return outputText
    .split(/\r?\n+/)
    .map((line) => normalizeTranscriptLine(line))
    .filter(Boolean)
    .filter((line) => !/^no_event$/i.test(line))
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
const transcriptDateRangePattern = new RegExp(
  `\\b(${transcriptMonthNameSource})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|—|to)\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
  'i',
)
const transcriptWeekdayOnlyPattern = new RegExp(`^\\s*(?:${transcriptWeekdaySource})\\s*$`, 'i')
const headingPositivePattern =
  /\b(night|party|celebration|graduation|ceremony|meeting|game|camp|recital|concert|show|showcase|festival|fair|picnic|lunch|dinner|breakfast|open house|clinic|workshop|class|tournament|practice|birthday|reunion|conference|family|no school|powwow|contest|talk|reservation|vacation|trip)\b/i
const headingNegativePattern =
  /\b(language|culture|native americans|advisory|association|foundation|office|department|district|committee|library|museum|center|centre|campus|tribal|nation|council|wisconsin|services|potawatomi|facebook|instagram)\b/i
const socialUiPattern =
  /\b(posts?|about|reels?|likes?|comments?|shares?|followers?|following|message|messages|home|menu|photos?|videos?|stories|notifications?|sponsored|see more|write a comment|post)\b/i
const titleNegativePhrasePattern =
  /\b(open to|for information|questions\??|sponsored by|activities to include|committee specials|men'?s specials|women'?s specials|host drum|co-host drum|grand entry|vendors|for more info|arena director)\b/i

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

function looksSocialUiLine(line: string) {
  const normalized = cleanText(line)
  if (!normalized) return false
  if (socialUiPattern.test(normalized)) return true
  if (/^[A-Za-z]+\s*[›>]\s*[A-Za-z]/.test(normalized)) return true
  if (/^[A-Za-z]+\s+\d+[mhds]?$/i.test(normalized)) return true
  return false
}

function looksContactLine(line: string) {
  return /\b(?:www\.|https?:\/\/|@[a-z0-9._-]+\.[a-z]{2,}|\d{3}[-.)\s]*\d{3}[-.\s]*\d{4})\b/i.test(line)
}

function containsTranscriptDate(line: string, timeZone?: string) {
  if (parseExplicitDate(line, timeZone)) return true
  if (transcriptDatePrefixPattern.test(line)) return true
  return Array.from(line.matchAll(transcriptDateAnywherePattern)).length > 0
}

function genericEventTitle(value: string) {
  return /^(event|meeting|appointment|party|school|sports|travel|deadline|other)$/i.test(cleanText(value))
}

function scoreEventTitleCandidate(line: string, mode: CalendarImageMode) {
  const normalized = cleanText(line)
  if (!normalized) return Number.NEGATIVE_INFINITY
  if (genericEventTitle(normalized)) return -12
  if (looksSocialUiLine(normalized)) return -12
  if (looksContactLine(normalized)) return -10
  if (containsTranscriptDate(normalized)) return -8
  if (looksTimeOnlyLine(normalized)) return -8
  if (looksLocationLine(normalized) || looksAddressLikeLine(normalized)) return -10
  if (isGenericTranscriptHeading(normalized)) return -10

  const words = normalized.split(/\s+/)
  let score = 0

  if (words.length >= 1 && words.length <= 6) score += 3
  if (normalized.length >= 4 && normalized.length <= 36) score += 3
  if (headingPositivePattern.test(normalized)) score += 8
  if (headingNegativePattern.test(normalized) && !headingPositivePattern.test(normalized)) score -= 8
  if (/[A-Za-z]/.test(normalized) && normalized === normalized.toUpperCase()) score += 1
  if (/^[A-Z][a-z0-9'&/-]+(?:\s+[A-Z][a-z0-9'&/-]+){0,5}$/.test(normalized)) score += 2

  if (mode === 'poster' && looksTranscriptHeading(normalized)) score += 2
  if (mode === 'social_post' && !looksTranscriptHeading(normalized)) score += 1
  if (mode === 'single_screenshot' && words.length <= 5) score += 1

  return score
}

function chooseBestEventTitleCandidate(candidates: string[], mode: CalendarImageMode) {
  let best: string | null = null
  let bestScore = Number.NEGATIVE_INFINITY

  for (const candidate of candidates) {
    const score = scoreEventTitleCandidate(candidate, mode)
    if (score > bestScore) {
      best = cleanText(candidate)
      bestScore = score
    }
  }

  return best && bestScore > 1 ? best : null
}

function isWeakCalendarImageTitle(value: string | null | undefined, mode?: CalendarImageMode) {
  const normalized = cleanText(value)
  if (!normalized) return true
  if (genericEventTitle(normalized)) return true
  if (scoreEventTitleCandidate(normalized, mode || 'single_screenshot') <= 1) return true
  return false
}

function classifyCalendarImageMode(transcriptText: string, timeZone: string): CalendarImageMode {
  const lines = transcriptLines(transcriptText)
  if (!lines.length) return 'single_screenshot'

  const fullText = lines.join('\n')
  const datedLines = lines.filter((line) => containsTranscriptDate(line, timeZone))
  const topHeadingLines = lines.slice(0, 8).filter((line) => looksTranscriptHeading(line))
  const socialUiLines = lines.filter((line) => looksSocialUiLine(line))
  const hasSocialUi =
    socialUiLines.length >= 2 ||
    socialUiLines.some((line) =>
      /\b(posts?|reels?|likes?|comments?|followers?|following|message|messages|stories|see more|write a comment)\b/i.test(
        line,
      ),
    )
  const hasImportantDates = /\bimportant dates?|no school|last day of school|upcoming events?\b/i.test(fullText)

  if (hasSocialUi) return 'social_post'
  if (hasImportantDates || datedLines.length >= 2) return 'list_flyer'
  if (extractPosterDateSpan(lines, timeZone) || (datedLines.length === 1 && topHeadingLines.length >= 1)) {
    return 'poster'
  }

  return 'single_screenshot'
}

function strongerConfidence(
  left: CalendarImagePayload['confidence'],
  right: CalendarImagePayload['confidence'],
): CalendarImagePayload['confidence'] {
  const rank = { low: 0, medium: 1, high: 2 }
  return rank[left] >= rank[right] ? left : right
}

function looksLikelyTitleLine(line: string, mode: CalendarImageMode) {
  const normalized = cleanText(line)
  if (!normalized) return false
  if (looksSocialUiLine(normalized)) return false
  if (looksContactLine(normalized)) return false
  if (containsTranscriptDate(normalized)) return false
  if (looksTimeOnlyLine(normalized)) return false
  if (looksLocationLine(normalized) || looksAddressLikeLine(normalized)) return false
  if (isGenericTranscriptHeading(normalized)) return false
  if (titleNegativePhrasePattern.test(normalized)) return false
  if (mode === 'poster' && normalized.length > 52 && !headingPositivePattern.test(normalized)) return false
  return /[a-z]/i.test(normalized)
}

function transcriptTitleCandidates(lines: string[], mode: CalendarImageMode) {
  const filtered = lines.filter((line) => looksLikelyTitleLine(line, mode))
  const limited = filtered.slice(0, mode === 'social_post' ? 18 : 12)
  const candidates: string[] = []

  for (let index = 0; index < limited.length; index += 1) {
    const line = limited[index]
    candidates.push(line)

    const next = limited[index + 1]
    if (!next) continue

    const combined = cleanText(`${line} ${next}`)
    if (!combined) continue
    if (combined.split(/\s+/).length > 6) continue
    if (titleNegativePhrasePattern.test(combined)) continue

    const lineScore = scoreEventTitleCandidate(line, mode)
    const nextScore = scoreEventTitleCandidate(next, mode)
    const combinedScore = scoreEventTitleCandidate(combined, mode)
    if (combinedScore >= Math.max(lineScore, nextScore)) {
      candidates.push(combined)
    }
  }

  return Array.from(new Set(candidates.map((candidate) => cleanText(candidate)).filter(Boolean)))
}

function cleanTranscriptEventTitle(
  rawTitle: string | null | undefined,
  mode: CalendarImageMode,
  fallbackCandidates: string[] = [],
) {
  const candidates = [rawTitle, ...fallbackCandidates]
    .map((candidate) => cleanText(candidate))
    .filter(Boolean)
  if (!candidates.length) return null

  const best = chooseBestEventTitleCandidate(candidates, mode)
  if (best) return best

  const primary = cleanText(rawTitle)
  if (primary && !isWeakCalendarImageTitle(primary, mode)) return primary
  return null
}

function findFirstTranscriptDateYmd(lines: string[], timeZone: string) {
  for (const line of lines) {
    const directDate = parseExplicitDate(line, timeZone)
    if (directDate) return ymdFromDate(directDate, timeZone)

    const prefixMatch = line.match(transcriptDatePrefixPattern)
    if (prefixMatch) {
      const prefixDate = parseExplicitDate(cleanText(prefixMatch[1]), timeZone)
      if (prefixDate) return ymdFromDate(prefixDate, timeZone)
    }

    for (const match of Array.from(line.matchAll(transcriptDateAnywherePattern))) {
      const inlineDate = parseExplicitDate(cleanText(match[1]), timeZone)
      if (inlineDate) return ymdFromDate(inlineDate, timeZone)
    }
  }

  return null
}

function extractRelevantVisibleTimes(lines: string[]) {
  const relevantLines = lines.filter((line) => {
    const normalized = cleanText(line)
    if (!normalized) return false
    if (looksSocialUiLine(normalized)) return false
    if (/^(?:today|yesterday)\s+\d{1,2}:\d{2}(?:\s*[ap]m)?$/i.test(normalized)) return false
    if (/^\d{1,2}:\d{2}(?:\s*[ap]m)?$/i.test(normalized)) return false
    return true
  })

  const relevantText = relevantLines.join(' ')
  const visibleTimeRange = extractTimeRangeDetails(relevantText)
  const visibleTimes = visibleTimeRange
    ? [visibleTimeRange.startTime24h]
    : extractVisibleTimes(relevantText)

  return {
    visibleTimeRange,
    visibleTimes,
  }
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

function normalizeLocationText(text: string) {
  return cleanText(
    text
      .replace(/[•|]+/g, ', ')
      .replace(/\s+-\s+/g, ' - ')
      .replace(/\s*,\s*/g, ', '),
  )
}

function extractAddressFromText(text: string) {
  const normalized = normalizeLocationText(text)
  const match = normalized.match(
    /\b\d{2,}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,8}\s+(?:street|st|road|rd|drive|dr|avenue|ave|boulevard|blvd|lane|ln|court|ct|highway|hwy|parkway|pkwy)\b(?:[^.;\n]*)/i,
  )
  return match ? cleanText(match[0]) : null
}

function extractLocationFromFreeformText(text: string) {
  const lines = text
    .split(/\r?\n+/)
    .map((line) => normalizeLocationText(line))
    .filter(Boolean)

  if (!lines.length) return null

  const directAddress = extractAddressFromText(lines.join('\n'))
  const venueIndex = lines.findIndex((line) => looksLocationLine(line) && !looksTimeOnlyLine(line))

  if (directAddress && venueIndex >= 0) {
    const venue = lines[venueIndex]
    if (venue && !venue.includes(directAddress)) {
      return cleanText(`${venue}, ${directAddress}`)
    }
  }

  if (directAddress) return directAddress

  const venueLine = lines.find((line) => looksLocationLine(line) && !looksTimeOnlyLine(line))
  return venueLine || null
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

  const combined = normalizeLocationText(collected.join(', '))
  return combined || extractLocationFromFreeformText(lines.join('\n'))
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

function scoreHeadingCandidate(line: string) {
  const normalized = cleanText(line)
  if (!normalized) return Number.NEGATIVE_INFINITY
  if (/\d/.test(normalized)) return -4

  const words = normalized.split(/\s+/)
  let score = 0

  if (words.length >= 1 && words.length <= 4) score += 2
  if (normalized.length >= 6 && normalized.length <= 28) score += 2
  if (headingPositivePattern.test(normalized)) score += 6
  if (headingNegativePattern.test(normalized)) score -= 5
  if (looksLocationLine(normalized) || looksAddressLikeLine(normalized)) score -= 6
  if (isGenericTranscriptHeading(normalized)) score -= 6

  return score
}

function chooseBestHeadingCandidate(candidates: string[]) {
  let best: string | null = null
  let bestScore = Number.NEGATIVE_INFINITY

  for (const candidate of candidates) {
    const score = scoreHeadingCandidate(candidate)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }

  if (best && bestScore > 0) return best
  return candidates[candidates.length - 1] || null
}

function extractPosterHeadline(lines: string[]) {
  const headingLines = lines
    .slice(0, 10)
    .filter((line) => looksTranscriptHeading(line) && !isGenericTranscriptHeading(line))

  if (!headingLines.length) return null

  const candidates: string[] = []
  for (let index = 0; index < headingLines.length; index += 1) {
    const single = headingLines[index]
    if (single) candidates.push(single)
    const next = headingLines[index + 1]
    if (single && next) candidates.push(`${single} ${next}`)
  }

  return chooseBestHeadingCandidate(candidates)
}

function extractPosterDateSpan(lines: string[], timeZone: string) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(transcriptDateRangePattern)
    if (!match) continue

    const month = match[1]
    const startDay = match[2]
    const endDay = match[3]
    const inlineYear = match[4]
    const nextLine = lines[index + 1] || ''
    const carriedYear = /^\d{4}$/.test(nextLine) ? nextLine : null
    const year = inlineYear || carriedYear || undefined

    const start = parseExplicitDate(`${month} ${startDay}${year ? ` ${year}` : ''}`, timeZone)
    const end = parseExplicitDate(`${month} ${endDay}${year ? ` ${year}` : ''}`, timeZone)
    if (!start || !end) continue

    return {
      startYmd: ymdFromDate(start, timeZone),
      endYmd: ymdFromDate(end, timeZone),
    }
  }

  return null
}

function createCalendarImageEvent(
  event: Omit<CalendarImageEvent, 'smsText'>,
): CalendarImageEvent | null {
  const smsText = buildCalendarImageSmsText(event)
  if (!smsText) return null

  return {
    ...event,
    smsText,
  }
}

function parseTranscriptSingleEvent(
  outputText: string,
  timeZone: string,
  mode: CalendarImageMode,
) {
  const lines = transcriptLines(outputText)
  if (!lines.length) return null

  const fallbackCandidates = transcriptTitleCandidates(lines, mode)
  const title = cleanTranscriptEventTitle(
    mode === 'poster' ? extractPosterHeadline(lines) : chooseBestEventTitleCandidate(fallbackCandidates, mode),
    mode,
    fallbackCandidates,
  )
  if (!title) return null

  const dateSpan = extractPosterDateSpan(lines, timeZone)
  const fullText = lines.join('\n')
  const location =
    extractLocationFromSupportingLines(lines) ||
    extractLocationFromFreeformText(fullText)

  if (dateSpan) {
    return createCalendarImageEvent({
      title,
      dateYmd: dateSpan.startYmd,
      endDateYmd: dateSpan.endYmd,
      time24h: null,
      isAllDay: true,
      durationMinutes: null,
      location,
      organizerOrSource: null,
      itemType: 'other',
      isConfirmedOrFixed: true,
      confidence: 'medium',
      notes: null,
    })
  }

  const dateYmd = findFirstTranscriptDateYmd(lines, timeZone)
  if (!dateYmd) return null

  const { visibleTimeRange, visibleTimes } = extractRelevantVisibleTimes(lines)
  const isAllDay = visibleTimes.length === 0
  const time24h = isAllDay ? null : visibleTimes[0]

  return createCalendarImageEvent({
    title,
    dateYmd,
    endDateYmd: null,
    time24h,
    isAllDay,
    durationMinutes: visibleTimeRange?.durationMinutes || null,
    location,
    organizerOrSource: null,
    itemType: 'other',
    isConfirmedOrFixed: true,
    confidence: 'medium',
    notes: null,
  })
}

function parseTranscriptEvents(outputText: string, timeZone: string) {
  const lines = outputText
    .split(/\r?\n+/)
    .map((line) => normalizeTranscriptLine(line))
    .filter(Boolean)
    .filter((line) => !/^no_event$/i.test(line))

  const events: CalendarImageEvent[] = []
  let currentHeading: string | null = null
  let recentHeadings: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (looksTranscriptHeading(line)) {
      if (isGenericTranscriptHeading(line)) {
        currentHeading = null
      } else {
        recentHeadings = [...recentHeadings.slice(-4), line]
        currentHeading = chooseBestHeadingCandidate(recentHeadings)
      }
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

    const resolvedTitle = cleanTranscriptEventTitle(title || currentHeading, 'list_flyer', [
      currentHeading || '',
      remainder,
      ...supportingLines,
    ])
    if (!resolvedTitle) continue

    const detailText = [line, ...supportingLines].join(' ')
    const visibleTimeRange = extractTimeRangeDetails(detailText)
    const visibleTimes = visibleTimeRange ? [visibleTimeRange.startTime24h] : extractVisibleTimes(detailText)
    const location = extractLocationFromSupportingLines(supportingLines)

    const isAllDay = visibleTimes.length === 0
    const time24h = isAllDay ? null : visibleTimes[0]
    const dateYmd = ymdFromDate(date, timeZone)
    const smsText = isAllDay
      ? `add ${resolvedTitle} on ${displayDate(dateYmd)} all day${location ? ` at ${location}` : ''}`
      : `add ${resolvedTitle} on ${displayDate(dateYmd)} at ${displayTime(time24h)}${location ? ` at ${location}` : ''}${visibleTimeRange?.durationMinutes ? ` for ${visibleTimeRange.durationMinutes} minutes` : ''}`

    events.push({
      title: resolvedTitle,
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

    recentHeadings = []
    currentHeading = null
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

  let currentHeading: string | null = null
  let recentHeadings: string[] = []
  const events: CalendarImageEvent[] = []
  const seen = new Set<string>()

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    if (looksTranscriptHeading(line)) {
      if (isGenericTranscriptHeading(line)) {
        currentHeading = null
      } else {
        recentHeadings = [...recentHeadings.slice(-4), line]
        currentHeading = chooseBestHeadingCandidate(recentHeadings)
      }
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

      const resolvedTitle = cleanTranscriptEventTitle(title || heading, 'list_flyer', [
        heading || '',
        remainder,
        ...supportingLines,
      ])
      if (!resolvedTitle) continue

      const detailText = [remainder, ...supportingLines].join(' ')
      const visibleTimeRange = extractTimeRangeDetails(detailText)
      const visibleTimes = visibleTimeRange ? [visibleTimeRange.startTime24h] : extractVisibleTimes(detailText)
      const location = extractLocationFromSupportingLines(supportingLines)

      const isAllDay = visibleTimes.length === 0
      const time24h = isAllDay ? null : visibleTimes[0]
      const dateYmd = ymdFromDate(date, timeZone)
      const key = `${dateYmd}::${resolvedTitle.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)

      events.push({
        title: resolvedTitle,
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
          ? `add ${resolvedTitle} on ${displayDate(dateYmd)} all day${location ? ` at ${location}` : ''}`
          : `add ${resolvedTitle} on ${displayDate(dateYmd)} at ${displayTime(time24h)}${location ? ` at ${location}` : ''}${visibleTimeRange?.durationMinutes ? ` for ${visibleTimeRange.durationMinutes} minutes` : ''}`,
      })
    }

    recentHeadings = []
    currentHeading = null
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

  const cleanedTitle = cleanText(item.title)
  const cleanedSource = cleanText(item.organizer_or_source)
  const titleFromSource =
    cleanedSource && !looksContactLine(cleanedSource) && !isWeakCalendarImageTitle(cleanedSource, 'single_screenshot')
      ? cleanedSource
      : ''
  const locationFromSource =
    cleanedSource && (looksLocationLine(cleanedSource) || looksAddressLikeLine(cleanedSource))
      ? cleanedSource
      : ''
  const title = cleanedTitle || titleFromSource || item.item_type || 'event'
  const location =
    cleanText(item.location) ||
    extractLocationFromFreeformText(
      [item.location, item.notes, item.organizer_or_source].filter(Boolean).join('\n'),
    ) ||
    locationFromSource
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
  const resolvedTime = isAllDay
    ? null
    : visibleTimeRange && (!item.time_24h || item.time_24h === visibleTimeRange.endTime24h)
      ? visibleTimeRange.startTime24h
      : item.time_24h || visibleTimeRange?.startTime24h || null
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

function transcriptEventsForMode(
  transcriptText: string | null,
  timeZone: string,
  mode: CalendarImageMode,
) {
  if (!transcriptText) return []

  if (mode === 'list_flyer') {
    const lineEvents = parseTranscriptEvents(transcriptText, timeZone)
    const blockEvents = parseTranscriptEventsFromBlocks(transcriptText, timeZone)
    return blockEvents.length > lineEvents.length ? blockEvents : lineEvents
  }

  const singleEvent = parseTranscriptSingleEvent(transcriptText, timeZone, mode)
  if (singleEvent) return [singleEvent]

  const lineEvents = parseTranscriptEvents(transcriptText, timeZone)
  if (lineEvents.length) return lineEvents

  const blockEvents = parseTranscriptEventsFromBlocks(transcriptText, timeZone)
  return blockEvents
}

function mergeCalendarImageEvent(
  primary: CalendarImageEvent,
  secondary: CalendarImageEvent | null | undefined,
) {
  if (!secondary) return primary

  const merged = createCalendarImageEvent({
    title: primary.title || secondary.title,
    dateYmd: primary.dateYmd || secondary.dateYmd,
    endDateYmd: primary.endDateYmd || secondary.endDateYmd || null,
    time24h: primary.isAllDay ? null : primary.time24h || secondary.time24h || null,
    isAllDay: primary.isAllDay,
    durationMinutes: primary.durationMinutes || secondary.durationMinutes || null,
    location: primary.location || secondary.location || null,
    organizerOrSource: primary.organizerOrSource || secondary.organizerOrSource || null,
    itemType: primary.itemType || secondary.itemType,
    isConfirmedOrFixed: primary.isConfirmedOrFixed || secondary.isConfirmedOrFixed,
    confidence: strongerConfidence(primary.confidence, secondary.confidence),
    notes: primary.notes || secondary.notes || null,
  })

  return merged || primary
}

function shouldPreferTranscriptSingleEvent(
  structuredEvents: CalendarImageEvent[],
  transcriptEvent: CalendarImageEvent,
  mode: CalendarImageMode,
) {
  if (!structuredEvents.length || structuredEvents.length !== 1) return true

  const structuredEvent = structuredEvents[0]
  if (mode === 'poster' || mode === 'social_post') return true
  if (isWeakCalendarImageTitle(structuredEvent.title, mode)) return true
  if (structuredEvent.isAllDay && !transcriptEvent.isAllDay) return true
  if (!structuredEvent.location && Boolean(transcriptEvent.location)) return true
  if (!structuredEvent.endDateYmd && Boolean(transcriptEvent.endDateYmd)) return true

  return (
    scoreEventTitleCandidate(transcriptEvent.title, mode) >=
    scoreEventTitleCandidate(structuredEvent.title, mode) + 3
  )
}

function singleImageNeedsClarification({
  event,
  mode,
  transcriptText,
  confidence,
}: {
  event: CalendarImageEvent | null | undefined
  mode: CalendarImageMode
  transcriptText: string | null
  confidence: CalendarImagePayload['confidence']
}) {
  if (!event) return false
  if (confidence === 'low' || event.confidence === 'low') return true

  if (!transcriptText) return false

  const { visibleTimes } = extractRelevantVisibleTimes(transcriptLines(transcriptText))
  if (visibleTimes.length > 0 && event.isAllDay) return true

  return false
}

function singleImageNeedsTitleClarification({
  event,
  mode,
}: {
  event: CalendarImageEvent | null | undefined
  mode: CalendarImageMode
}) {
  if (!event) return false
  if (mode === 'list_flyer') return false
  return isWeakCalendarImageTitle(event.title, mode)
}

function transcriptIndicatesExplicitAllDay(transcriptText: string) {
  const normalized = cleanText(transcriptText).toLowerCase()
  if (!normalized) return false

  return /\ball day\b|\bno school\b|\bdeadline\b|\bdue\b|\bclosed\b|\boff day\b|\bholiday\b/.test(
    normalized,
  )
}

function singleImageNeedsTimeClarification({
  event,
  mode,
  transcriptText,
}: {
  event: CalendarImageEvent | null | undefined
  mode: CalendarImageMode
  transcriptText: string | null
}) {
  if (!event || !transcriptText) return false
  if (mode === 'list_flyer') return false
  if (!event.isAllDay) return false
  if (event.endDateYmd && event.endDateYmd !== event.dateYmd) return false

  const { visibleTimes } = extractRelevantVisibleTimes(transcriptLines(transcriptText))
  if (visibleTimes.length > 0) return false

  return !transcriptIndicatesExplicitAllDay(transcriptText)
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

  let transcriptText: string | null = null
  let transcriptFailure: Error | null = null
  let classifiedMode: CalendarImageMode = 'single_screenshot'
  let transcriptModeEvents: CalendarImageEvent[] = []
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
    transcriptText = await openAiImageResponse({
      dataUrl,
      timeZone,
      instructions: transcriptImageInstructions(timeZone),
      userText: 'Transcribe the visible text from this image.',
      timeoutMs: secondaryTimeoutMs,
      body: {},
    })

    if (transcriptText && !/^no_event$/i.test(cleanText(transcriptText))) {
      classifiedMode = classifyCalendarImageMode(transcriptText, timeZone)
      transcriptModeEvents = transcriptEventsForMode(transcriptText, timeZone, classifiedMode)
    }
  } catch (error) {
    transcriptFailure = error instanceof Error ? error : new Error('Transcript image parsing failed.')
    console.error('Transcript calendar image parsing failed.', {
      error: transcriptFailure.message,
    })
  }

  try {
    const outputText = await openAiImageResponse({
      dataUrl,
      timeZone,
      instructions: structuredImageInstructionsForMode(classifiedMode, timeZone),
      userText:
        classifiedMode === 'list_flyer'
          ? 'Read this image and extract every separate dated calendar item you can clearly read.'
          : 'Read this image and extract the calendar event details.',
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
    if (transcriptModeEvents.length > 1 && transcriptModeEvents.length > events.length) {
      events = transcriptModeEvents
      payload.confidence = strongerConfidence(payload.confidence, 'medium')
    } else if (
      transcriptModeEvents.length === 1 &&
      shouldPreferTranscriptSingleEvent(events, transcriptModeEvents[0], classifiedMode)
    ) {
      events = [mergeCalendarImageEvent(transcriptModeEvents[0], events[0])]
      payload.confidence = strongerConfidence(payload.confidence, 'medium')
    }
    if (transcriptText) {
      events = enrichSingleEventLocationFromTranscript(events, transcriptText)
    }
    smsTexts = events.map((event) => event.smsText)
  } catch (error) {
    structuredFailure = error instanceof Error ? error : new Error('Structured image parsing failed.')
    console.error('Structured calendar image parsing failed.', {
      error: structuredFailure.message,
    })
  }

  const buildResult = ({
    resultEvents = events,
    resultSmsTexts = resultEvents.map((event) => event.smsText),
    resultConfidence = payload.confidence,
    resultNotes = payload.notes,
  }: {
    resultEvents?: CalendarImageEvent[]
    resultSmsTexts?: string[]
    resultConfidence?: CalendarImagePayload['confidence']
    resultNotes?: string | null
  } = {}): CalendarImageResult => {
    const singleEvent = resultEvents.length === 1 ? resultEvents[0] : null
    const needsTitleClarification = singleImageNeedsTitleClarification({
      event: singleEvent,
      mode: classifiedMode,
    })
    const needsTimeClarification =
      !needsTitleClarification &&
      singleImageNeedsTimeClarification({
        event: singleEvent,
        mode: classifiedMode,
        transcriptText,
      })
    const needsClarification =
      !needsTitleClarification &&
      !needsTimeClarification &&
      singleImageNeedsClarification({
        event: singleEvent,
        mode: classifiedMode,
        transcriptText,
        confidence: resultConfidence,
      })

    return {
      smsText: resultSmsTexts[0] || null,
      smsTexts: resultSmsTexts,
      events: resultEvents,
      confidence: resultConfidence,
      notes: resultNotes,
      mode: classifiedMode,
      needsClarification,
      needsTimeClarification,
      needsTitleClarification,
    }
  }

  if (isSmsMode && smsTexts.length > 1) {
    return buildResult()
  }

  if (isSmsMode) {
    if (smsTexts.length) {
      return buildResult()
    }

    if (transcriptModeEvents.length) {
      return buildResult({
        resultEvents: transcriptModeEvents,
        resultSmsTexts: transcriptModeEvents.map((event) => event.smsText),
        resultConfidence: 'medium',
      })
    }

    const meaningfulFailure = transcriptFailure || structuredFailure
    if (meaningfulFailure && /openai|api key|returned \d+|timed out|aborted/i.test(meaningfulFailure.message)) {
      throw meaningfulFailure
    }

    return buildResult({
      resultEvents: [],
      resultSmsTexts: [],
    })
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
    return buildResult({
      resultEvents: lineItemEvents,
      resultSmsTexts: lineItemEvents.map((event) => event.smsText),
      resultConfidence: 'medium',
    })
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

  if (transcriptModeEvents.length > smsTexts.length && transcriptModeEvents.length >= 2) {
    return buildResult({
      resultEvents: transcriptModeEvents,
      resultSmsTexts: transcriptModeEvents.map((event) => event.smsText),
      resultConfidence: 'medium',
    })
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
    return buildResult({
      resultEvents: lineItemEvents,
      resultSmsTexts: lineItemEvents.map((event) => event.smsText),
      resultConfidence: 'medium',
    })
  }

  if (fallbackSmsLines.length > smsTexts.length && fallbackEvents.length >= Math.min(2, fallbackSmsLines.length)) {
    return buildResult({
      resultEvents: fallbackEvents,
      resultSmsTexts: fallbackSmsLines,
      resultConfidence: 'medium',
    })
  }

  if (smsTexts.length) {
    return buildResult()
  }

  if (fallbackSmsLines.length) {
    return buildResult({
      resultEvents: fallbackEvents,
      resultSmsTexts: fallbackSmsLines,
      resultConfidence: 'medium',
    })
  }

  if (transcriptModeEvents.length) {
    return buildResult({
      resultEvents: transcriptModeEvents,
      resultSmsTexts: transcriptModeEvents.map((event) => event.smsText),
      resultConfidence: 'medium',
    })
  }

  const meaningfulFailure = fallbackFailure || structuredFailure || transcriptFailure
  if ((lineItemFailure || meaningfulFailure) && /openai|api key|returned \d+|timed out/i.test((lineItemFailure || meaningfulFailure)!.message)) {
    throw (lineItemFailure || meaningfulFailure)!
  }

  return buildResult({
    resultEvents: [],
    resultSmsTexts: [],
  })
}
