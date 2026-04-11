import { stripe } from '@/src/lib/stripeClient'
import { appUrl } from '@/src/lib/env'
import { formatPhoneForDisplay } from '@/src/lib/phone'
import { listConfiguredGoogleCalendars } from '@/src/lib/calendar/google'
import { getDashboardProfile, getDashboardProfileByEmail } from '@/src/lib/profiles'
import { createSupabaseServerClient } from '@/src/lib/supabase/server'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Your Manoa Dashboard',
  description: 'Manage your Manoa account, calendar connection, and texting setup.',
}

type DashboardPageProps = {
  searchParams: Promise<{
    profile_id?: string
    session_id?: string
    calendar?: string
    login?: string
    billing?: string
  }>
}

function subscriptionLabel(status: string | null) {
  if (status === 'active') return 'Active'
  if (status === 'trialing') return 'Trialing'
  if (status === 'past_due') return 'Past due'
  if (status === 'canceled') return 'Canceled'
  return 'Pending'
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams
  let profileId = params.profile_id || ''
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!profileId && params.session_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const session = await stripe.checkout.sessions.retrieve(params.session_id)
      profileId = session.client_reference_id || session.metadata?.profile_id || ''
    } catch {
      profileId = ''
    }
  }

  const profile =
    (user?.email ? await getDashboardProfileByEmail(user.email) : null) ||
    (profileId ? await getDashboardProfile(profileId) : null)
  const manoaNumber = process.env.TWILIO_FROM_NUMBER?.trim() || ''
  const displayNumber = manoaNumber ? formatPhoneForDisplay(manoaNumber) : ''
  const displayUserPhone = profile ? formatPhoneForDisplay(profile.phone_e164) : ''
  const calendarConnected = params.calendar === 'connected'
  const billingMissing = params.billing === 'missing'
  const billingReturned = params.billing === 'returned'

  if (!profile) {
    return (
      <main className="dashboard-shell">
        <div className="dashboard-card">
          <a className="legal-back" href="/">
            Back to Manoa
          </a>
          <p className="legal-eyebrow">Dashboard</p>
          <h1 className="dashboard-title">We need your account link.</h1>
          <p className="dashboard-lede">
            Head back to the site and use the Log in button to email yourself a fresh Manoa login
            link.
          </p>
          <div className="dashboard-footer">
            <a className="button dashboard-button" href="/login">
              Go to login
            </a>
          </div>
        </div>
      </main>
    )
  }

  const googleAccounts = await listConfiguredGoogleCalendars(profile.id)
  const canAddGoogleAccount = googleAccounts.length < 2

  return (
    <main className="dashboard-shell">
      <div className="dashboard-card">
        <div className="dashboard-topbar">
          <a className="legal-back" href="/">
            Back to Manoa
          </a>
          <div className="dashboard-topbar-actions">
            <a className="nav-link" href={`${appUrl()}/dashboard${profileId ? `?profile_id=${profile.id}` : ''}`}>
              Refresh
            </a>
            {user ? (
              <a className="nav-link secondary" href="/auth/signout">
                Sign out
              </a>
            ) : null}
          </div>
        </div>

        <p className="legal-eyebrow">Dashboard</p>
        <h1 className="dashboard-title">You&apos;re ready to text Manoa.</h1>
        <p className="dashboard-lede">
          This is your home base for Manoa. It shows the number to text, the phone on your account,
          and whether your subscription and calendar are ready.
        </p>

        <div className="status-row" aria-label="Account status">
          <div className={`status-pill ${profile.subscriptionStatus === 'active' || profile.subscriptionStatus === 'trialing' ? 'ready' : 'pending'}`}>
            <strong>Subscription</strong>
            <span>{subscriptionLabel(profile.subscriptionStatus)}</span>
          </div>
          <div className={`status-pill ${profile.googleCalendarConnected ? 'ready' : 'pending'}`}>
            <strong>Calendar</strong>
            <span>{profile.googleCalendarConnected ? 'Connected' : 'Needs attention'}</span>
          </div>
          <div className={`status-pill ${manoaNumber ? 'ready' : 'pending'}`}>
            <strong>Text line</strong>
            <span>{displayNumber || 'Finishing setup'}</span>
          </div>
        </div>

        {calendarConnected ? (
          <div className="notice success" role="status" aria-live="polite">
            Google Calendar connected successfully.
          </div>
        ) : null}

        {params.login === 'success' ? (
          <div className="notice success" role="status" aria-live="polite">
            Dashboard opened. You can come back here any time from the login area on the homepage.
          </div>
        ) : null}

        {user ? (
          <div className="notice success" role="status" aria-live="polite">
            Signed in as {user.email}.
          </div>
        ) : null}

        {billingReturned ? (
          <div className="notice success" role="status" aria-live="polite">
            Billing updated. You are back in your Manoa dashboard.
          </div>
        ) : null}

        {billingMissing ? (
          <div className="notice warning" role="status" aria-live="polite">
            We could not find your billing record yet. Try again in a minute. If it still looks off,
            use the same email and phone on the homepage to reopen your dashboard.
          </div>
        ) : null}

        <section className="dashboard-hero-panel">
          <div>
            <p className="dashboard-kicker">Text this number</p>
            <h2>{displayNumber || 'Manoa number is still being finalized.'}</h2>
            <p>
              Text from <strong>{displayUserPhone}</strong> so Manoa recognizes you right away.
            </p>
            <p>
              Save Manoa once, then you always know where to text. If you ever need to stop or cancel,
              your billing link is right here too.
            </p>
            <p className="dashboard-hero-subnote">
              If carrier approval is still in progress, keep this page handy. The number and account
              setup are already in place.
            </p>
          </div>
          <div className="dashboard-hero-actions">
            {manoaNumber ? <a className="button dashboard-button" href={`sms:${manoaNumber}`}>Open text app</a> : null}
            <a className="button dashboard-button secondary-button" href="/api/contact-card">
              Save Manoa contact
            </a>
            <a className="button dashboard-button secondary-button" href={`/api/billing-portal?profile_id=${profile.id}`}>
              Manage billing
            </a>
            {!manoaNumber ? (
              <span className="dashboard-note">
                Add `TWILIO_FROM_NUMBER` in Vercel to show the live number here.
              </span>
            ) : null}
          </div>
        </section>

        <div className="dashboard-grid">
          <article className="dashboard-section">
            <p className="dashboard-label">Account</p>
            <h3>{profile.email}</h3>
            <p>Your saved phone: {displayUserPhone}</p>
            <p>Subscription: {subscriptionLabel(profile.subscriptionStatus)}</p>
            <p>Use Manage billing anytime to update payment details or cancel your membership.</p>
          </article>

          <article className="dashboard-section">
            <p className="dashboard-label">Calendar</p>
            <h3>{profile.googleCalendarConnected ? 'Google Calendar connected' : 'Calendar still missing'}</h3>
            <p>
              {profile.googleCalendarConnected
                ? `Manoa can check availability, book events, and keep reminders accurate across ${googleAccounts.length || 1} Google account${googleAccounts.length === 1 ? '' : 's'}.`
                : 'Connect Google Calendar so Manoa can find open times and book by text.'}
            </p>
            <a className="button dashboard-button" href={`/api/calendar/google/start?profile_id=${profile.id}`}>
              {profile.googleCalendarConnected ? 'Connect or reconnect Google Calendar' : 'Connect Google Calendar'}
            </a>
          </article>

          <article className="dashboard-section">
            <p className="dashboard-label">Start texting</p>
            <h3>Try one of these</h3>
            <p>9am meeting Tuesday on work calendar</p>
            <p>What&apos;s on my calendar tomorrow?</p>
            <p>Reschedule dentist</p>
            <p>Save Manoa in your contacts so this feels like texting a real assistant.</p>
          </article>
        </div>

        {googleAccounts.length ? (
          <section className="dashboard-calendar-manager">
            <div className="dashboard-calendar-manager-top">
              <div>
                <p className="dashboard-label">Calendar routing</p>
                <h2>Teach Manoa what each calendar means.</h2>
                <p>
                  Manoa checks every calendar you mark for conflicts. For new events, it uses the
                  calendar name you text, and if more than one destination could fit, it asks
                  instead of guessing.
                </p>
              </div>
              {canAddGoogleAccount ? (
                <a className="button dashboard-button" href={`/api/calendar/google/start?profile_id=${profile.id}`}>
                  Connect another Google account
                </a>
              ) : null}
            </div>

            <div className="calendar-account-stack">
              {googleAccounts.map((account) => (
                <article key={account.accountId} className="calendar-account-card">
                  <div className="calendar-account-head">
                    <div>
                      <h3>{account.accountEmail || 'Google account'}</h3>
                      <p>
                        {account.calendars.length} calendar{account.calendars.length === 1 ? '' : 's'} connected
                      </p>
                    </div>
                    <a
                      className="nav-link"
                      href={`/api/calendar/google/start?profile_id=${profile.id}&account_id=${account.accountId}`}
                    >
                      Reconnect account
                    </a>
                  </div>

                  <div className="calendar-settings-grid">
                    {account.calendars.map((calendar) => (
                      <form
                        key={calendar.connectionId}
                        action="/api/calendar/google/update"
                        method="post"
                        className="calendar-setting-card"
                      >
                        <input type="hidden" name="profile_id" value={profile.id} />
                        <input type="hidden" name="connection_id" value={calendar.connectionId} />

                        <div className="calendar-setting-head">
                          <div>
                            <strong>{calendar.sourceName}</strong>
                            <span>
                              {calendar.isPrimary ? 'Primary Google calendar' : 'Google calendar'}
                            </span>
                          </div>
                          {!calendar.canWrite ? (
                            <span className="calendar-setting-badge">Read only</span>
                          ) : null}
                        </div>

                        <label className="calendar-field">
                          <span>Name in Manoa</span>
                          <input name="calendar_label" defaultValue={calendar.label} />
                        </label>

                        <label className="calendar-toggle">
                          <input
                            type="checkbox"
                            name="include_in_conflicts"
                            defaultChecked={calendar.includeInConflicts}
                          />
                          <span>Use this to block conflicting times</span>
                        </label>

                        <label className="calendar-toggle">
                          <input
                            type="checkbox"
                            name="allow_new_events"
                            defaultChecked={calendar.allowNewEvents}
                            disabled={!calendar.canWrite}
                          />
                          <span>
                            {calendar.canWrite
                              ? 'Let Manoa place new events here'
                              : 'This calendar is read only'}
                          </span>
                        </label>

                        <button className="nav-link calendar-save-button" type="submit">
                          Save calendar settings
                        </button>
                      </form>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="dashboard-checklist">
          <p className="dashboard-label">Next steps</p>
          <div className="dashboard-checklist-grid">
            <div className="check-item">
              <strong>1. Save the number</strong>
              <span>Keep Manoa in your contacts so you do not have to hunt for it later.</span>
            </div>
            <div className="check-item">
              <strong>2. Send one real text</strong>
              <span>Start with a simple request like “What&apos;s on my calendar tomorrow?”</span>
            </div>
            <div className="check-item">
              <strong>3. Bookmark this page</strong>
              <span>Come back here for billing, reconnection, and account fixes.</span>
            </div>
          </div>
        </section>

        <div className="dashboard-footer">
          <a className="nav-link" href="/">
            Back to the site
          </a>
        </div>
      </div>
    </main>
  )
}
