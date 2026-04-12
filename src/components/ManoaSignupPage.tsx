'use client'

import { useEffect, useRef, useState } from 'react'

type DemoEvent = {
  time: string
  title: string
  calendar: string
}

type DemoOption = DemoEvent & {
  day: string
  person?: string
  selectOnly?: boolean
}

type DemoMessage = {
  role: 'user' | 'manoa'
  lines: string[]
  options?: DemoOption[]
}

type RescheduleTarget = {
  day: 'today' | 'tomorrow'
  event?: DemoEvent
  originalText?: string
} | null

const initialAgenda: DemoEvent[] = [
  { time: '9:00 AM', title: 'Team standup', calendar: 'Work' },
  { time: '1:30 PM', title: 'Dentist', calendar: 'Personal' },
  { time: '4:00 PM', title: 'School pickup', calendar: 'Family' },
]

const initialTomorrowAgenda: DemoEvent[] = [
  { time: '8:30 AM', title: 'Workout', calendar: 'Personal' },
  { time: '10:00 AM', title: 'Client review', calendar: 'Work' },
  { time: '3:00 PM', title: 'Budget check-in', calendar: 'Work' },
]

const demoSlots: Record<string, DemoOption[]> = {
  morning: [
    { day: 'Tue', time: '9:30 AM', calendar: 'Work', title: 'meeting' },
    { day: 'Wed', time: '10:00 AM', calendar: 'Work', title: 'meeting' },
    { day: 'Fri', time: '8:45 AM', calendar: 'Personal', title: 'meeting' },
  ],
  afternoon: [
    { day: 'Tue', time: '12:00 PM', calendar: 'Personal', title: 'meeting' },
    { day: 'Tue', time: '1:30 PM', calendar: 'Work', title: 'meeting' },
    { day: 'Wed', time: '12:15 PM', calendar: 'Personal', title: 'meeting' },
  ],
  default: [
    { day: 'Tue', time: '11:00 AM', calendar: 'Work', title: 'meeting' },
    { day: 'Wed', time: '2:30 PM', calendar: 'Personal', title: 'meeting' },
    { day: 'Fri', time: '10:30 AM', calendar: 'Work', title: 'meeting' },
  ],
}

const weekdays: Record<string, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
}

const schedulingWords = [
  'schedule',
  'book',
  'add',
  'lunch',
  'dinner',
  'coffee',
  'call',
  'meeting',
  'appointment',
  'event',
]

const externalAppointmentKeywords = [
  'doctor',
  'dentist',
  'therapy',
  'therapist',
  'vet',
  'clinic',
  'salon',
  'haircut',
  'barber',
  'repair',
  'service',
  'cleaning',
]

const businessNumbers: Record<string, string> = {
  dentist: '(312) 555-0189',
  doctor: '(312) 555-0144',
  therapist: '(312) 555-0162',
}

const starterMessages: DemoMessage[] = [
  {
    role: 'manoa',
    lines: [
      'Text me like you would from your phone.',
      'Try: 9am meeting Tuesday on work calendar or reschedule dentist.',
    ],
  },
]

const homepageUseCases = [
  {
    href: '/schedule-by-text',
    label: 'Schedule by text',
    title: 'Book something new',
    description:
      'Text what you need, get a few open times, and confirm with 1, 2, or 3 instead of opening your calendar.',
  },
  {
    href: '/calendar-reminders-by-text',
    label: 'Agenda and reminders',
    title: 'Stay on top of the day',
    description:
      'Get morning agenda texts and short reminders so your schedule stays visible without another app.',
  },
  {
    href: '/reschedule-appointments-by-text',
    label: 'Appointment changes',
    title: 'Handle dentist and doctor moves honestly',
    description:
      'Prep the call, hold time on your calendar, and update the reminder after the office confirms the change.',
  },
  {
    href: '/multiple-calendars-by-text',
    label: 'Work and personal calendars',
    title: 'Route events to the right calendar',
    description:
      'Use simple hints like work or personal so Manoa can help across the calendars that matter.',
  },
  {
    href: '/invite-people-by-text',
    label: 'Invitees',
    title: 'Set up meetings with people by text',
    description:
      'Start the meeting from a text and let Manoa handle known contacts while asking for missing emails once.',
  },
  {
    href: '/recurring-events-by-text',
    label: 'Recurring events',
    title: 'Create weekly and monthly repeats',
    description:
      'Text recurring schedules in plain language instead of clicking through repeat-rule menus.',
  },
]

const homepageFaqs = [
  {
    question: 'Do I need an app?',
    answer:
      'No. You sign up on the site once, connect Google Calendar or Outlook, and then use Manoa by text.',
  },
  {
    question: 'What calendars work with Manoa?',
    answer:
      'Right now Manoa supports Google Calendar and Outlook. You connect them after checkout in the setup flow.',
  },
  {
    question: 'Will Manoa change things without me knowing?',
    answer:
      'No. Manoa only books after you confirm by text, and it stays clear about what it changed in your calendar versus what still needs a real call or follow-up.',
  },
  {
    question: 'Can Manoa reschedule doctor or dentist appointments?',
    answer:
      'Manoa will not pretend it changed an office appointment. It can prepare your best times, hold space on your calendar, and update your reminder once the office confirms the new time.',
  },
  {
    question: 'Can I cancel anytime?',
    answer:
      'Yes. The plan is monthly, and you can manage billing or cancel from your Manoa dashboard.',
  },
  {
    question: 'What does setup look like?',
    answer:
      'Enter your email and phone, finish checkout, connect your calendar, and send your first text. The whole flow is designed to stay short.',
  },
]

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

const homepageSoftwareApplicationStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Manoa',
  applicationCategory: 'ProductivityApplication',
  operatingSystem: 'Any',
  url: siteUrl,
  description:
    'Manoa is a calendar assistant you text. Book meetings, get reminders, and manage your calendar by text.',
  offers: {
    '@type': 'Offer',
    price: '19.99',
    priceCurrency: 'USD',
    url: `${siteUrl}/#signup`,
  },
}

const homepageFaqStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: homepageFaqs.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.answer,
    },
  })),
}

const homepageUseCaseStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Popular Manoa use cases',
  itemListElement: homepageUseCases.map((useCase, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: useCase.title,
    url: `${siteUrl}${useCase.href}`,
  })),
}

function titleCase(value: string) {
  return value
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function mentionsTomorrow(text: string) {
  return (
    /\btomorrow'?s?\b/.test(text) ||
    text.includes('tmrw') ||
    text.includes('tomororw') ||
    text.includes('tomororws')
  )
}

function asksForToday(text: string) {
  return (
    /\btoday'?s?\b/.test(text) ||
    text.includes('todays') ||
    text.includes('todayss') ||
    text.includes('todays schedule') ||
    text.includes('todays scheudle')
  )
}

function parseDemoTime(text: string) {
  const timeMatch = text
    .toLowerCase()
    .match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/)
  if (!timeMatch) return ''

  const hour = Number(timeMatch[1])
  const minutes = timeMatch[2] || '00'
  const period = timeMatch[3].startsWith('a') ? 'AM' : 'PM'

  return `${hour}:${minutes} ${period}`
}

function parseMoveToTime(text: string) {
  const moveTimeMatch = text
    .toLowerCase()
    .match(/\b(?:to|for)\s+(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/)
  return moveTimeMatch ? parseDemoTime(moveTimeMatch[0]) : ''
}

function calendarFromDemoText(text: string) {
  const lower = text.toLowerCase()
  if (lower.includes('work')) return 'Work'
  if (lower.includes('family')) return 'Family'
  if (lower.includes('personal') || lower.includes('home')) return 'Personal'
  return ''
}

function looksLikeScheduleRequest(text: string) {
  const lower = text.toLowerCase()
  return (
    schedulingWords.some((word) => lower.includes(word)) ||
    Boolean(parseDemoTime(lower)) ||
    Boolean(lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)) ||
    mentionsTomorrow(lower)
  )
}

function inferDemoTitle(text: string) {
  const cleaned = text
    .toLowerCase()
    .replace(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/g, ' ')
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g, ' ')
    .replace(/\btomorrow'?s?\b|\btmrw\b|\btomororws?\b/g, ' ')
    .replace(/\b(schedule|book|add|reschedule|move|change|push|on|at|to|my|work|personal|family|home|email|calendar)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return 'meeting'
  return cleaned.replace(/\s+with\s+[a-zA-Z]+$/i, '')
}

function isRescheduleRequest(text: string) {
  return /\b(reschedule|move|change|push)\b/.test(text)
}

function isExternalAppointmentTitle(text: string) {
  const lower = text.toLowerCase()
  return externalAppointmentKeywords.some((keyword) => lower.includes(keyword))
}

function businessNumberForTitle(text: string) {
  const lower = text.toLowerCase()
  const match = Object.entries(businessNumbers).find(([keyword]) => lower.includes(keyword))
  return match?.[1] || ''
}

function parseDemoRequest(text: string) {
  const lower = text.toLowerCase()
  const personMatch = text.match(/\bwith\s+([a-zA-Z]+)(?:\s|$)/)
  const titleMatch = text.match(/\b(schedule|book|add)\s+(.+?)(?:\s+with|\s+next|\s+tomorrow|\s+on|$)/i)
  const dayMatch = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)
  const exactTime = parseDemoTime(lower)
  const calendar = calendarFromDemoText(lower)
  const relativeDay = mentionsTomorrow(lower) ? 'Tomorrow' : ''

  let window = 'default'
  if (lower.includes('morning') || /\b(8|9|10|11)(?::[0-5]\d)?\s*a\.?m\.?\b/.test(lower)) {
    window = 'morning'
  }
  if (
    lower.includes('afternoon') ||
    lower.includes('lunch') ||
    /\b(12|1|2|3|4)(?::[0-5]\d)?\s*p\.?m\.?\b/.test(lower)
  ) {
    window = 'afternoon'
  }

  return {
    title: titleMatch ? titleMatch[2].replace(/^a\s+/i, '').trim() : inferDemoTitle(text),
    person: personMatch ? personMatch[1] : '',
    day: dayMatch ? weekdays[dayMatch[1]] : relativeDay,
    exactTime,
    calendar,
    window,
  }
}

function demoTimeSortValue(timeLabel: string) {
  const match = timeLabel.match(/^\s*(1[0-2]|0?[1-9]):([0-5]\d)\s*(AM|PM)\s*$/i)
  if (!match) return Number.POSITIVE_INFINITY

  let hour = Number(match[1]) % 12
  const minutes = Number(match[2])
  const period = match[3].toUpperCase()
  if (period === 'PM') hour += 12

  return hour * 60 + minutes
}

function sortDemoEvents(events: DemoEvent[]) {
  return [...events].sort((left, right) => demoTimeSortValue(left.time) - demoTimeSortValue(right.time))
}

function agendaLines(events: DemoEvent[]) {
  const orderedEvents = sortDemoEvents(events)
  return orderedEvents.length
    ? orderedEvents.map((event) => `${event.time} ${event.title} (${event.calendar})`)
    : ['Nothing scheduled.']
}

export default function ManoaSignupPage() {
  const [messages, setMessages] = useState<DemoMessage[]>(starterMessages)
  const [pendingOptions, setPendingOptions] = useState<DemoOption[]>([])
  const [pendingMode, setPendingMode] = useState<
    'book' | 'reschedule' | 'selectRescheduleTarget' | 'externalCallPrep'
  >('book')
  const [rescheduleTarget, setRescheduleTarget] = useState<RescheduleTarget>(null)
  const [agenda, setAgenda] = useState<DemoEvent[]>(sortDemoEvents(initialAgenda))
  const [tomorrowAgenda, setTomorrowAgenda] = useState<DemoEvent[]>(
    sortDemoEvents(initialTomorrowAgenda),
  )
  const [demoInput, setDemoInput] = useState('')
  const [statusNotice, setStatusNotice] = useState<{
    tone: 'success' | 'warning'
    text: string
  } | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const thread = threadRef.current
    if (!thread) return
    thread.scrollTop = thread.scrollHeight
  }, [messages])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    if (params.get('calendar') === 'connected') {
      setStatusNotice({
        tone: 'success',
        text: 'Calendar connected. Manoa can now check availability and book events for your account.',
      })
      return
    }

    if (params.get('checkout') === 'cancelled') {
      setStatusNotice({
        tone: 'warning',
        text: 'Checkout was cancelled. You can come back here any time and start again.',
      })
      return
    }

    if (params.get('access') === 'not_found') {
      setStatusNotice({
        tone: 'warning',
        text: 'We could not find an account with that email and phone number together. Try the exact signup details you used.',
      })
      return
    }

    if (params.get('access') === 'invalid') {
      setStatusNotice({
        tone: 'warning',
        text: 'Use the same email and phone number you signed up with to open your dashboard.',
      })
      return
    }
  }, [])

  function addMessage(message: DemoMessage) {
    setMessages((current) => [...current, message])
  }

  function findEventToMove(text: string): Exclude<RescheduleTarget, null> | null {
    const lower = text.toLowerCase()
    const searchTomorrow = mentionsTomorrow(lower)
    const events = searchTomorrow ? tomorrowAgenda : agenda
    const exactTime = parseDemoTime(lower)
    const calendar = calendarFromDemoText(lower)
    const inferredTitle = inferDemoTitle(text)

    if (!events.length) return null

    const byTime = exactTime && events.find((event) => event.time === exactTime)
    if (byTime) return { day: searchTomorrow ? 'tomorrow' : 'today', event: byTime }

    const byCalendar = calendar && events.find((event) => event.calendar === calendar)
    if (byCalendar) return { day: searchTomorrow ? 'tomorrow' : 'today', event: byCalendar }

    if (inferredTitle && inferredTitle !== 'meeting') {
      const titleWords = inferredTitle.split(/\s+/).filter(Boolean)
      const byTitle = events.find((event) =>
        titleWords.some((word) => event.title.toLowerCase().includes(word)),
      )
      if (byTitle) return { day: searchTomorrow ? 'tomorrow' : 'today', event: byTitle }
    }

    return null
  }

  function sendAgenda(day: 'today' | 'tomorrow' = 'today') {
    const events = day === 'tomorrow' ? tomorrowAgenda : agenda
    addMessage({
      role: 'manoa',
      lines: [
        day === 'tomorrow' ? "Tomorrow's schedule:" : 'Good morning. Today:',
        ...agendaLines(events),
      ],
    })
  }

  function offerTimes(text: string) {
    const request = parseDemoRequest(text)
    const slots = demoSlots[request.window] || demoSlots.default
    const options = slots.map((slot) => ({
      ...slot,
      day: request.day || slot.day,
      time: request.exactTime || slot.time,
      calendar: request.calendar || slot.calendar,
      title: request.title,
      person: request.person,
    }))

    if (request.exactTime) {
      options.splice(
        1,
        2,
        ...slots.slice(1).map((slot) => ({
          ...slot,
          day: request.day || slot.day,
          calendar: request.calendar || slot.calendar,
          title: request.title,
          person: request.person,
        })),
      )
    }

    setPendingMode('book')
    setRescheduleTarget(null)
    setPendingOptions(options)
    addMessage({
      role: 'manoa',
      lines: request.exactTime
        ? ['I can do that.', 'Option 1 matches your text. Reply with 1, 2, or 3.']
        : ['I found three good times.', 'Reply with 1, 2, or 3.'],
      options,
    })
  }

  function offerRescheduleTimes(text: string, selectedTarget: Exclude<RescheduleTarget, null> | null = null) {
    const target = selectedTarget || findEventToMove(text)
    if (!target || !target.event) {
      const searchTomorrow = mentionsTomorrow(text.toLowerCase())
      const events = searchTomorrow ? tomorrowAgenda : agenda
      const options = events.slice(0, 3).map((event) => ({
        day: searchTomorrow ? 'Tomorrow' : 'Today',
        time: event.time,
        calendar: event.calendar,
        title: event.title,
        selectOnly: true,
      }))

      if (!options.length) {
        addMessage({
          role: 'manoa',
          lines: ["I do not see a meeting to move in this demo.", "Try asking for today's agenda first."],
        })
        return
      }

      setPendingMode('selectRescheduleTarget')
      setRescheduleTarget({
        originalText: text,
        day: searchTomorrow ? 'tomorrow' : 'today',
      })
      setPendingOptions(options)
      addMessage({
        role: 'manoa',
        lines: ['Which one should I move?', 'Reply with 1, 2, or 3.'],
        options,
      })
      return
    }

    const targetEvent = target.event
    if (isExternalAppointmentTitle(targetEvent.title)) {
      const request = parseDemoRequest(text)
      const slots = demoSlots[request.window] || demoSlots.default
      const options = slots.map((slot) => ({
        ...slot,
        day: request.day || slot.day,
        time: slot.time,
        calendar: 'Personal',
        title: `Call ${targetEvent.title} to reschedule`,
      }))

      const bestTimes = options
        .map((option) => `${option.day} ${option.time}`)
        .join(', ')
      const officeNumber = businessNumberForTitle(targetEvent.title)

      setPendingMode('externalCallPrep')
      setRescheduleTarget(target)
      setPendingOptions(options)
      addMessage({
        role: 'manoa',
        lines: [
          `I can't change ${targetEvent.title} with the office by text, but I can get you ready to call.`,
          officeNumber ? `Office number: ${officeNumber}` : 'I can save the office number next time.',
          `Call note: Need to move ${targetEvent.title}. Best times: ${bestTimes}.`,
          'Reply with 1, 2, or 3 and I will hold that time for your call.',
        ],
        options,
      })
      return
    }

    const request = parseDemoRequest(text)
    const moveToTime = parseMoveToTime(text)
    const slots = demoSlots[request.window] || demoSlots.default
    const options = slots.map((slot, index) => ({
      ...slot,
      day: request.day || (index === 1 ? 'Tomorrow' : 'Today'),
      time: index === 0 && moveToTime ? moveToTime : slot.time,
      calendar: request.calendar || targetEvent.calendar,
      title: targetEvent.title,
    }))

    setPendingMode('reschedule')
    setRescheduleTarget(target)
    setPendingOptions(options)
    addMessage({
      role: 'manoa',
      lines: [`I found ${targetEvent.title}.`, 'I can move it to one of these. Reply with 1, 2, or 3.'],
      options,
    })
  }

  function selectRescheduleTarget(number: number) {
    const option = pendingOptions[number - 1]
    const targetDay = rescheduleTarget?.day || 'today'
    const events = targetDay === 'tomorrow' ? tomorrowAgenda : agenda
    const event = events.find(
      (item) =>
        item.title === option?.title &&
        item.time === option?.time &&
        item.calendar === option?.calendar,
    )

    if (!option || !event) {
      addMessage({
        role: 'manoa',
        lines: ['Reply with 1, 2, or 3 for the meeting you want to move.'],
      })
      return
    }

    offerRescheduleTimes(rescheduleTarget?.originalText || 'reschedule', {
      day: targetDay,
      event,
    })
  }

  function rescheduleOption(number: number) {
    const option = pendingOptions[number - 1]
    if (!option || !rescheduleTarget?.event) {
      addMessage({
        role: 'manoa',
        lines: ['Tell me which meeting to move, then reply with 1, 2, or 3.'],
      })
      return
    }

    const updatedEvent = {
      time: option.time,
      title: rescheduleTarget.event.title,
      calendar: option.calendar,
    }

    if (rescheduleTarget.day === 'tomorrow') {
      setTomorrowAgenda((current) => current.filter((event) => event !== rescheduleTarget.event))
    } else {
      setAgenda((current) => current.filter((event) => event !== rescheduleTarget.event))
    }

    if (option.day === 'Tomorrow') {
      setTomorrowAgenda((current) => sortDemoEvents([...current, updatedEvent]))
    } else {
      setAgenda((current) => sortDemoEvents([...current, updatedEvent]))
    }

    setPendingOptions([])
    setPendingMode('book')
    setRescheduleTarget(null)
    addMessage({
      role: 'manoa',
      lines: [
        `Moved ${updatedEvent.title} to ${option.day} at ${option.time} on ${option.calendar}.`,
        'I will remind you 30 minutes before.',
      ],
    })
  }

  function externalCallPrepOption(number: number) {
    const option = pendingOptions[number - 1]
    if (!option || !rescheduleTarget?.event) {
      addMessage({
        role: 'manoa',
        lines: ['Tell me which appointment you need to call about, then reply with 1, 2, or 3.'],
      })
      return
    }

    const holdEvent = {
      time: option.time,
      title: titleCase(option.title),
      calendar: option.calendar,
    }

    if (option.day === 'Tomorrow') {
      setTomorrowAgenda((current) => sortDemoEvents([...current, holdEvent]))
    } else {
      setAgenda((current) => sortDemoEvents([...current, holdEvent]))
    }

    const officeNumber = businessNumberForTitle(rescheduleTarget.event.title)
    const allTimes = pendingOptions.map((item) => `${item.day} ${item.time}`).join(', ')

    setPendingOptions([])
    setPendingMode('book')
    setRescheduleTarget(null)
    addMessage({
      role: 'manoa',
      lines: [
        `Held ${option.day} at ${option.time} for your call about ${rescheduleTarget.event.title}.`,
        officeNumber ? `Office number: ${officeNumber}.` : 'Reply with the office number and I will save it for next time.',
        `Call note: Need to move ${rescheduleTarget.event.title}. Best times: ${allTimes}.`,
      ],
    })
  }

  function bookOption(number: number) {
    if (pendingMode === 'selectRescheduleTarget') {
      selectRescheduleTarget(number)
      return
    }

    if (pendingMode === 'externalCallPrep') {
      externalCallPrepOption(number)
      return
    }

    if (pendingMode === 'reschedule') {
      rescheduleOption(number)
      return
    }

    const option = pendingOptions[number - 1]
    if (!option) {
      addMessage({
        role: 'manoa',
        lines: ['Send a scheduling request first, then reply with 1, 2, or 3.'],
      })
      return
    }

    const title = option.person ? `${option.title} with ${option.person}` : option.title
    const event = {
      time: option.time,
      title: titleCase(title),
      calendar: option.calendar,
    }

    if (option.day === 'Tomorrow') {
      setTomorrowAgenda((current) => sortDemoEvents([...current, event]))
    } else {
      setAgenda((current) => sortDemoEvents([...current, event]))
    }
    setPendingOptions([])
    setPendingMode('book')
    setRescheduleTarget(null)
    addMessage({
      role: 'manoa',
      lines: [`Booked ${event.title} for ${option.day} at ${option.time}.`, 'I will remind you 30 minutes before.'],
    })
  }

  function handleDemoText(text: string) {
    const cleanText = text.trim()
    const lower = cleanText.toLowerCase()
    if (!cleanText) return

    addMessage({ role: 'user', lines: [cleanText] })
    const startsWithSchedulingVerb = /^(schedule|book|add)\b/.test(lower)
    const isTomorrowAgendaRequest =
      mentionsTomorrow(lower) &&
      !startsWithSchedulingVerb &&
      (lower.includes('agenda') ||
        lower.includes('calendar') ||
        lower.includes('schedule') ||
        lower.includes('scheudle') ||
        lower.includes('what') ||
        lower.includes('show') ||
        lower.includes('do i have'))
    const isAgendaRequest =
      lower === 'today' ||
      asksForToday(lower) ||
      lower.includes('agenda') ||
      lower.includes("what's on") ||
      lower.includes('what is on') ||
      lower.includes('what do i have') ||
      (lower.includes('calendar') && lower.includes('what')) ||
      (lower.includes('calendar') && asksForToday(lower)) ||
      (lower.includes('schedule') && asksForToday(lower)) ||
      (lower.includes('scheudle') && asksForToday(lower))

    if (/^[123]$/.test(lower)) {
      bookOption(Number(lower))
      return
    }

    const optionMatch = lower.match(/\b(?:option\s*)?([123])\b/)
    if (pendingOptions.length && optionMatch) {
      bookOption(Number(optionMatch[1]))
      return
    }

    if (isRescheduleRequest(lower)) {
      offerRescheduleTimes(cleanText)
      return
    }

    if (isTomorrowAgendaRequest) {
      sendAgenda('tomorrow')
      return
    }

    if (isAgendaRequest) {
      sendAgenda('today')
      return
    }

    if (looksLikeScheduleRequest(cleanText)) {
      offerTimes(cleanText)
      return
    }

    addMessage({
      role: 'manoa',
      lines: ['Try: 9am meeting Tuesday on work calendar.', 'Then reply with 1, 2, or 3.'],
    })
  }

  function resetDemo() {
    setMessages(starterMessages)
    setPendingOptions([])
    setPendingMode('book')
    setRescheduleTarget(null)
    setAgenda(sortDemoEvents(initialAgenda))
    setTomorrowAgenda(sortDemoEvents(initialTomorrowAgenda))
    setDemoInput('')
  }

  return (
    <main className="shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(homepageSoftwareApplicationStructuredData),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(homepageFaqStructuredData),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(homepageUseCaseStructuredData),
        }}
      />
      <header className="topbar">
        <a className="brand" href="#" aria-label="Manoa home">
          <span className="mark" aria-hidden="true">
            M
          </span>
          <span className="brand-name">Manoa</span>
        </a>
        <div className="top-actions">
          <a className="top-link" href="#how-it-works">
            How it works
          </a>
          <a className="top-link" href="#faq">
            FAQ
          </a>
          <a className="nav-link secondary" href="/login">
            Log in
          </a>
        </div>
      </header>

      {statusNotice ? (
        <div className={`notice ${statusNotice.tone}`} role="status" aria-live="polite">
          {statusNotice.text}
        </div>
      ) : null}

      <section className="hero-grid" aria-label="Text Manoa">
        <div className="copy">
          <p className="eyebrow">Calendar assistant by text</p>
          <h1>Stop Scheduling. Just Text Manoa.</h1>
          <p className="tagline">Book meetings, get reminders, and manage your calendar — all by text.</p>
          <div className="hero-example" aria-label="Example conversation">
            <p className="hero-example-label">Example</p>
            <div className="hero-example-bubble user">
              <strong>You</strong>
              <span>Need a meeting with Dr. Beth this week</span>
            </div>
            <div className="hero-example-bubble manoa">
              <strong>Manoa</strong>
              <span>Best options: Tues 10am, Wed 2pm, Thurs 11am. Reply 1, 2, or 3.</span>
            </div>
          </div>
          <p className="lede">
            Built for busy people who don&apos;t have time to schedule.
          </p>
          <div className="hero-points" aria-label="Why Manoa feels simple">
            <div className="hero-point">
              <strong>No back-and-forth</strong>
              <span>Manoa finds the best times instantly.</span>
            </div>
            <div className="hero-point">
              <strong>No apps or links</strong>
              <span>Just send a text like you normally would.</span>
            </div>
            <div className="hero-point">
              <strong>Never forget anything</strong>
              <span>Daily agenda and reminders get sent to your phone.</span>
            </div>
          </div>
          <p className="quick-note">
            Sign up once, connect your calendar, and text what you need.
          </p>
          <p className="hero-summary">
            No links. No apps. No back-and-forth.
          </p>
        </div>

        <aside id="signup" className="panel signup hero-signup" aria-label="Start Manoa">
          <p className="plan-label">Personal plan</p>
          <div className="price" aria-label="$19.99 per month">
            <strong>$19.99</strong>
            <span>/ month</span>
          </div>
          <p className="plan-line">Your calendar handled for you — by text.</p>
          <p className="trust-line">
            Try it. If it doesn&apos;t save you time this week, cancel.
          </p>
          <div className="mini-points" aria-label="Plan details">
            <span>Takes 30 seconds to set up</span>
            <span>Cancel anytime</span>
            <span>Connect Google or Outlook after checkout</span>
          </div>

          <form action="/api/start-checkout" method="post">
            <input type="hidden" name="plan" value="personal_monthly_1999" />
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+1 555 555 5555"
                required
              />
            </div>
            <button className="button" type="submit">
              Start texting Manoa
            </button>
          </form>

          <p className="fine-print">
            By starting, you agree to receive service texts from Manoa. Message
            and data rates may apply. Reply STOP to opt out. See{' '}
            <a href="/privacy">Privacy Policy</a> and{' '}
            <a href="/terms">Terms and Conditions</a>.
          </p>
        </aside>
      </section>

      <section className="demo" aria-label="Manoa text demo">
        <div>
          <p className="eyebrow">Working demo</p>
          <h2>Just text it. Your calendar handles the rest.</h2>
          <p>
            Type a request, then reply with 1, 2, or 3. After signup, the real
            conversation happens from your phone through Manoa&apos;s number.
          </p>
          <p className="demo-note">
            This preview shows the texting loop. Your real account, billing, contact save, and
            calendar setup live in the dashboard.
          </p>
          <div className="demo-actions" aria-label="Demo controls">
            <button className="demo-prompt" type="button" onClick={resetDemo}>
              Reset
            </button>
          </div>
        </div>

        <div className="demo-panel">
          <div className="phone-preview" aria-label="SMS preview">
            <div className="phone-header">
              <span>Manoa</span>
              <small>Text message</small>
            </div>
            <div ref={threadRef} className="demo-thread" aria-live="polite">
              {messages.map((message, messageIndex) => (
                <div key={`${message.role}-${messageIndex}`} className={`sms ${message.role}`}>
                  {message.lines.map((line, lineIndex) => (
                    <span key={`${line}-${lineIndex}`}>
                      {line}
                      {lineIndex < message.lines.length - 1 ? <br /> : null}
                    </span>
                  ))}
                  {message.options ? (
                    <div className="demo-choices">
                      {message.options.map((option, optionIndex) => (
                        <button
                          key={`${option.day}-${option.time}-${option.calendar}-${optionIndex}`}
                          type="button"
                          className="demo-choice"
                          onClick={() => handleDemoText(String(optionIndex + 1))}
                        >
                          {optionIndex + 1}. {option.day} {option.time} on {option.calendar}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <form
            className="demo-form"
            onSubmit={(event) => {
              event.preventDefault()
              handleDemoText(demoInput)
              setDemoInput('')
            }}
          >
            <input
              value={demoInput}
              onChange={(event) => setDemoInput(event.target.value)}
              autoComplete="off"
              placeholder="9am meeting Tuesday on work calendar"
              aria-label="Text Manoa demo"
            />
            <button className="button" type="submit">
              Send
            </button>
          </form>
        </div>
        <div className="demo-footer-copy">
          <p className="demo-close">No links. No apps. No back-and-forth.</p>
          <a className="button demo-cta-button" href="#signup">
            Start texting Manoa
          </a>
        </div>
      </section>

      <section id="how-it-works" className="steps anchor-section" aria-label="How Manoa works">
        <h2>How it works</h2>
        <p className="steps-lede">
          Sign up, connect your calendar, text what you need, and you&apos;re done.
        </p>
        <div className="step-grid">
          <article className="step">
            <span className="step-number">1</span>
            <h3>Sign up</h3>
            <p>Enter your email and phone.</p>
          </article>
          <article className="step">
            <span className="step-number">2</span>
            <h3>Connect your calendar</h3>
            <p>Takes 10 seconds.</p>
          </article>
          <article className="step">
            <span className="step-number">3</span>
            <h3>Text Manoa</h3>
            <p>&ldquo;Schedule meeting this week.&rdquo; Done.</p>
          </article>
        </div>
      </section>

      <section className="learn" aria-label="Learn more about Manoa">
        <div className="learn-panel">
          <p className="learn-label">Good fit for</p>
          <h2>Built for people who already run their day from their phone.</h2>
          <div className="learn-card-grid">
            <article className="learn-card">
              <h3>Busy professionals</h3>
              <p>
                If meetings, follow-ups, and quick calendar changes keep interrupting your day,
                texting is faster than opening another app.
              </p>
            </article>
            <article className="learn-card">
              <h3>Work and personal jugglers</h3>
              <p>
                Manoa is especially useful when you need one place to keep work, personal, and
                family calendars straight without thinking about routing.
              </p>
            </article>
            <article className="learn-card">
              <h3>People who forget the little stuff</h3>
              <p>
                Morning agendas and reminders help when the problem is not just scheduling, but
                also keeping the day from slipping through the cracks.
              </p>
            </article>
          </div>
        </div>

        <div className="learn-panel learn-panel-accent">
          <p className="learn-label">What you can text</p>
          <h2>Common things Manoa can handle right away.</h2>
          <ul className="learn-list">
            <li>Schedule something new and pick from three times by text.</li>
            <li>Ask what&apos;s on your calendar today or tomorrow.</li>
            <li>Move a personal event or a meeting you own.</li>
            <li>
              Handle dentist, doctor, salon, or service appointments honestly by prepping the
              call and updating your calendar after you confirm the new time.
            </li>
            <li>Keep Google or Outlook calendars connected and ready for real scheduling.</li>
          </ul>
        </div>
      </section>

      <section className="home-use-cases" aria-label="Popular use cases">
        <p className="faq-label">Popular use cases</p>
        <h2>Learn from the workflow closest to yours.</h2>
        <p className="home-use-cases-lede">
          These pages go deeper on the jobs Manoa already handles well, without changing the
          simple signup flow on the homepage.
        </p>
        <div className="home-use-case-grid">
          {homepageUseCases.map((useCase) => (
            <a key={useCase.href} className="home-use-case-card" href={useCase.href}>
              <span className="home-use-case-label">{useCase.label}</span>
              <h3>{useCase.title}</h3>
              <p>{useCase.description}</p>
            </a>
          ))}
        </div>
        <div className="home-use-case-footer">
          <a className="nav-link" href="/use-cases">
            See all use cases
          </a>
        </div>
      </section>

      <section id="faq" className="faq anchor-section" aria-label="Frequently asked questions">
        <p className="faq-label">FAQ</p>
        <h2>Answers before you sign up.</h2>
        <div className="faq-grid">
          {homepageFaqs.map((faq) => (
            <article key={faq.question} className="faq-item">
              <h3>{faq.question}</h3>
              <p>{faq.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <footer>
        Manoa. Text your calendar back into shape. <a href="/use-cases">Use cases</a> ·{' '}
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
      </footer>
    </main>
  )
}
