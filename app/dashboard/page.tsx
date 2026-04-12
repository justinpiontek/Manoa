import { stripe } from '@/src/lib/stripeClient'
import { appUrl } from '@/src/lib/env'
import { formatPhoneForDisplay } from '@/src/lib/phone'
import { listConfiguredCalendarAccounts } from '@/src/lib/calendar/google'
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

function providerLabel(provider: 'google' | 'outlook') {
  return provider === 'outlook' ? 'Outlook' : 'Google'
}

function textLineLabel(number: string) {
  return number ? 'Ready' : 'Pending approval'
}

function nextStepCopy({
  subscriptionStatus,
  calendarConnected,
  manoaNumber,
}: {
  subscriptionStatus: string | null
  calendarConnected: boolean
  manoaNumber: string
}) {
  if (subscriptionStatus !== 'active' && subscriptionStatus !== 'trialing') {
    return 'Your account is almost there. As soon as billing is settled, Manoa will be fully ready.'
  }

  if (!calendarConnected) {
    return 'Connect a calendar, then Manoa can start finding open times and booking by text.'
  }

  if (!manoaNumber) {
    return 'Your account and calendar are ready. The text line is still finishing approval, so keep this page handy.'
  }

  return 'Everything is lined up. Save the number once, send your first text, and Manoa is off to the races.'
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
  const calendarDisconnected = params.calendar === 'disconnected'
  const calendarError = params.calendar === 'error'
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

  let calendarAccounts: Awaited<ReturnType<typeof listConfiguredCalendarAccounts>> = []
  let calendarSettingsWarning = ''

  try {
    calendarAccounts = await listConfiguredCalendarAccounts(profile.id)
  } catch (error) {
    calendarAccounts = []
    calendarSettingsWarning =
      error instanceof Error && error.message
        ? 'Your dashboard loaded, but the calendar settings section needs one more setup step. If you recently updated Manoa, a database migration may still be missing.'
        : 'Your dashboard loaded, but the calendar settings section could not be loaded yet.'
  }

  const googleAccounts = calendarAccounts.filter((account) => account.provider === 'google')
  const outlookAccounts = calendarAccounts.filter((account) => account.provider === 'outlook')
  const canAddGoogleAccount = googleAccounts.length < 2
  const canAddOutlookAccount = outlookAccounts.length < 2
  const totalConnectedAccounts = calendarAccounts.length
  const readyToText = Boolean(manoaNumber && profile.calendarConnected)
  const firstTextExample = totalConnectedAccounts > 1
    ? 'Schedule lunch Tuesday on Personal'
    : "What's on my calendar tomorrow?"

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

        <p className="dashboard-next-step">{nextStepCopy({
          subscriptionStatus: profile.subscriptionStatus,
          calendarConnected: profile.calendarConnected,
          manoaNumber,
        })}</p>

        <div className="status-row" aria-label="Account status">
          <div className={`status-pill ${profile.subscriptionStatus === 'active' || profile.subscriptionStatus === 'trialing' ? 'ready' : 'pending'}`}>
            <strong>Subscription</strong>
            <span>{subscriptionLabel(profile.subscriptionStatus)}</span>
          </div>
          <div className={`status-pill ${profile.calendarConnected ? 'ready' : 'pending'}`}>
            <strong>Calendar</strong>
            <span>{profile.calendarConnected ? 'Connected' : 'Needs attention'}</span>
          </div>
          <div className={`status-pill ${manoaNumber ? 'ready' : 'pending'}`}>
            <strong>Text line</strong>
            <span>{textLineLabel(manoaNumber)}</span>
          </div>
        </div>

        {calendarConnected ? (
          <div className="notice success" role="status" aria-live="polite">
            Calendar connected successfully.
          </div>
        ) : null}

        {calendarDisconnected ? (
          <div className="notice success" role="status" aria-live="polite">
            Calendar account disconnected. You can reconnect it any time from this page.
          </div>
        ) : null}

        {calendarError ? (
          <div className="notice warning" role="status" aria-live="polite">
            We couldn&apos;t finish that calendar connection. If you just turned on multi-calendar
            routing, the newest Supabase migration may still need to be run.
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

        {calendarSettingsWarning ? (
          <div className="notice warning" role="status" aria-live="polite">
            {calendarSettingsWarning}
          </div>
        ) : null}

        <section className="dashboard-hero-panel">
          <div className="dashboard-hero-copy">
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
              {manoaNumber
                ? 'Once the number is saved, texting Manoa should feel like texting a real assistant.'
                : 'If carrier approval is still in progress, keep this page handy. The account and calendar setup are already in place.'}
            </p>

            <div className="dashboard-example-card">
              <span className="dashboard-example-label">First text to send</span>
              <strong>{firstTextExample}</strong>
            </div>
          </div>

          <div className="dashboard-hero-side">
            <div className="dashboard-hero-actions">
              {manoaNumber ? <a className="button dashboard-button" href={`sms:${manoaNumber}`}>Text Manoa now</a> : null}
              <a className="button dashboard-button secondary-button" href="/api/contact-card">
                Save Manoa contact
              </a>
              <a className="button dashboard-button secondary-button" href={`/api/billing-portal?profile_id=${profile.id}`}>
                Manage billing
              </a>
            </div>

            <div className="dashboard-hero-meta">
              <div>
                <span>Signed in</span>
                <strong>{profile.email}</strong>
              </div>
              <div>
                <span>Your phone</span>
                <strong>{displayUserPhone}</strong>
              </div>
              <div>
                <span>Calendars ready</span>
                <strong>{totalConnectedAccounts || 0}</strong>
              </div>
            </div>

            <p className="dashboard-note">
              {manoaNumber
                ? 'Manoa only books after you confirm by text.'
                : 'Your number will appear here as soon as texting approval finishes.'}
            </p>
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
            <h3>{profile.calendarConnected ? 'Calendar connected' : 'Calendar still missing'}</h3>
            <p>
              {profile.calendarConnected
                ? `Manoa can check availability, book events, and keep reminders accurate across ${totalConnectedAccounts || 1} connected account${totalConnectedAccounts === 1 ? '' : 's'}.`
                : 'Connect Google or Outlook so Manoa can find open times and book by text.'}
            </p>
            <div className="dashboard-hero-actions">
              <a className="button dashboard-button" href={`/api/calendar/google/start?profile_id=${profile.id}`}>
                {googleAccounts.length ? 'Connect or reconnect Google' : 'Connect Google Calendar'}
              </a>
              <a className="button dashboard-button secondary-button" href={`/api/calendar/outlook/start?profile_id=${profile.id}`}>
                {outlookAccounts.length ? 'Connect or reconnect Outlook' : 'Connect Outlook Calendar'}
              </a>
            </div>
          </article>

          <article className="dashboard-section">
            <p className="dashboard-label">Start texting</p>
            <h3>{readyToText ? 'Start with one of these' : 'What you will text soon'}</h3>
            <ul className="dashboard-example-list">
              <li>9am meeting Tuesday on work calendar</li>
              <li>What&apos;s on my calendar tomorrow?</li>
              <li>Reschedule dentist</li>
            </ul>
            <p>Save Manoa in your contacts so this feels like texting a real assistant.</p>
          </article>
        </div>

        {calendarAccounts.length ? (
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
              <div className="dashboard-hero-actions">
                {canAddGoogleAccount ? (
                  <a className="button dashboard-button" href={`/api/calendar/google/start?profile_id=${profile.id}`}>
                    Connect another Google account
                  </a>
                ) : null}
                {canAddOutlookAccount ? (
                  <a className="button dashboard-button secondary-button" href={`/api/calendar/outlook/start?profile_id=${profile.id}`}>
                    Connect Outlook account
                  </a>
                ) : null}
              </div>
            </div>

            <div className="calendar-account-stack">
              {calendarAccounts.map((account) => (
                <article key={account.accountId} className="calendar-account-card">
                  <div className="calendar-account-head">
                    <div>
                      <h3>{account.accountEmail || `${providerLabel(account.provider)} account`}</h3>
                      <p>
                        {providerLabel(account.provider)} • {account.calendars.length} calendar
                        {account.calendars.length === 1 ? '' : 's'} connected
                      </p>
                    </div>
                    <div className="calendar-account-actions">
                      <a
                        className="nav-link"
                        href={
                          account.provider === 'outlook'
                            ? `/api/calendar/outlook/start?profile_id=${profile.id}&account_id=${account.accountId}`
                            : `/api/calendar/google/start?profile_id=${profile.id}&account_id=${account.accountId}`
                        }
                      >
                        Reconnect account
                      </a>
                      <form action="/api/calendar/disconnect" method="post">
                        <input type="hidden" name="profile_id" value={profile.id} />
                        <input type="hidden" name="provider" value={account.provider} />
                        <input type="hidden" name="account_id" value={account.accountId} />
                        <button className="nav-link secondary" type="submit">
                          Disconnect
                        </button>
                      </form>
                    </div>
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
                              {calendar.isPrimary
                                ? `Primary ${providerLabel(calendar.provider)} calendar`
                                : `${providerLabel(calendar.provider)} calendar`}
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
