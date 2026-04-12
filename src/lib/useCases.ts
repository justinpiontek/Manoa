export type UseCaseBenefit = {
  title: string
  body: string
}

export type UseCaseStep = {
  title: string
  body: string
}

export type UseCaseFaq = {
  question: string
  answer: string
}

export type UseCaseLink = {
  href: string
  label: string
  description: string
}

export type UseCase = {
  slug: string
  href: string
  cardTitle: string
  cardDescription: string
  eyebrow: string
  title: string
  description: string
  intro: string
  exampleUser: string
  exampleManoa: string
  benefits: UseCaseBenefit[]
  idealFor: string[]
  steps: UseCaseStep[]
  faqs: UseCaseFaq[]
  relatedSlugs: string[]
}

export const useCases: UseCase[] = [
  {
    slug: 'schedule-by-text',
    href: '/schedule-by-text',
    cardTitle: 'Schedule meetings by text',
    cardDescription:
      'Text what you need, get the best times, and confirm with 1, 2, or 3 instead of bouncing between calendar views.',
    eyebrow: 'Schedule by text',
    title: 'Schedule meetings by text instead of opening your calendar.',
    description:
      'Manoa lets you text a scheduling request in plain language, get a few open times back, and confirm with a number. It is built for the moments when opening your calendar feels like too much friction.',
    intro:
      "This is one of Manoa's clearest use cases. You text something natural like a meeting request, Manoa checks availability, and it responds with options that fit your calendar.",
    exampleUser: '9am meeting Tuesday on work calendar',
    exampleManoa:
      "I found three good times. 1. Tue 9:00 AM on Work 2. Wed 10:00 AM on Work 3. Fri 8:45 AM on Work. Reply 1, 2, or 3.",
    benefits: [
      {
        title: 'Use plain language',
        body: 'You do not need a form. Text Manoa the way you would text a person.',
      },
      {
        title: 'Confirm before booking',
        body: 'Manoa only books after you choose an option, so the flow stays quick without feeling risky.',
      },
      {
        title: 'Keep the right calendar in play',
        body: 'You can mention work, personal, or family so Manoa knows where the event should go.',
      },
    ],
    idealFor: [
      'People who schedule throughout the day and do not want to keep switching into calendar view.',
      'Anyone juggling more than one calendar and wanting a faster way to place new events.',
      'Busy professionals who want a quicker alternative to links, forms, and back-and-forth.',
    ],
    steps: [
      {
        title: '1. Text the request',
        body: 'Send something like "schedule lunch tomorrow" or "9am meeting Tuesday on work calendar."',
      },
      {
        title: '2. Pick an option',
        body: 'Manoa checks your availability and responds with a few times that fit your calendar.',
      },
      {
        title: '3. Let Manoa book it',
        body: 'Reply with the number you want and Manoa places the event on the connected calendar.',
      },
    ],
    faqs: [
      {
        question: 'Does Manoa support Google Calendar and Outlook?',
        answer: 'Yes. The setup flow connects Google Calendar or Outlook after checkout.',
      },
      {
        question: 'Do I need to learn commands?',
        answer: 'No. Manoa is designed around natural text requests, not a command language.',
      },
      {
        question: 'What if I want a specific calendar?',
        answer:
          'You can say work, personal, or family in the text and Manoa uses that hint while scheduling.',
      },
      {
        question: 'Can I schedule recurring events this way too?',
        answer: 'Yes. Manoa already supports recurring weekly, biweekly, and monthly scheduling flows.',
      },
    ],
    relatedSlugs: [
      'calendar-reminders-by-text',
      'invite-people-by-text',
      'multiple-calendars-by-text',
    ],
  },
  {
    slug: 'calendar-reminders-by-text',
    href: '/calendar-reminders-by-text',
    cardTitle: 'Calendar reminders by text',
    cardDescription:
      'Get a daily agenda plus short reminder texts so your schedule stays visible without opening your calendar app.',
    eyebrow: 'Calendar reminders by text',
    title: 'Get your agenda and reminders by text.',
    description:
      'Manoa is not only for booking. It also keeps your day in front of you with morning agenda texts and short reminder messages before events start.',
    intro:
      'For a lot of people, the hard part is not getting events onto the calendar. It is remembering what is coming next without reopening the calendar every hour. Manoa helps by texting the schedule back to you.',
    exampleUser: "What's on my calendar tomorrow?",
    exampleManoa:
      "Tomorrow's schedule: 8:30 AM Workout (Personal) 10:00 AM Client review (Work) 3:00 PM Budget check-in (Work)",
    benefits: [
      {
        title: 'Morning agenda texts',
        body: 'Start the day with a short list of what is on your calendar.',
      },
      {
        title: 'Short reminder copy',
        body: 'Reminders are designed to be quick and useful, not noisy or overly chatty.',
      },
      {
        title: 'Works with your real calendar',
        body: 'When an event moves or gets canceled, Manoa is built to keep reminders aligned with the latest calendar state.',
      },
    ],
    idealFor: [
      'People who miss calendar notifications because they get buried under everything else on their phone.',
      'Users who want one simple morning summary of the day ahead.',
      'Anyone who likes texting more than opening productivity apps throughout the day.',
    ],
    steps: [
      {
        title: '1. Connect your calendar',
        body: 'After signup, connect Google Calendar or Outlook so Manoa can read the schedule.',
      },
      {
        title: '2. Ask for today or tomorrow',
        body: 'You can text Manoa for your schedule or just rely on the daily agenda flow once it is running.',
      },
      {
        title: '3. Get reminders before events',
        body: 'Manoa sends short texts before events so the important things stay visible at the right time.',
      },
    ],
    faqs: [
      {
        question: 'Are reminder texts marketing messages?',
        answer: 'No. They are service texts tied to your schedule, bookings, and account use.',
      },
      {
        question: 'Can Manoa tell me what is on my calendar today or tomorrow?',
        answer: 'Yes. That is already part of the texting flow and the homepage demo language.',
      },
      {
        question: 'What if an event changes?',
        answer: 'Manoa is designed to avoid stale reminders and keep reminders accurate when events move or get canceled.',
      },
      {
        question: 'Do I still need a calendar app?',
        answer:
          'You still keep your regular calendar account, but Manoa gives you a much lighter-weight way to stay on top of it by text.',
      },
    ],
    relatedSlugs: [
      'schedule-by-text',
      'recurring-events-by-text',
      'reschedule-appointments-by-text',
    ],
  },
  {
    slug: 'reschedule-appointments-by-text',
    href: '/reschedule-appointments-by-text',
    cardTitle: 'Reschedule appointments by text',
    cardDescription:
      'Handle doctor, dentist, salon, and service appointments honestly by prepping the call and updating your calendar after the change is confirmed.',
    eyebrow: 'Reschedule appointments by text',
    title: 'Handle appointment changes by text without pretending the office already confirmed them.',
    description:
      "This is one of Manoa's most distinctive workflows. For things like dentist, doctor, haircut, or service appointments, Manoa helps you prepare the change honestly instead of faking a real-world reschedule.",
    intro:
      'When the appointment belongs to an office or service business, Manoa keeps the experience helpful and truthful. It can suggest open times from your calendar, hold one for the call, and update your reminder after the office confirms the new slot.',
    exampleUser: 'Reschedule dentist',
    exampleManoa:
      "I can't change your dentist appointment with the office by text, but I can get you ready to call. Here are your next openings: 1. Thu 10:30 AM 2. Thu 2:00 PM 3. Fri 9:15 AM. Reply 1, 2, or 3 and I'll hold that time.",
    benefits: [
      {
        title: 'Truthful automation',
        body: 'Manoa helps without claiming it changed an office appointment when it has not.',
      },
      {
        title: 'Open-time prep',
        body: 'You can walk into the call already knowing which times fit your calendar.',
      },
      {
        title: 'Reminder updates after confirmation',
        body: 'Once the new time is real, Manoa can update the calendar side so your schedule stays accurate.',
      },
    ],
    idealFor: [
      'People who constantly need to move dentist, doctor, salon, therapy, or service appointments.',
      'Anyone who wants help with the awkward part of rescheduling without losing trust in the product.',
      'Users who want one assistant-like thread for both scheduling and appointment follow-through.',
    ],
    steps: [
      {
        title: '1. Text the appointment change',
        body: 'Send something like "reschedule dentist" and Manoa starts the safe call-prep flow.',
      },
      {
        title: '2. Pick the best opening',
        body: 'Manoa suggests open times from your own calendar and can hold one while you call.',
      },
      {
        title: '3. Confirm the new time',
        body: 'After the office confirms the change, text Manoa the new time and it updates your calendar reminder accordingly.',
      },
    ],
    faqs: [
      {
        question: 'Will Manoa say the office already confirmed the change?',
        answer:
          'No. This workflow is intentionally designed to avoid pretending a real-world appointment changed when only your calendar changed.',
      },
      {
        question: 'Can Manoa save office numbers?',
        answer: 'Yes. The product already includes business contact support so saved office numbers can be reused later.',
      },
      {
        question: 'What kinds of appointments fit this flow?',
        answer: 'It is a good fit for doctor, dentist, therapy, salon, repair, and similar service appointments.',
      },
      {
        question: 'Why not just move the event automatically?',
        answer:
          'Because the calendar entry and the real appointment are not always the same thing. Manoa is designed to stay honest about that difference.',
      },
    ],
    relatedSlugs: [
      'schedule-by-text',
      'calendar-reminders-by-text',
      'google-calendar-by-text',
    ],
  },
  {
    slug: 'google-calendar-by-text',
    href: '/google-calendar-by-text',
    cardTitle: 'Google Calendar by text',
    cardDescription:
      'Use Manoa with Google Calendar so you can check availability, book events, and get reminders by text.',
    eyebrow: 'Google Calendar by text',
    title: 'Use Google Calendar by text with Manoa.',
    description:
      'If Google Calendar is already where your schedule lives, Manoa gives you a simpler front door to it. You keep Google Calendar underneath and use text as the faster interface.',
    intro:
      'After you connect Google Calendar, Manoa can check free time, place events on the right calendar, send agenda texts, and keep reminders aligned with the schedule you already trust.',
    exampleUser: 'Schedule lunch tomorrow on personal calendar',
    exampleManoa:
      "I found three good times. 1. Tue 12:00 PM on Personal 2. Tue 1:30 PM on Personal 3. Wed 12:15 PM on Personal. Reply 1, 2, or 3.",
    benefits: [
      {
        title: 'Keep Google Calendar as the source of truth',
        body: 'Manoa works on top of the calendar you already use instead of replacing it.',
      },
      {
        title: 'Book and move events faster',
        body: 'Texting is often quicker than opening Google Calendar just to make a small change.',
      },
      {
        title: 'Stay synced',
        body: 'Agenda texts and reminders reflect the connected Google Calendar schedule.',
      },
    ],
    idealFor: [
      'Google Calendar users who want a faster way to schedule from their phone.',
      'People who already live in Gmail and Google Calendar but want less calendar friction.',
      'Users who want text-based scheduling without migrating away from Google.',
    ],
    steps: [
      {
        title: '1. Connect Google Calendar',
        body: 'After checkout, connect Google Calendar in the setup flow.',
      },
      {
        title: '2. Text what you need',
        body: 'Ask for your schedule, book something new, or move an existing event.',
      },
      {
        title: '3. Let Manoa handle the calendar update',
        body: 'Once you confirm by text, Manoa writes the change back to Google Calendar.',
      },
    ],
    faqs: [
      {
        question: 'Do I have to leave Google Calendar?',
        answer: 'No. Google Calendar stays where your events live. Manoa is just the text layer on top.',
      },
      {
        question: 'Can I still use Google Calendar normally?',
        answer: 'Yes. Manoa complements your existing calendar workflow instead of replacing it.',
      },
      {
        question: 'Can Manoa send Google Calendar reminders by text?',
        answer: 'Yes. Manoa supports agenda texts and reminder texts based on the connected schedule.',
      },
      {
        question: 'Can I connect more than one calendar later?',
        answer: 'Yes. Manoa supports multi-calendar setups and lets you choose which calendars block conflicts or receive new events.',
      },
    ],
    relatedSlugs: [
      'schedule-by-text',
      'multiple-calendars-by-text',
      'calendar-reminders-by-text',
    ],
  },
  {
    slug: 'outlook-calendar-by-text',
    href: '/outlook-calendar-by-text',
    cardTitle: 'Outlook Calendar by text',
    cardDescription:
      'Use Manoa with Outlook Calendar so you can schedule, reschedule, and stay on top of your day by text.',
    eyebrow: 'Outlook Calendar by text',
    title: 'Use Outlook Calendar by text with Manoa.',
    description:
      'If your schedule already runs through Outlook, Manoa gives you a faster way to work with it from your phone. You keep Outlook as the calendar and use text as the interface.',
    intro:
      'Connect Outlook once, then text Manoa for scheduling, reminders, and day-to-day calendar changes without hopping between apps and menus.',
    exampleUser: "What's on my calendar tomorrow?",
    exampleManoa:
      "Tomorrow's schedule: 8:30 AM Workout (Personal) 10:00 AM Client review (Work) 3:00 PM Budget check-in (Work)",
    benefits: [
      {
        title: 'Works with the calendar you already use',
        body: 'You do not need to switch away from Outlook to get a lighter scheduling experience.',
      },
      {
        title: 'Reduce small-friction calendar work',
        body: 'The quick changes that usually cost a few taps and menu visits become a text thread instead.',
      },
      {
        title: 'Stay visible on mobile',
        body: 'Text reminders and agenda summaries help keep Outlook events in front of you throughout the day.',
      },
    ],
    idealFor: [
      'Outlook Calendar users who live in Microsoft tools but want a faster workflow on mobile.',
      'People managing a mix of work meetings and personal tasks in Outlook.',
      'Users who want a simpler way to check, book, or move events from text.',
    ],
    steps: [
      {
        title: '1. Connect Outlook',
        body: 'After signup, connect Outlook Calendar in the setup flow.',
      },
      {
        title: '2. Text Manoa',
        body: 'Send a scheduling request, ask for your agenda, or move an event.',
      },
      {
        title: '3. Confirm the change',
        body: 'Once you confirm by text, Manoa updates the connected Outlook calendar.',
      },
    ],
    faqs: [
      {
        question: 'Can I use Manoa if Outlook is my main calendar?',
        answer: 'Yes. Outlook Calendar is supported directly in the setup flow.',
      },
      {
        question: 'Does Manoa replace Outlook?',
        answer: 'No. Outlook remains your calendar. Manoa gives you a text-based way to work with it.',
      },
      {
        question: 'Can Manoa help with reminders too?',
        answer: 'Yes. Manoa supports daily agendas and short reminder texts tied to your schedule.',
      },
      {
        question: 'Can I use Outlook and Google together?',
        answer: 'Yes. Manoa supports multi-calendar setups across connected accounts.',
      },
    ],
    relatedSlugs: [
      'schedule-by-text',
      'multiple-calendars-by-text',
      'calendar-reminders-by-text',
    ],
  },
  {
    slug: 'recurring-events-by-text',
    href: '/recurring-events-by-text',
    cardTitle: 'Recurring events by text',
    cardDescription:
      'Create weekly, biweekly, and monthly recurring events by text instead of rebuilding the same schedule over and over.',
    eyebrow: 'Recurring events by text',
    title: 'Create recurring events by text.',
    description:
      'Recurring calendar work is exactly the kind of thing that should feel simpler. Manoa supports recurring scheduling flows so regular events can start from a text instead of a form.',
    intro:
      'If you are setting the same meeting, routine, or reminder week after week, Manoa can help you create the recurring pattern directly from plain language.',
    exampleUser: 'Schedule team sync every Tuesday at 9am',
    exampleManoa:
      'I found these starting times: 1. Tue at 9:00 AM on Work 2. Tue at 10:00 AM on Work 3. Wed at 9:00 AM on Work. Repeats weekly. Reply 1, 2, or 3.',
    benefits: [
      {
        title: 'Reduce repeated setup',
        body: 'Text the pattern once instead of rebuilding the same event manually.',
      },
      {
        title: 'Support common repeat rules',
        body: 'Manoa already handles recurring weekly, biweekly, and monthly scheduling language.',
      },
      {
        title: 'Keep reminders tied to the series',
        body: 'Once the recurring event is booked, reminders stay connected to the actual calendar schedule.',
      },
    ],
    idealFor: [
      'People who manage weekly meetings, recurring routines, or monthly check-ins.',
      'Anyone who prefers texting a repeat rule instead of clicking through calendar recurrence menus.',
      'Users who want recurring events to feel lighter without giving up calendar control.',
    ],
    steps: [
      {
        title: '1. Text the recurring request',
        body: 'Send something like "every Tuesday at 9am" or "monthly budget review on the 15th."',
      },
      {
        title: '2. Pick the starting option',
        body: 'Manoa suggests times and includes the recurrence summary in the reply.',
      },
      {
        title: '3. Confirm the series',
        body: 'Reply with the option you want and Manoa books the recurring event on the connected calendar.',
      },
    ],
    faqs: [
      {
        question: 'What recurring patterns does Manoa support?',
        answer: 'Manoa already supports weekly, every-other-week, and monthly recurrence flows.',
      },
      {
        question: 'Can I create recurring meetings by text?',
        answer: 'Yes. Recurring scheduling is part of the supported text intent parsing.',
      },
      {
        question: 'Can recurring events include reminders too?',
        answer: 'Yes. Reminder support is tied to the calendar events Manoa creates.',
      },
      {
        question: 'Does Manoa support editing every case of a recurring series yet?',
        answer: 'Recurring-series editing is still a later-stage workflow, but recurring creation is already supported.',
      },
    ],
    relatedSlugs: [
      'schedule-by-text',
      'invite-people-by-text',
      'calendar-reminders-by-text',
    ],
  },
  {
    slug: 'invite-people-by-text',
    href: '/invite-people-by-text',
    cardTitle: 'Invite people by text',
    cardDescription:
      'Set up meetings with invitees by text and let Manoa handle known contacts while asking for missing emails only once.',
    eyebrow: 'Invite people by text',
    title: 'Invite people to meetings by text.',
    description:
      'Manoa can do more than create solo events. It also supports invitee flows so a meeting can start from a text and still include the right people.',
    intro:
      'If you already know the people involved, texting can be the fastest way to kick off the meeting. Manoa helps resolve invitees and books the event through the connected calendar.',
    exampleUser: 'Book budget review with Sam and Priya Tuesday at 2pm',
    exampleManoa:
      'I found these times: 1. Tue at 2:00 PM on Work 2. Wed at 2:30 PM on Work 3. Fri at 10:30 AM on Work. Ready to invite: Sam <sam@company.com>, Priya <priya@company.com>. Reply 1, 2, or 3.',
    benefits: [
      {
        title: 'Invite from a natural text',
        body: 'You can start with a meeting request instead of opening calendar attendee menus.',
      },
      {
        title: 'Ask for missing emails once',
        body: 'If Manoa does not know an email yet, it asks for the missing detail instead of failing silently.',
      },
      {
        title: 'Keep calendar-native invites',
        body: 'The meeting still lives in your connected calendar and uses the provider for attendee handling.',
      },
    ],
    idealFor: [
      'People setting up team syncs, check-ins, and recurring internal meetings.',
      'Users who already know the invitees and want a faster path to sending the calendar invite.',
      'Anyone trying to reduce the friction of scheduling with other people.',
    ],
    steps: [
      {
        title: '1. Text the meeting and invitees',
        body: 'Mention the people in the text request along with the title, day, and time.',
      },
      {
        title: '2. Resolve any missing details',
        body: 'If an email is missing, Manoa asks once so the meeting can still move forward.',
      },
      {
        title: '3. Confirm the booking',
        body: 'Once you choose the option, Manoa books the event and includes the invitees.',
      },
    ],
    faqs: [
      {
        question: 'Can Manoa invite people when I schedule by text?',
        answer: 'Yes. Invitee support is already part of the scheduling flow.',
      },
      {
        question: "What if Manoa doesn't know someone's email yet?",
        answer: 'It asks you for the missing email once, or you can book the meeting without the invite if you prefer.',
      },
      {
        question: 'Does the calendar still send updates through the provider?',
        answer: 'Yes. Manoa books through the connected calendar so invite handling stays provider-native.',
      },
      {
        question: 'Can I use this for one-on-ones and team meetings?',
        answer: 'Yes. It works for both as long as the meeting fits the supported scheduling flow.',
      },
    ],
    relatedSlugs: [
      'schedule-by-text',
      'recurring-events-by-text',
      'multiple-calendars-by-text',
    ],
  },
  {
    slug: 'multiple-calendars-by-text',
    href: '/multiple-calendars-by-text',
    cardTitle: 'Work and personal calendars by text',
    cardDescription:
      'Use Manoa across work, personal, and family calendars so the right calendar gets the event and the wrong one does not get ignored.',
    eyebrow: 'Multiple calendars by text',
    title: 'Manage multiple calendars by text.',
    description:
      'Manoa is especially useful when your day spans more than one calendar. You can teach it what each calendar means and use text hints like work or personal when you schedule.',
    intro:
      'The more calendars you juggle, the more friction small changes create. Manoa helps by checking conflicts across the calendars you choose and placing new events in the right destination.',
    exampleUser: '9am meeting Tuesday on work calendar',
    exampleManoa:
      "I found three good times. 1. Tue 9:00 AM on Work 2. Wed 10:00 AM on Work 3. Fri 8:45 AM on Work. Reply 1, 2, or 3.",
    benefits: [
      {
        title: 'Route events more clearly',
        body: 'Tell Manoa where an event belongs instead of dragging between calendars manually.',
      },
      {
        title: 'Check conflicts where they matter',
        body: 'Manoa respects the calendars you mark for conflict checking so open time is more realistic.',
      },
      {
        title: 'Keep work and personal separate without extra effort',
        body: 'You can preserve boundaries while still getting one text-based workflow.',
      },
    ],
    idealFor: [
      'People who juggle work and personal calendars every day.',
      'Parents, founders, and operators with overlapping schedules across different accounts.',
      'Users who want one assistant-like thread while still keeping calendar boundaries intact.',
    ],
    steps: [
      {
        title: '1. Connect your calendars',
        body: 'Connect the calendar accounts you want Manoa to see and route across.',
      },
      {
        title: '2. Label them clearly',
        body: 'In the dashboard, teach Manoa what each calendar should be called and how it should be used.',
      },
      {
        title: '3. Text with simple hints',
        body: 'Use words like work, personal, or family so Manoa knows where the event should land.',
      },
    ],
    faqs: [
      {
        question: 'Can Manoa work across multiple calendars?',
        answer: 'Yes. Manoa supports multi-calendar routing and conflict checking.',
      },
      {
        question: 'Can I choose which calendars block conflicts?',
        answer: 'Yes. The dashboard already lets you choose which connected calendars should block conflicting times.',
      },
      {
        question: 'Can I decide which calendars get new events?',
        answer: 'Yes. You can choose which connected calendars are allowed to receive new events.',
      },
      {
        question: 'Can I use both Google and Outlook accounts?',
        answer: 'Yes. Manoa supports connected calendars across both providers.',
      },
    ],
    relatedSlugs: [
      'schedule-by-text',
      'google-calendar-by-text',
      'outlook-calendar-by-text',
    ],
  },
]

export function getUseCaseBySlug(slug: string) {
  return useCases.find((useCase) => useCase.slug === slug) || null
}

export function getRelatedLinks(slug: string): UseCaseLink[] {
  const useCase = getUseCaseBySlug(slug)
  if (!useCase) return []

  return useCase.relatedSlugs
    .map((relatedSlug) => getUseCaseBySlug(relatedSlug))
    .filter((item): item is UseCase => Boolean(item))
    .map((item) => ({
      href: item.href,
      label: item.cardTitle,
      description: item.cardDescription,
    }))
}
