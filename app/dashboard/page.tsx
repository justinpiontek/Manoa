import { stripe } from '@/src/lib/stripeClient'
import { appUrl } from '@/src/lib/env'
import { formatPhoneForDisplay } from '@/src/lib/phone'
import { listConfiguredCalendarAccounts, type CalendarProvider } from '@/src/lib/calendar/google'
import { getDashboardProfile, getDashboardProfileByEmail } from '@/src/lib/profiles'
import { listSmsThreadEntries, toSmsThreadMessages } from '@/src/lib/sms/thread'
import { createSupabaseServerClient } from '@/src/lib/supabase/server'
import { supabaseAdmin } from '@/src/lib/supabaseAdmin'
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
  smsEnabled,
}: {
  calendarConnected: boolean
  manoaNumber: string
  smsEnabled: boolean
}) {
  if (!calendarConnected) {
    return 'Calendar not connected • Connect Google or Apple'
  }

  if (!smsEnabled) {
    return '✅ Calendar connected • Use dashboard console'
  }

  return manoaNumber ? '✅ Calendar connected • Texting ready' : 'Calendar connected • SMS approval pending'
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
  let smsEnabled = true

  try {
    calendarAccounts = await listConfiguredCalendarAccounts(profile.id)
  } catch (error) {
    calendarAccounts = []
    calendarSettingsWarning =
      error instanceof Error && error.message
        ? 'Your dashboard loaded, but the calendar settings section needs one more setup step. If you recently updated Manoa, a database migration may still be missing.'
        : 'Your dashboard loaded, but the calendar settings section could not be loaded yet.'
  }

  try {
    const { data: consentProfile } = await supabaseAdmin
      .from('profiles')
      .select('sms_opted_out_at')
      .eq('id', profile.id)
      .maybeSingle<{ sms_opted_out_at: string | null }>()

    smsEnabled = !consentProfile?.sms_opted_out_at
  } catch {
    smsEnabled = true
  }

  const googleAccounts = calendarAccounts.filter((account) => account.provider === 'google')
  const appleAccounts = calendarAccounts.filter((account) => account.provider === 'apple')
  const canAddGoogleAccount = googleAccounts.length < 2
  const canAddAppleAccount = appleAccounts.length < 1
  const appleConnectHref = canAddAppleAccount
    ? `/setup/apple-calendar?profile_id=${profile.id}`
    : `/setup/apple-calendar?profile_id=${profile.id}&account_id=${appleAccounts[0]?.accountId || ''}`
  const totalConnectedAccounts = calendarAccounts.length
  const readyToText = Boolean(manoaNumber && profile.calendarConnected)
  const connectedAccountLabel = `${totalConnectedAccounts} connected account${totalConnectedAccounts === 1 ? '' : 's'}`
  let dashboardLede = 'Connect Google or Apple to start using Manoa.'
  if (profile.calendarConnected) {
    dashboardLede = smsEnabled
      ? 'Everything is set up. Use the console below while SMS approval finishes, or connect another calendar.'
      : 'Everything is set up. SMS is off for this account, so use the console below.'
  }
  if (readyToText && smsEnabled) {
    dashboardLede = 'Everything is set up. Text Manoa, use the console below, or connect another calendar.'
  }
  const calendarStageHeading = totalConnectedAccounts ? 'Calendars' : 'Connect a calendar'
  const calendarStageCopy = totalConnectedAccounts
    ? 'Most people can leave these settings alone. Open calendar settings only if you want to rename a calendar, stop conflict checks, or change where Manoa books.'
    : 'Choose one calendar provider. You can add more later.'
  const textingStageCopy = !smsEnabled
    ? 'SMS is not turned on for this account. Use this console with your real calendars.'
    : readyToText
    ? `Text ${displayNumber} from ${displayUserPhone}, or use this console.`
    : totalConnectedAccounts
      ? 'SMS approval is still pending. Use this console now with your real calendars.'
      : 'Once connected, you can test the real texting flow here.'
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
        <h1 className="dashboard-title">Use Manoa.</h1>
        <p className="dashboard-lede">{dashboardLede}</p>
        <p className="dashboard-status-line">{statusLine({
          calendarConnected: profile.calendarConnected,
          manoaNumber,
          smsEnabled,
        })}</p>

        {!smsEnabled ? (
          <div className="notice warning" role="status" aria-live="polite">
            SMS is off for this account. If you skipped the signup consent box, Manoa will not text
            this number. Use the live console below instead.
            <form className="dashboard-inline-consent" action="/api/profile/sms-consent" method="post">
              <input type="hidden" name="profile_id" value={profile.id} />
              <label className="consent-check pricing-consent" htmlFor="dashboard-sms-consent">
                <input
                  id="dashboard-sms-consent"
                  name="sms_consent"
                  type="checkbox"
                  value="yes"
                />
                <span>
                  <strong>Optional:</strong> I agree to receive recurring service-related SMS
                  messages from Manoa, including scheduling, reminders, and account notifications.
                  Message frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out
                  and HELP for help. See <a href="/privacy">Privacy Policy</a> and{' '}
                  <a href="/terms">Terms</a>.
                </span>
              </label>
              <button className="button dashboard-button" type="submit">
                Turn on SMS for this account
              </button>
            </form>
          </div>
        ) : null}

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

        {params.settings === 'sms_consent_enabled' ? (
          <div className="notice success" role="status" aria-live="polite">
            SMS turned on for this account. You can use Manoa by text as soon as texting is available.
          </div>
        ) : null}

        {params.settings === 'sms_consent_missing' ? (
          <div className="notice warning" role="status" aria-live="polite">
            Check the SMS consent box before turning texts on for this account.
          </div>
        ) : null}

        {params.settings === 'sms_consent_error' ? (
          <div className="notice warning" role="status" aria-live="polite">
            We could not turn SMS on yet. Try again in a minute.
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
              <p className="dashboard-stage-label">Calendars</p>
              <h2>{calendarStageHeading}</h2>
              <p>{calendarStageCopy}</p>
            </div>
            {totalConnectedAccounts ? (
              <span className="dashboard-stage-status">{connectedAccountLabel}</span>
            ) : null}
          </div>

          <div className="dashboard-stage-actions">
            <a className="button dashboard-button" href={`/api/calendar/google/start?profile_id=${profile.id}`}>
              {googleAccounts.length ? (canAddGoogleAccount ? 'Add Google account' : 'Reconnect Google') : 'Connect Google'}
            </a>
            <a className="button dashboard-button secondary-button" href={appleConnectHref}>
              {appleAccounts.length ? 'Reconnect Apple' : 'Connect Apple'}
            </a>
            <span className="dashboard-action-note">Outlook coming soon</span>
          </div>
          <p className="dashboard-stage-footnote">
            Apple uses an app-specific password. Google is the fastest setup.
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
                      Apple may include iCloud, Family Sharing, and app-created calendars. Leave this closed
                      unless Manoa should ignore one or stop booking there.
                    </p>
                  ) : null}

                  <details className="calendar-account-details">
                    <summary>
                      <span>Calendar settings</span>
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
          ) : null}
        </section>

        <section className="dashboard-stage dashboard-stage-text">
          <div className="dashboard-stage-head">
            <div>
              <p className="dashboard-stage-label">Try Manoa</p>
              <h2>Send a text here.</h2>
              <p>{textingStageCopy}</p>
            </div>
          </div>

          {totalConnectedAccounts ? (
            <DashboardTextConsole
              initialMessages={initialThreadMessages}
              starterPrompts={quickExamples}
            />
          ) : (
            <div className="dashboard-empty-state">
              <strong>Connect a calendar first.</strong>
              <p>Choose Google or Apple above to unlock the console.</p>
            </div>
          )}

          <div className="dashboard-stage-actions">
            {manoaNumber && totalConnectedAccounts && smsEnabled ? (
              <a className="button dashboard-button" href={`sms:${manoaNumber}`}>
                Text Manoa now
              </a>
            ) : null}
            {manoaNumber && totalConnectedAccounts && smsEnabled ? (
              <a className="button dashboard-button secondary-button" href="/api/contact-card">
                Save Manoa contact
              </a>
            ) : null}
            <a className="button dashboard-button secondary-button" href={`/api/billing-portal?profile_id=${profile.id}`}>
              Manage billing
            </a>
          </div>

          <p className="dashboard-stage-footnote">
            SMS: <strong>{displayNumber || 'pending approval'}</strong> • Account:{' '}
            <strong>{profile.email}</strong> • Phone: <strong>{displayUserPhone}</strong>
            {!smsEnabled ? ' • SMS consent not enabled' : ''}
          </p>
        </section>

        <section className="dashboard-stage dashboard-stage-settings">
          <div className="dashboard-stage-head">
            <div>
              <p className="dashboard-stage-label">Settings</p>
              <h2>Defaults</h2>
              <p>These keep texted times and new events predictable.</p>
            </div>
          </div>

          <div className="dashboard-support-grid">
            <article className="dashboard-support-card">
              <p className="dashboard-label">Timezone</p>
              <h3>Use the right local time</h3>
              <p>Manoa reads texts like “11am” using this timezone.</p>
              <TimezoneForm profileId={profile.id} currentTimezone={profile.timezone} />
            </article>

            <article className="dashboard-support-card">
              <p className="dashboard-label">Event length</p>
              <h3>Default duration</h3>
              <p>When your text does not include a duration, Manoa uses this length.</p>
              <DefaultDurationForm
                profileId={profile.id}
                defaultDurationMinutes={profile.default_event_duration_minutes}
              />
            </article>
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
