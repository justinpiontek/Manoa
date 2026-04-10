import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy | Manoa',
  description: 'Privacy Policy for Manoa, the SMS calendar assistant.',
}

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <div className="legal-card">
        <a className="legal-back" href="/">
          Back to Manoa
        </a>
        <p className="legal-eyebrow">Privacy Policy</p>
        <h1 className="legal-title">Privacy Policy</h1>
        <p className="legal-updated">Last updated: April 8, 2026</p>

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
          <h2>SMS consent</h2>
          <p>
            When you sign up for Manoa and provide your phone number, you are
            giving consent to receive service-related text messages such as
            scheduling options, booking confirmations, reminders, daily agenda
            messages, and account support messages. SMS consent is not shared
            with third parties or affiliates for marketing purposes.
          </p>
        </section>

        <section className="legal-section">
          <h2>Data retention and security</h2>
          <p>
            Manoa keeps information only as long as needed to provide the
            service, comply with legal obligations, resolve disputes, and
            enforce agreements. Reasonable technical and organizational measures
            are used to protect account, billing, and calendar data.
          </p>
        </section>

        <section className="legal-section">
          <h2>Your choices</h2>
          <p>
            You can reply <strong>STOP</strong> to opt out of SMS messages at
            any time, reply <strong>START</strong> to opt back in, and reply
            <strong> HELP</strong> for assistance. You may also disconnect your
            calendar accounts or cancel your subscription through Manoa support.
          </p>
        </section>

        <section className="legal-section">
          <h2>Questions</h2>
          <p>
            For privacy questions, contact Manoa support through the service
            signup or account support channel you used to join.
          </p>
        </section>
      </div>
    </main>
  )
}
