import type { Metadata } from 'next'
import ManoaWordmark from '@/src/components/ManoaWordmark'
import { siteSupportEmail } from '@/src/lib/siteMetadata'

export const metadata: Metadata = {
  title: 'Privacy Policy | Manoa',
  description: 'Privacy Policy for Manoa, the SMS calendar assistant.',
}

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <div className="legal-card">
        <ManoaWordmark className="legal-back compact" href="/" />
        <p className="legal-eyebrow">Privacy Policy</p>
        <h1 className="legal-title">Privacy Policy</h1>
        <p className="legal-updated">Last updated: May 5, 2026</p>

        <section className="legal-section">
          <h2>What Manoa collects</h2>
          <p>
            Manoa collects the information needed to run the service, including
            your name, email address, phone number, subscription status,
            connected calendar account details, message history with Manoa, and
            the event details required to schedule, remind, reschedule, or
            cancel calendar items on your behalf.
          </p>
        </section>

        <section className="legal-section">
          <h2>How Manoa uses your information</h2>
          <p>
            Manoa uses your information to provide the service you signed up
            for, including identifying your account when you text in,
            processing billing, checking calendar availability, creating or
            updating events, sending reminders and daily agenda messages, and
            improving service reliability and support.
          </p>
        </section>

        <section className="legal-section">
          <h2>Who Manoa shares information with</h2>
          <p>
            Manoa shares information only with the service providers needed to
            operate the product, such as Twilio for SMS delivery, Stripe for
            subscription billing, Supabase for account and data storage, and
            calendar providers you connect, such as Google Calendar. Manoa does
            not sell your personal information and does not share your personal
            information with third parties for their own marketing purposes.
          </p>
        </section>

        <section className="legal-section">
          <h2>Google user data</h2>
          <p>
            If you connect Google Calendar, Manoa accesses only the Google user
            data needed to provide calendar features you request. This may
            include your connected Google account email address, calendar names
            and calendar IDs, calendar availability, and the event details
            needed to read, create, update, or delete events on your behalf.
            Manoa also stores the authorization tokens needed to keep your
            Google Calendar connection working until you disconnect it or the
            connection is otherwise removed.
          </p>
        </section>

        <section className="legal-section">
          <h2>SMS consent</h2>
          <p>
            If you choose to opt in to Manoa text messages, you agree to
            receive service-related text messages such as scheduling options,
            booking confirmations, reminders, daily agenda messages, and
            account support messages. SMS consent is optional and is not
            required to complete signup, checkout, or use the web dashboard.
            Mobile information will not be shared with third parties or
            affiliates for marketing or promotional purposes. Text messaging
            originator opt-in data and consent will not be shared with third
            parties for their own marketing or promotional purposes.
          </p>
          <p>Message frequency may vary. Message and data rates may apply.</p>
        </section>

        <section className="legal-section">
          <h2>Data retention and security</h2>
          <p>
            Manoa keeps information only as long as needed to provide the
            service, comply with legal obligations, resolve disputes, and
            enforce agreements. Reasonable technical and organizational measures
            are used to protect account, billing, and calendar data.
          </p>
          <p>
            Google user data connected through Google Calendar is retained only
            for as long as needed to provide the calendar features you enable.
            If you disconnect your Google Calendar account from Manoa, Manoa
            removes the stored Google Calendar connection data and tokens from
            active use in the service. If you request account deletion, Manoa
            will delete stored Google Calendar connection data associated with
            your account, except where retention is required for legal,
            security, fraud-prevention, billing, or dispute-resolution
            purposes.
          </p>
        </section>

        <section className="legal-section">
          <h2>Your choices</h2>
          <p>
            You can reply <strong>STOP</strong> to opt out of SMS messages at
            any time, reply <strong>START</strong> to opt back in, and reply
            <strong> HELP</strong> for assistance. Message frequency varies and
            message and data rates may apply. You may also disconnect your
            calendar accounts or cancel your subscription through Manoa support.
          </p>
          <p>
            If you connected Google Calendar, you can disconnect it from your
            Manoa dashboard at any time. You can also revoke Manoa&apos;s access
            from your Google account permissions. For account or Google user
            data deletion requests, contact{' '}
            <a href={`mailto:${siteSupportEmail}`}>{siteSupportEmail}</a>.
          </p>
        </section>

        <section className="legal-section">
          <h2>Questions</h2>
          <p>
            For privacy questions, contact Manoa support at{' '}
            <a href={`mailto:${siteSupportEmail}`}>{siteSupportEmail}</a>.
          </p>
        </section>
      </div>
    </main>
  )
}
