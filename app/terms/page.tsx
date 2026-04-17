import type { Metadata } from 'next'
import ManoaWordmark from '@/src/components/ManoaWordmark'

export const metadata: Metadata = {
  title: 'Terms and Conditions | Manoa',
  description: 'Terms and Conditions for Manoa, the SMS calendar assistant.',
}

export default function TermsPage() {
  return (
    <main className="legal-shell">
      <div className="legal-card">
        <ManoaWordmark className="legal-back compact" href="/" />
        <p className="legal-eyebrow">Terms and Conditions</p>
        <h1 className="legal-title">Terms and Conditions</h1>
        <p className="legal-updated">Last updated: April 8, 2026</p>

        <section className="legal-section">
          <h2>Using Manoa</h2>
          <p>
            Manoa is an SMS-based calendar assistant. By signing up, you agree
            to use the service only for lawful purposes and to provide accurate
            account, payment, and phone information so Manoa can identify your
            account and process your requests.
          </p>
        </section>

        <section className="legal-section">
          <h2>SMS program terms</h2>
          <p>
            By providing your phone number and using Manoa, you agree to
            receive text messages related to scheduling, booking confirmations,
            reminders, daily agenda summaries, rescheduling support, account
            support, and other service-related updates. Message frequency
            varies. Message and data rates may apply.
          </p>
          <p>
            Reply <strong>STOP</strong> to opt out, <strong>START</strong> to
            opt back in, and <strong>HELP</strong> for assistance. Carriers are
            not liable for delayed or undelivered messages.
          </p>
          <p>
            See the <a href="/privacy">Privacy Policy</a> and{' '}
            <a href="/terms">Terms and Conditions</a> for more information
            about the Manoa SMS program.
          </p>
        </section>

        <section className="legal-section">
          <h2>Subscriptions and billing</h2>
          <p>
            Manoa is offered as a recurring subscription. By subscribing, you
            authorize recurring charges at the price shown during checkout until
            you cancel. Subscription billing is processed by Stripe.
          </p>
        </section>

        <section className="legal-section">
          <h2>Calendar connections and automation</h2>
          <p>
            You are responsible for connecting only calendar accounts you are
            authorized to use. Manoa may create, update, or remove calendar
            events based on your text instructions and connected account
            permissions. Some requests, such as medical or business appointment
            changes, may require your direct confirmation with the office or
            organizer.
          </p>
        </section>

        <section className="legal-section">
          <h2>No emergency or professional service</h2>
          <p>
            Manoa is not an emergency service, healthcare provider, legal
            advisor, or financial advisor. Do not use Manoa for emergencies or
            time-critical situations where delayed delivery could cause harm.
          </p>
        </section>

        <section className="legal-section">
          <h2>Account suspension or cancellation</h2>
          <p>
            Manoa may suspend or cancel access for non-payment, abuse, fraud,
            unlawful use, or misuse of the service. You may cancel your
            subscription at any time, and access will continue through the end
            of the current billing period unless otherwise stated at checkout.
          </p>
        </section>

        <section className="legal-section">
          <h2>Changes to the service</h2>
          <p>
            Manoa may update features, pricing, or these terms from time to
            time. Continued use of the service after an update means you accept
            the revised terms.
          </p>
        </section>

        <section className="legal-section">
          <h2>Questions</h2>
          <p>
            For questions about these terms, contact Manoa support at{' '}
            <a href="mailto:justin.piontek@gmail.com">justin.piontek@gmail.com</a>.
          </p>
        </section>
      </div>
    </main>
  )
}
