import { stripe } from '@/src/lib/stripeClient'
import { appUrl } from '@/src/lib/env'
import { formatPhoneForDisplay } from '@/src/lib/phone'
import { listConfiguredCalendarAccounts } from '@/src/lib/calendar/google'
import { getDashboardProfile, getDashboardProfileByEmail } from '@/src/lib/profiles'
import { createSupabaseServerClient } from '@/src/lib/supabase/server'
import CalendarSettingsForm from '@/src/components/CalendarSettingsForm'
import DisconnectCalendarAccountForm from '@/src/components/DisconnectCalendarAccountForm'
import DefaultDurationForm from '@/src/components/DefaultDurationForm'
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
    calendar_error?: string
    calendar_error_detail?: string
    login?: string
    billing?: string
    settings?: string
  }>
}

function providerLabel(provider: 'google' | 'outlook') {
  return provider === 'outlook' ? 'Outlook' : 'Google'
}

function statusLine({
  calendarConnected,
  manoaNumber,
}: {
  calendarConnected: boolean
  manoaNumber: string
}) {
  const calendarLabel = calendarConnected ? 'Calendar connected' : 'Calendar needs attention'
  const textLabel = manoaNumber ? 'Texting ready' : 'Texting pending approval'

  return `✅ ${calendarLabel} • ${textLabel}`
}

function calendarErrorMessage(code: string | undefined, detail?: string) {
  const extra = detail ? ` Details: ${detail}` : ''

  switch (code) {
    case 'account_limit':
      return `Manoa thinks you've already hit the 2 Google account limit. That usually means an older Google connection is still being counted.${extra}`
    case 'no_calendars':
      return `Google connected, but it didn't return any writable calendars for this account.${extra}`
    case 'insufficient_scopes':
      return `Google approved the sign-in, but Manoa still needs one more calendar permission to finish adding that account. Reconnect once after the latest deploy and it should ask for the missing access.${extra}`
    case 'duplicate':
      return `This Google account looks like it has a calendar Manoa already knows about, and the save step collided.${extra}`
    case 'db_constraint':
      return `The database save rules for calendars are still out of sync with the app.${extra}`
    case 'migration_missing':
      return `The database is still missing part of the newer multi-calendar schema.${extra}`
    default:
      return `We couldn't finish that calendar connection yet. The callback is returning a real error, but it still needs one more fix.${extra}`
  }
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
  const calendarRemoved = params.calendar === 'removed'
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
        <p className="dashboard-lede">Everything is set up. Send your first text to get started.</p>
        <p className="dashboard-status-line">{statusLine({
          calendarConnected: profile.calendarConnected,
          manoaNumber,
        })}</p>

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

        {calendarRemoved ? (
          <div className="notice success" role="status" aria-live="polite">
            Calendar removed from Manoa. You can reconnect the account later if you want it back.
          </div>
        ) : null}

        {calendarError ? (
          <div className="notice warning" role="status" aria-live="polite">
            {calendarErrorMessage(params.calendar_error, params.calendar_error_detail)}
          </div>
        ) : null}

        {params.login === 'success' ? (
          <div className="notice success" role="status" aria-live="polite">
            Dashboard opened. You can come back here any time from the login area on the homepage.
          </div>
        ) : null}

        {billingReturned ? (
          <div className="notice success" role="status" aria-live="polite">
            Billing updated. You are back in your Manoa dashboard.
          </div>
        ) : null}

        {params.settings === 'duration_saved' ? (
          <div className="notice success" role="status" aria-live="polite">
            Default event length saved. Manoa will use that when you do not specify a duration in the text.
          </div>
        ) : null}

        {params.settings === 'duration_unavailable' ? (
          <div className="notice warning" role="status" aria-live="polite">
            Default event length could not be saved yet because the latest profile settings update has not finished in the database.
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
            <p className="dashboard-label">Scheduling defaults</p>
            <h3>How long new events should be</h3>
            <p>
              When your text does not include a duration, Manoa will use this as the default length.
            </p>
            <DefaultDurationForm
              profileId={profile.id}
              defaultDurationMinutes={profile.default_event_duration_minutes}
            />
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
                      <DisconnectCalendarAccountForm
                        profileId={profile.id}
                        provider={account.provider}
                        accountId={account.accountId}
                      />
                    </div>
                  </div>

                  <div className="calendar-settings-grid">
                    {account.calendars.map((calendar) => (
                      <CalendarSettingsForm
                        key={calendar.connectionId}
                        profileId={profile.id}
                        connectionId={calendar.connectionId}
                        sourceName={calendar.sourceName}
                        providerLabel={providerLabel(calendar.provider)}
                        isPrimary={calendar.isPrimary}
                        canWrite={calendar.canWrite}
                        label={calendar.label}
                        includeInConflicts={calendar.includeInConflicts}
                        allowNewEvents={calendar.allowNewEvents}
                      />
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <div className="dashboard-footer">
          <a className="nav-link" href="/">
            Back to the site
          </a>
        </div>
      </div>
    </main>
  )
}
