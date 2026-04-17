import { stripe } from '@/src/lib/stripeClient'
import { formatPhoneForDisplay } from '@/src/lib/phone'
import ManoaWordmark from '@/src/components/ManoaWordmark'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Set Up Manoa',
  description: 'Connect your calendar so Manoa can schedule by text.',
}

type SetupPageProps = {
  searchParams: Promise<{
    profile_id?: string
    session_id?: string
    calendar?: string
  }>
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const params = await searchParams
  let profileId = params.profile_id || ''
  const calendarConnected = params.calendar === 'connected'

  if (!profileId && params.session_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const session = await stripe.checkout.sessions.retrieve(params.session_id)
      profileId =
        session.client_reference_id || session.metadata?.profile_id || ''
    } catch {
      profileId = ''
    }
  }

  const manoaNumber = process.env.TWILIO_FROM_NUMBER?.trim() || ''
  const displayNumber = manoaNumber ? formatPhoneForDisplay(manoaNumber) : ''

  return (
    <main className="setup-shell">
      <div className="setup-card">
        <ManoaWordmark className="legal-back compact" href="/" />
        <p className="legal-eyebrow">Setup</p>
        <h1 className="setup-title">
          {calendarConnected ? 'Calendar connected.' : 'One more step and Manoa is ready.'}
        </h1>
        <p className="setup-lede">
          {calendarConnected
            ? 'Your calendar is connected. Manoa can now check your availability, offer open times, and book events after you confirm by text.'
            : 'After you subscribe, connect Google or Outlook so Manoa can see availability and book events for you by text.'}
        </p>

        <div className="status-row" aria-label="Setup status">
          <div className="status-pill ready">
            <strong>Subscription</strong>
            <span>Set up</span>
          </div>
          <div className={`status-pill ${calendarConnected ? 'ready' : 'pending'}`}>
            <strong>Calendar</strong>
            <span>{calendarConnected ? 'Connected' : 'Still needed'}</span>
          </div>
          <div className={`status-pill ${displayNumber ? 'ready' : 'pending'}`}>
            <strong>Text line</strong>
            <span>{displayNumber ? displayNumber : 'Finishing setup'}</span>
          </div>
        </div>

        {calendarConnected ? (
          <div className="notice success" role="status" aria-live="polite">
            Calendar connected successfully.
          </div>
        ) : null}

        <div className="setup-grid">
          <article className="setup-step">
            <span className="step-number">1</span>
            <h2>Subscription</h2>
            <p>Your plan is set up. Manoa now knows which account and phone number belong together.</p>
          </article>

          <article className="setup-step">
            <span className="step-number">2</span>
            <h2>Calendar connection</h2>
            <p>
              Connect Google or Outlook so Manoa can find open times, book events, send daily agendas,
              and keep reminders accurate.
            </p>
            {profileId ? (
              <div className="dashboard-hero-actions">
                <a className="button setup-action" href={`/api/calendar/google/start?profile_id=${profileId}`}>
                  {calendarConnected ? 'Connect or reconnect Google' : 'Connect Google Calendar'}
                </a>
                <a className="button setup-action secondary-button" href={`/api/calendar/outlook/start?profile_id=${profileId}`}>
                  {calendarConnected ? 'Connect or reconnect Outlook' : 'Connect Outlook Calendar'}
                </a>
              </div>
            ) : (
              <p className="setup-note">
                Missing setup link. Head back to the signup page and restart checkout.
              </p>
            )}
          </article>

          <article className="setup-step">
            <span className="step-number">3</span>
            <h2>Text Manoa</h2>
            {displayNumber ? (
              <p>
                Text <strong>{displayNumber}</strong> from the phone you signed up with. Try things like
                “9am meeting Tuesday on work calendar” or “what&apos;s on my calendar tomorrow?”
              </p>
            ) : (
              <p>
                Once Manoa&apos;s number is live, you&apos;ll text it things like “9am meeting Tuesday on work
                calendar” or “what&apos;s on my calendar tomorrow?”
              </p>
            )}
            <p className="setup-note">
              Save Manoa in your contacts from the dashboard so this feels like texting a real
              assistant, not opening software.
            </p>
          </article>
        </div>

        <div className="setup-footer">
          {manoaNumber ? (
            <a className="button dashboard-link-button" href="/api/contact-card">
              Save Manoa contact
            </a>
          ) : null}
          {profileId ? (
            <a className="button dashboard-link-button" href={`/dashboard?profile_id=${profileId}`}>
              Open dashboard
            </a>
          ) : null}
          <a className="nav-link" href="/">
            Back to the site
          </a>
        </div>
      </div>
    </main>
  )
}
