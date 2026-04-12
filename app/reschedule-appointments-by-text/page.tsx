import type { Metadata } from 'next'
import UseCasePage from '@/src/components/UseCasePage'

export const metadata: Metadata = {
  title: 'Reschedule Appointments by Text | Manoa',
  description:
    'Use Manoa to prepare and manage appointment changes by text. Get open times, hold space on your calendar, and update reminders after the office confirms the new time.',
}

export default function RescheduleAppointmentsByTextPage() {
  return (
    <UseCasePage
      eyebrow="Reschedule appointments by text"
      title="Handle appointment changes by text without pretending the office already confirmed them."
      description="This is one of Manoa's most distinctive workflows. For things like dentist, doctor, haircut, or service appointments, Manoa helps you prepare the change honestly instead of faking a real-world reschedule."
      intro="When the appointment belongs to an office or service business, Manoa keeps the experience helpful and truthful. It can suggest open times from your calendar, hold one for the call, and update your reminder after the office confirms the new slot."
      exampleUser="Reschedule dentist"
      exampleManoa="I can't change your dentist appointment with the office by text, but I can get you ready to call. Here are your next openings: 1. Thu 10:30 AM 2. Thu 2:00 PM 3. Fri 9:15 AM. Reply 1, 2, or 3 and I'll hold that time."
      benefits={[
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
      ]}
      idealFor={[
        'People who constantly need to move dentist, doctor, salon, therapy, or service appointments.',
        'Anyone who wants help with the awkward part of rescheduling without losing trust in the product.',
        'Users who want one assistant-like thread for both scheduling and appointment follow-through.',
      ]}
      steps={[
        {
          title: '1. Text the appointment change',
          body: 'Send something like “reschedule dentist” and Manoa starts the safe call-prep flow.',
        },
        {
          title: '2. Pick the best opening',
          body: 'Manoa suggests open times from your own calendar and can hold one while you call.',
        },
        {
          title: '3. Confirm the new time',
          body: 'After the office confirms the change, text Manoa the new time and it updates your calendar reminder accordingly.',
        },
      ]}
      faqs={[
        {
          question: 'Will Manoa say the office already confirmed the change?',
          answer: 'No. This workflow is intentionally designed to avoid pretending a real-world appointment changed when only your calendar changed.',
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
          answer: 'Because the calendar entry and the real appointment are not always the same thing. Manoa is designed to stay honest about that difference.',
        },
      ]}
      relatedLinks={[
        {
          href: '/schedule-by-text',
          label: 'Schedule by text',
          description: 'See the simpler flow for booking something new.',
        },
        {
          href: '/calendar-reminders-by-text',
          label: 'Calendar reminders by text',
          description: 'See how reminders fit in after changes are made.',
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
