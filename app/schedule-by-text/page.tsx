import type { Metadata } from 'next'
import UseCasePage from '@/src/components/UseCasePage'

export const metadata: Metadata = {
  title: 'Schedule by Text | Manoa',
  description:
    'Schedule meetings and calendar events by text with Manoa. Text a request, get a few options, reply with a number, and let Manoa book it.',
}

export default function ScheduleByTextPage() {
  return (
    <UseCasePage
      eyebrow="Schedule by text"
      title="Schedule meetings by text instead of opening your calendar."
      description="Manoa lets you text a scheduling request in plain language, get a few open times back, and confirm with a number. It is built for the moments when opening your calendar feels like too much friction."
      intro="This is one of Manoa's clearest use cases. You text something natural like a meeting request, Manoa checks availability, and it responds with options that fit your calendar."
      exampleUser="9am meeting Tuesday on work calendar"
      exampleManoa="I found three good times. 1. Tue 9:00 AM on Work 2. Wed 10:00 AM on Work 3. Fri 8:45 AM on Work. Reply 1, 2, or 3."
      benefits={[
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
      ]}
      idealFor={[
        'People who schedule throughout the day and do not want to keep switching into calendar view.',
        'Anyone juggling more than one calendar and wanting a faster way to place new events.',
        'Busy professionals who want a quicker alternative to links, forms, and back-and-forth.',
      ]}
      steps={[
        {
          title: '1. Text the request',
          body: 'Send something like “schedule lunch tomorrow” or “9am meeting Tuesday on work calendar.”',
        },
        {
          title: '2. Pick an option',
          body: 'Manoa checks your availability and responds with a few times that fit your calendar.',
        },
        {
          title: '3. Let Manoa book it',
          body: 'Reply with the number you want and Manoa places the event on the connected calendar.',
        },
      ]}
      faqs={[
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
          answer: 'You can say work, personal, or family in the text and Manoa uses that hint while scheduling.',
        },
        {
          question: 'Can I schedule recurring events this way too?',
          answer: 'Yes. Manoa already supports recurring weekly, biweekly, and monthly scheduling flows.',
        },
      ]}
      relatedLinks={[
        {
          href: '/calendar-reminders-by-text',
          label: 'Calendar reminders by text',
          description: 'See how Manoa keeps the day visible after an event is booked.',
        },
        {
          href: '/reschedule-appointments-by-text',
          label: 'Reschedule appointments by text',
          description: 'See how Manoa handles changes when the event already exists.',
        },
        {
          href: '/use-cases',
          label: 'All use cases',
          description: 'Browse the rest of the use-case pages.',
        },
      ]}
    />
  )
}
