import { stripe } from '@/src/lib/stripeClient'
import { formatPhoneForDisplay } from '@/src/lib/phone'
import { getAuthenticatedDashboardProfile } from '@/src/lib/dashboardAuth'
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
  let checkoutComplete = false
  const calendarConnected = params.calendar === 'connected'

  if (params.session_id && process.env.STRIPE_SECRET_KEY) {
    try {
      await stripe.checkout.sessions.retrieve(params.session_id)
      checkoutComplete = true
    } catch {
      checkoutComplete = false
    }
  }

  const manoaNumber = process.env.TWILIO_FROM_NUMBER?.trim() || ''
  const displayNumber = manoaNumber ? formatPhoneForDisplay(manoaNumber) : ''
  const authenticatedProfile = await getAuthenticatedDashboardProfile()
  const displayUserPhone = authenticatedProfile?.phone_e164
    ? formatPhoneForDisplay(authenticatedProfile.phone_e164)
    : ''
  const authenticatedForThisSetup = Boolean(authenticatedProfile)
  const appleConnectHref = '/setup/apple-calendar'

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
            : 'After you subscribe, connect Google, Outlook, or Apple Calendar so Manoa can see availability and book events for you by text.'}
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

        {!authenticatedForThisSetup ? (
          <div className="notice warning" role="status" aria-live="polite">
            {checkoutComplete
              ? 'Payment is done. Use the secure email login link to open your dashboard before connecting a calendar.'
              : 'Use the secure email login link to open your dashboard before connecting a calendar.'}
          </div>
        ) : null}

        <div className="setup-grid">
          <article className="setup-step">
            <span className="step-number">1</span>
            <h2>Subscription</h2>
            <p>
              {authenticatedForThisSetup
                ? 'Your plan is set up. You can use Manoa in the dashboard right away, with or without texting.'
                : 'Your plan is set up. Next, open your dashboard with your secure email login link.'}
            </p>
          </article>

          <article className="setup-step">
            <span className="step-number">2</span>
            <h2>Calendar connection</h2>
            <p>
              Connect Google, Outlook, or Apple so Manoa can find open times, book events, send daily
              agendas, and keep reminders accurate. Apple Calendar still uses the longer manual iCloud
              path.
            </p>
            {authenticatedForThisSetup ? (
              <div className="dashboard-hero-actions">
                <a className="button setup-action" href="/api/calendar/google/start">
                  {calendarConnected ? 'Connect or reconnect Google' : 'Connect Google Calendar'}
                </a>
                <a className="button setup-action secondary-button" href="/api/calendar/outlook/start">
                  Connect Outlook Calendar
                </a>
                <a className="button setup-action secondary-button" href={appleConnectHref}>
                  Connect Apple Calendar
                </a>
              </div>
            ) : (
              <p className="setup-note">
                Log in first, then connect your calendar from here or from the dashboard.
              </p>
            )}
          </article>

          <article className="setup-step">
            <span className="step-number">3</span>
            <h2>Text Manoa</h2>
            {displayNumber && displayUserPhone ? (
              <p>
                Text <strong>{displayNumber}</strong> from <strong>{displayUserPhone}</strong>. Try things like
                “9am meeting Tuesday on work calendar” or “what&apos;s on my calendar tomorrow?”
              </p>
            ) : (
              <p>
                Texting is optional. If you want it later, add your phone and turn on SMS from the dashboard.
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
          {authenticatedForThisSetup ? (
            <a className="button dashboard-link-button" href="/dashboard">
              Open dashboard
            </a>
          ) : (
            <a className="button dashboard-link-button" href="/login">
              Log in to open dashboard
            </a>
          )}
          <a className="nav-link" href="/">
            Back to the site
          </a>
        </div>
      </div>
    </main>
  )
}
