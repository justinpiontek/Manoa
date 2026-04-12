import type { Metadata } from 'next'
import UseCasePage from '@/src/components/UseCasePage'

export const metadata: Metadata = {
  title: 'Calendar Reminders by Text | Manoa',
  description:
    'Get daily agenda texts and calendar reminders by text with Manoa so your schedule stays visible without opening another app.',
}

export default function CalendarRemindersByTextPage() {
  return (
    <UseCasePage
      eyebrow="Calendar reminders by text"
      title="Get your agenda and reminders by text."
      description="Manoa is not only for booking. It also keeps your day in front of you with morning agenda texts and short reminder messages before events start."
      intro="For a lot of people, the hard part is not getting events onto the calendar. It is remembering what is coming next without reopening the calendar every hour. Manoa helps by texting the schedule back to you."
      exampleUser="What's on my calendar tomorrow?"
      exampleManoa="Tomorrow's schedule: 8:30 AM Workout (Personal) 10:00 AM Client review (Work) 3:00 PM Budget check-in (Work)"
      benefits={[
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
      ]}
      idealFor={[
        'People who miss calendar notifications because they get buried under everything else on their phone.',
        'Users who want one simple morning summary of the day ahead.',
        'Anyone who likes texting more than opening productivity apps throughout the day.',
      ]}
      steps={[
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
      ]}
      faqs={[
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
          answer: 'You still keep your regular calendar account, but Manoa gives you a much lighter-weight way to stay on top of it by text.',
        },
      ]}
      relatedLinks={[
        {
          href: '/schedule-by-text',
          label: 'Schedule by text',
          description: 'Use Manoa to create the event first, then get reminders later.',
        },
        {
          href: '/reschedule-appointments-by-text',
          label: 'Reschedule appointments by text',
          description: 'See how Manoa handles changes to events and appointments.',
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
