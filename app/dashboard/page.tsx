import { stripe } from '@/src/lib/stripeClient'
import { appUrl } from '@/src/lib/env'
import { formatPhoneForDisplay } from '@/src/lib/phone'
import { listConfiguredCalendarAccounts, type CalendarProvider } from '@/src/lib/calendar/google'
import { getDashboardProfile, getDashboardProfileByEmail } from '@/src/lib/profiles'
import { listSmsThreadEntries, toSmsThreadMessages } from '@/src/lib/sms/thread'
import { createSupabaseServerClient } from '@/src/lib/supabase/server'
import ManoaWordmark from '@/src/components/ManoaWordmark'
import CalendarSettingsForm from '@/src/components/CalendarSettingsForm'
import DisconnectCalendarAccountForm from '@/src/components/DisconnectCalendarAccountForm'
import DefaultDurationForm from '@/src/components/DefaultDurationForm'
import DashboardTextConsole from '@/src/components/DashboardTextConsole'
import TimezoneForm from '@/src/components/TimezoneForm'
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

function providerLabel(provider: CalendarProvider) {
  if (provider === 'outlook') return 'Outlook'
  if (provider === 'apple') return 'Apple'
  return 'Google'
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

function accountConflictSummary(calendars: Awaited<ReturnType<typeof listConfiguredCalendarAccounts>>[number]['calendars']) {
  const count = calendars.filter((calendar) => calendar.includeInConflicts).length
  if (!count) return 'Not checking conflicts yet'
  return `Checks ${count} calendar${count === 1 ? '' : 's'} for conflicts`
}

function accountBookingSummary(calendars: Awaited<ReturnType<typeof listConfiguredCalendarAccounts>>[number]['calendars']) {
  const bookingCalendars = calendars.filter((calendar) => calendar.allowNewEvents)
  if (!bookingCalendars.length) return 'No booking calendar chosen'

  const names = bookingCalendars.slice(0, 2).map((calendar) => calendar.label || calendar.sourceName)
  const extraCount = bookingCalendars.length - names.length
  return `Books to ${names.join(', ')}${extraCount > 0 ? ` +${extraCount} more` : ''}`
}

function calendarErrorMessage(code: string | undefined, detail?: string) {
  const extra = detail ? ` Details: ${detail}` : ''

  switch (code) {
    case 'account_limit':
      return `Manoa hit the current account limit for that calendar provider.${extra}`
    case 'no_calendars':
      return `That calendar account connected, but it did not return any usable calendars for Manoa yet.${extra}`
    case 'insufficient_scopes':
      return `Google approved the sign-in, but Manoa still needs one more calendar permission to finish adding that account. Reconnect once after the latest deploy and it should ask for the missing access.${extra}`
    case 'apple_auth':
      return `Apple did not accept that iCloud email and app-specific password.${extra}`
    case 'apple_connect':
      return `Apple Calendar could not be connected yet.${extra}`
    case 'mailbox_missing':
      return `Microsoft signed you in, but that Outlook account does not seem to have a usable mailbox/calendar behind it yet.${extra}`
    case 'permissions':
      return `Microsoft signed you in, but the calendar permission step did not fully go through.${extra}`
    case 'duplicate':
      return `That calendar account looks like it has a calendar Manoa already knows about, and the save step collided.${extra}`
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
          <ManoaWordmark className="legal-back compact" href="/" />
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
  const appleAccounts = calendarAccounts.filter((account) => account.provider === 'apple')
  const canAddGoogleAccount = googleAccounts.length < 2
  const canAddOutlookAccount = outlookAccounts.length < 2
  const canAddAppleAccount = appleAccounts.length < 1
  const appleConnectHref = canAddAppleAccount
    ? `/setup/apple-calendar?profile_id=${profile.id}`
    : `/setup/apple-calendar?profile_id=${profile.id}&account_id=${appleAccounts[0]?.accountId || ''}`
  const totalConnectedAccounts = calendarAccounts.length
  const readyToText = Boolean(manoaNumber && profile.calendarConnected)
  const firstTextExample = totalConnectedAccounts > 1
    ? 'Schedule lunch Tuesday on Personal'
    : "What's on my calendar tomorrow?"
  const connectedAccountLabel = `${totalConnectedAccounts} connected account${totalConnectedAccounts === 1 ? '' : 's'}`
  const calendarStageHeading = totalConnectedAccounts ? 'Teach Manoa what each calendar means.' : 'Connect your calendar.'
  const calendarStageCopy = totalConnectedAccounts
    ? 'Most people can leave this alone. Manoa checks calendars marked for conflicts, then uses the calendar name you text when placing new events.'
    : 'Connect Google, Outlook, or Apple Calendar first so Manoa can check availability, route events to the right calendar, and book by text.'
  const textingStageCopy = readyToText
    ? `Text from ${displayUserPhone} so Manoa recognizes you right away, or use the live console here.`
    : 'Your texting number will show here as soon as approval finishes. Until then, use the live console here with your real account.'
  const quickExamples = totalConnectedAccounts > 1
    ? [
        'Schedule lunch Tuesday on Personal',
        "What's on my calendar tomorrow?",
        'Reschedule dentist',
      ]
    : [
        'Need a meeting with Beth this week',
        "What's on my calendar tomorrow?",
        'Reschedule dentist',
      ]
  const initialThreadMessages = toSmsThreadMessages(await listSmsThreadEntries(profile.id))

  return (
    <main className="dashboard-shell">
      <div className="dashboard-card">
        <div className="dashboard-topbar">
          <ManoaWordmark className="legal-back compact" href="/" />
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
        <h1 className="dashboard-title">Your Manoa dashboard.</h1>
        <p className="dashboard-lede">
          Connect your calendar, then send your first text. The rest should feel as simple as the homepage.
        </p>
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

        {params.settings === 'timezone_saved' ? (
          <div className="notice success" role="status" aria-live="polite">
            Timezone saved. Manoa will use it for texted times, agendas, and reminders.
          </div>
        ) : null}

        {params.settings === 'timezone_invalid' ? (
          <div className="notice warning" role="status" aria-live="polite">
            That timezone was not recognized. Choose one from the dashboard and try again.
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

        <section className="dashboard-stage dashboard-stage-connect">
          <div className="dashboard-stage-head">
            <div>
              <p className="dashboard-stage-label">Step 1</p>
              <h2>{calendarStageHeading}</h2>
              <p>{calendarStageCopy}</p>
            </div>
            <span className="dashboard-stage-status">
              {totalConnectedAccounts ? connectedAccountLabel : 'Not connected yet'}
            </span>
          </div>

          <div className="dashboard-stage-actions">
            <a className="button dashboard-button" href={`/api/calendar/google/start?profile_id=${profile.id}`}>
              {googleAccounts.length ? (canAddGoogleAccount ? 'Add Google account' : 'Reconnect Google') : 'Connect Google'}
            </a>
            <span className="button dashboard-button secondary-button is-disabled" aria-disabled="true">
              Outlook coming soon
            </span>
            <a className="button dashboard-button secondary-button" href={appleConnectHref}>
              {appleAccounts.length ? 'Reconnect Apple' : 'Connect Apple'}
            </a>
          </div>
          <p className="dashboard-stage-footnote">
            Apple uses the manual iCloud path. One Apple account is supported right now.
          </p>

          {calendarAccounts.length ? (
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
                      {account.provider === 'outlook' ? (
                        <span className="nav-link is-disabled" aria-disabled="true">
                          Coming soon
                        </span>
                      ) : (
                        <a
                          className="nav-link"
                          href={
                            account.provider === 'apple'
                              ? `/setup/apple-calendar?profile_id=${profile.id}&account_id=${account.accountId}`
                              : `/api/calendar/google/start?profile_id=${profile.id}&account_id=${account.accountId}`
                          }
                        >
                          Reconnect
                        </a>
                      )}
                      <DisconnectCalendarAccountForm
                        profileId={profile.id}
                        provider={account.provider}
                        accountId={account.accountId}
                      />
                    </div>
                  </div>

                  <div className="calendar-account-summary">
                    <span>{accountConflictSummary(account.calendars)}</span>
                    <span>{accountBookingSummary(account.calendars)}</span>
                  </div>

                  {account.provider === 'apple' ? (
                    <p className="calendar-account-note">
                      Apple may show many calendars from iCloud, Family Sharing, and app-created lists.
                      You only need to edit a calendar if Manoa should stop checking it or should not
                      place new events there.
                    </p>
                  ) : null}

                  <details className="calendar-account-details">
                    <summary>
                      <span>Advanced calendar settings</span>
                      <strong>{account.calendars.length}</strong>
                    </summary>
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
                  </details>
                </article>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty-state">
              <strong>No calendar connected yet.</strong>
              <p>Start with Google or Apple above, then come right back here to name calendars and choose how Manoa should use them.</p>
            </div>
          )}
        </section>

        <section className="dashboard-stage dashboard-stage-text">
          <div className="dashboard-stage-head">
            <div>
              <p className="dashboard-stage-label">Step 2</p>
              <h2>Text Manoa.</h2>
              <p>{textingStageCopy}</p>
            </div>
          </div>

          <div className="dashboard-number-card">
            <span className="dashboard-number-label">Your Manoa number</span>
            <strong>{displayNumber || 'Still being finalized'}</strong>
          </div>

          <div className="dashboard-example-card">
            <span className="dashboard-example-label">First text to send</span>
            <strong>{firstTextExample}</strong>
          </div>

          <DashboardTextConsole
            initialMessages={initialThreadMessages}
            starterPrompts={quickExamples}
          />

          <div className="dashboard-stage-actions">
            {manoaNumber ? (
              <a className="button dashboard-button" href={`sms:${manoaNumber}`}>
                Text Manoa now
              </a>
            ) : null}
            {manoaNumber ? (
              <a className="button dashboard-button secondary-button" href="/api/contact-card">
                Save Manoa contact
              </a>
            ) : null}
            <a className="button dashboard-button secondary-button" href={`/api/billing-portal?profile_id=${profile.id}`}>
              Manage billing
            </a>
          </div>

          <p className="dashboard-stage-footnote">
            Signed in as <strong>{profile.email}</strong> from <strong>{displayUserPhone}</strong>.
          </p>
        </section>

        <div className="dashboard-support-grid">
          <article className="dashboard-support-card">
            <p className="dashboard-label">Timezone</p>
            <h3>Use the right local time</h3>
            <p>Manoa reads texts like “11am” using this timezone.</p>
            <TimezoneForm profileId={profile.id} currentTimezone={profile.timezone} />
          </article>

          <article className="dashboard-support-card">
            <p className="dashboard-label">Scheduling defaults</p>
            <h3>Default new-event length</h3>
            <p>When your text does not include a duration, Manoa uses this length.</p>
            <DefaultDurationForm
              profileId={profile.id}
              defaultDurationMinutes={profile.default_event_duration_minutes}
            />
          </article>

          <article className="dashboard-support-card">
            <p className="dashboard-label">Try one of these</p>
            <h3>Good first texts</h3>
            <ul className="dashboard-example-list">
              {quickExamples.map((example) => (
                <li key={example}>{example}</li>
              ))}
            </ul>
          </article>
        </div>

        <div className="dashboard-footer">
          <a className="nav-link" href="/">
            Back to the site
          </a>
        </div>
      </div>
    </main>
  )
}
