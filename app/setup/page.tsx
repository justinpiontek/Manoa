import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Set Up Manoa',
  description: 'Connect your calendar so Manoa can schedule by text.',
}

type SetupPageProps = {
  searchParams: Promise<{
    profile_id?: string
    calendar?: string
  }>
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const params = await searchParams
  const profileId = params.profile_id || ''
  const calendarConnected = params.calendar === 'connected'

  return (
    <main className="setup-shell">
      <div className="setup-card">
        <a className="legal-back" href="/">
          Back to Manoa
        </a>
        <p className="legal-eyebrow">Setup</p>
        <h1 className="setup-title">
          {calendarConnected ? 'Calendar connected.' : 'One more step and Manoa is ready.'}
        </h1>
        <p className="setup-lede">
          {calendarConnected
            ? 'Your Google Calendar is connected. Manoa can now check your availability, offer open times, and book events after you confirm by text.'
            : 'After you subscribe, connect Google Calendar so Manoa can see availability and book events for you by text.'}
        </p>

        {calendarConnected ? (
          <div className="notice success" role="status" aria-live="polite">
            Google Calendar connected successfully.
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
              Connect Google Calendar so Manoa can find open times, book events, send daily agendas,
              and keep reminders accurate.
            </p>
            {profileId ? (
              <a className="button setup-action" href={`/api/calendar/google/start?profile_id=${profileId}`}>
                {calendarConnected ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}
              </a>
            ) : (
              <p className="setup-note">
                Missing setup link. Head back to the signup page and restart checkout.
              </p>
            )}
          </article>

          <article className="setup-step">
            <span className="step-number">3</span>
            <h2>Text Manoa</h2>
            <p>
              Once Manoa&apos;s number is live, you&apos;ll text it things like “9am meeting Tuesday on work
              calendar” or “what&apos;s on my calendar tomorrow?”
            </p>
            <p className="setup-note">
              If you need to come back later, this step can wait until the phone number is fully set up.
            </p>
          </article>
        </div>

        <div className="setup-footer">
          <a className="nav-link" href="/">
            Back to the site
          </a>
        </div>
      </div>
    </main>
  )
}
