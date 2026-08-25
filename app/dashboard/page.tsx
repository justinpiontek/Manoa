import { getAuthenticatedUserEmail, isAdminEmail } from '@/src/lib/admin'
import { stripe } from '@/src/lib/stripeClient'
import { appUrl } from '@/src/lib/env'
import { onboardingExampleTexts } from '@/src/lib/onboarding'
import { formatPhoneForDisplay } from '@/src/lib/phone'
import { listConfiguredCalendarAccounts, type CalendarProvider } from '@/src/lib/calendar/google'
import { getAuthenticatedDashboardProfile } from '@/src/lib/dashboardAuth'
import { listSmsThreadEntries, toSmsThreadMessages } from '@/src/lib/sms/thread'
import { supabaseAdmin } from '@/src/lib/supabaseAdmin'
import { siteSupportEmail, supportMailtoHref } from '@/src/lib/siteMetadata'
import ManoaWordmark from '@/src/components/ManoaWordmark'
import CalendarSettingsForm from '@/src/components/CalendarSettingsForm'
import DisconnectCalendarAccountForm from '@/src/components/DisconnectCalendarAccountForm'
import DefaultDurationForm from '@/src/components/DefaultDurationForm'
import DashboardTextConsole from '@/src/components/DashboardTextConsole'
import NotificationSettingsForm from '@/src/components/NotificationSettingsForm'
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
    return 'Calendar not connected • Connect Google, Apple, or Outlook (beta)'
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

function calendarErrorMessage(code: string | undefined) {
  switch (code) {
    case 'account_limit':
      return 'Manoa hit the current account limit for that calendar provider.'
    case 'no_calendars':
      return 'That calendar account connected, but it did not return any usable calendars for Manoa yet.'
    case 'insufficient_scopes':
      return 'Google approved the sign-in, but Manoa still needs one more calendar permission to finish adding that account. Reconnect once after the latest deploy and it should ask for the missing access.'
    case 'apple_auth':
      return 'Apple did not accept that iCloud email and app-specific password.'
    case 'apple_connect':
      return 'Apple Calendar could not be connected yet.'
    case 'mailbox_missing':
      return 'Microsoft signed you in, but that Outlook account does not seem to have a usable mailbox/calendar behind it yet.'
    case 'permissions':
      return 'Microsoft signed you in, but the calendar permission step did not fully go through.'
    case 'duplicate':
      return 'That calendar account looks like it has a calendar Manoa already knows about, and the save step collided.'
    case 'db_constraint':
      return 'The database save rules for calendars are still out of sync with the app.'
    case 'migration_missing':
      return 'The database is still missing part of the newer multi-calendar schema.'
    case 'verify_failed':
      return 'That calendar account came back from Google, but Manoa could not verify the saved connection yet. Reconnect once more. If it still happens, contact support.'
    case 'disconnect_failed':
      return "That calendar account could not be disconnected cleanly. Try reconnecting it once, or contact support if it keeps happening."
    default:
      return "We couldn't finish that calendar connection yet. The callback is returning a real error, but it still needs one more fix."
  }
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams
  if (params.session_id && process.env.STRIPE_SECRET_KEY) {
    try {
      await stripe.checkout.sessions.retrieve(params.session_id)
    } catch {
      // Keep page behavior stable when old success URLs still include session_id.
    }
  }

  const viewerEmail = await getAuthenticatedUserEmail()
  const profile = await getAuthenticatedDashboardProfile()
  const manoaNumber = process.env.TWILIO_FROM_NUMBER?.trim() || ''
  const displayNumber = manoaNumber ? formatPhoneForDisplay(manoaNumber) : ''
  const displayUserPhone = profile?.phone_e164 ? formatPhoneForDisplay(profile.phone_e164) : ''
  const calendarConnected = params.calendar === 'connected'
  const calendarDisconnected = params.calendar === 'disconnected'
  const calendarRemoved = params.calendar === 'removed'
  const calendarError = params.calendar === 'error'
  const billingMissing = params.billing === 'missing'
  const billingReturned = params.billing === 'returned'

  if (!profile) {
    if (isAdminEmail(viewerEmail)) {
      return (
        <main className="dashboard-shell">
          <div className="dashboard-card">
            <ManoaWordmark className="legal-back compact" href="/" />
            <p className="legal-eyebrow">Dashboard</p>
            <h1 className="dashboard-title">Admin access is set up.</h1>
            <p className="dashboard-lede">
              This email is for the internal support view, not a regular Manoa customer dashboard.
            </p>
            <div className="dashboard-footer">
              <a className="button dashboard-button" href="/dashboard/support">
                Open support view
              </a>
            </div>
          </div>
        </main>
      )
    }

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

  const smsReady = smsEnabled && Boolean(profile.phone_e164)
  const googleAccounts = calendarAccounts.filter((account) => account.provider === 'google')
  const outlookAccounts = calendarAccounts.filter((account) => account.provider === 'outlook')
  const appleAccounts = calendarAccounts.filter((account) => account.provider === 'apple')
  const canAddGoogleAccount = googleAccounts.length < 2
  const canAddOutlookAccount = outlookAccounts.length < 2
  const canAddAppleAccount = appleAccounts.length < 1
  const appleConnectHref = canAddAppleAccount
    ? '/setup/apple-calendar'
    : `/setup/apple-calendar?account_id=${appleAccounts[0]?.accountId || ''}`
  const totalConnectedAccounts = calendarAccounts.length
  const totalBookingCalendars = calendarAccounts.reduce(
    (count, account) => count + account.calendars.filter((calendar) => calendar.allowNewEvents).length,
    0,
  )
  const needsCalendarReconnect = totalConnectedAccounts > 0 && !profile.calendarConnected
  const needsBookingCalendar = totalConnectedAccounts > 0 && totalBookingCalendars === 0
  const readyToText = Boolean(manoaNumber && profile.calendarConnected && smsReady)
  const connectedAccountLabel = `${totalConnectedAccounts} connected account${totalConnectedAccounts === 1 ? '' : 's'}`
  let dashboardLede = 'Connect Google, Apple, or Outlook (beta) to start using Manoa.'
  if (profile.calendarConnected) {
    dashboardLede = smsReady
      ? 'Everything is set up. Use the console below while SMS approval finishes, or connect another calendar.'
      : 'Everything is set up. Use the console below now, or add texting for this account.'
  }
  if (readyToText) {
    dashboardLede = 'Everything is set up. Text Manoa, use the console below, or connect another calendar.'
  }
  const calendarStageHeading = totalConnectedAccounts ? 'Calendars' : 'Connect a calendar'
  const calendarStageCopy = totalConnectedAccounts
    ? 'Most people can leave these settings alone. Open calendar settings only if you want to rename a calendar, stop conflict checks, or change where Manoa books.'
    : 'Choose one calendar provider. You can add more later.'
  const textingStageCopy = !smsReady
    ? profile.phone_e164
      ? 'SMS is not turned on for this account. Use this console with your real calendars.'
      : 'Use this console with your real calendars. Add a phone above if you want texting later.'
    : readyToText
    ? `Text ${displayNumber} from ${displayUserPhone}, or use this console.`
    : totalConnectedAccounts
      ? 'SMS approval is still pending. Use this console now with your real calendars.'
      : 'Once connected, you can test the real texting flow here.'
  const quickExamples = totalConnectedAccounts > 1
    ? [
        onboardingExampleTexts[0],
        'Schedule lunch Tuesday on Personal',
        onboardingExampleTexts[2],
      ]
    : onboardingExampleTexts
  const initialThreadMessages = toSmsThreadMessages(await listSmsThreadEntries(profile.id))
  const supportHref = supportMailtoHref(
    'Manoa support',
    `Hi Justin,\n\nI need help with Manoa.\n\nAccount email: ${profile.email}\nPhone: ${
      profile.phone_e164 || 'not added'
    }\n\nWhat happened:\n`,
  )

  return (
    <main className="dashboard-shell">
      <div className="dashboard-card">
        <div className="dashboard-topbar">
          <ManoaWordmark className="legal-back compact" href="/" />
          <div className="dashboard-topbar-actions">
            {profile.email.trim().toLowerCase() === siteSupportEmail.toLowerCase() ? (
              <a className="nav-link" href="/dashboard/support">
                Support view
              </a>
            ) : null}
            <a className="nav-link" href={`${appUrl()}/dashboard`}>
              Refresh
            </a>
            <a className="nav-link secondary" href="/auth/signout">
              Sign out
            </a>
          </div>
        </div>

        <p className="legal-eyebrow">Dashboard</p>
        <h1 className="dashboard-title">Use Manoa.</h1>
        <p className="dashboard-lede">{dashboardLede}</p>
        <p className="dashboard-status-line">{statusLine({
          calendarConnected: profile.calendarConnected,
          manoaNumber,
          smsEnabled: smsReady,
        })}</p>

        {!smsReady ? (
          <div className="notice warning" role="status" aria-live="polite">
            {profile.phone_e164
              ? 'SMS is off for this account. You can still use the live console below, or turn texting on in Settings.'
              : 'Texting is not set up for this account yet. You can keep using the live console below, or add a phone in Settings if you want SMS later.'}
          </div>
        ) : null}

        {needsCalendarReconnect ? (
          <div className="notice warning" role="status" aria-live="polite">
            A saved calendar account still needs to be reconnected before Manoa can use it by text.
            Use the reconnect link below on that account, then test again.
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
            {calendarErrorMessage(params.calendar_error)}
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

        {params.settings === 'sms_consent_disabled' ? (
          <div className="notice success" role="status" aria-live="polite">
            SMS turned off for this account. You can still use Manoa in the dashboard console any time.
          </div>
        ) : null}

        {params.settings === 'sms_consent_missing' ? (
          <div className="notice warning" role="status" aria-live="polite">
            Check the SMS consent box before turning texts on for this account.
          </div>
        ) : null}

        {params.settings === 'sms_phone_missing' ? (
          <div className="notice warning" role="status" aria-live="polite">
            Add a phone number before turning texting on for this account.
          </div>
        ) : null}

        {params.settings === 'sms_phone_invalid' ? (
          <div className="notice warning" role="status" aria-live="polite">
            That phone number does not look valid yet. Try it again with area code.
          </div>
        ) : null}

        {params.settings === 'sms_consent_error' ? (
          <div className="notice warning" role="status" aria-live="polite">
            We could not turn SMS on yet. Try again in a minute.
          </div>
        ) : null}

        {params.settings === 'notifications_saved' ? (
          <div className="notice success" role="status" aria-live="polite">
            Notification settings saved. Manoa will use those for morning agenda and reminder texts.
          </div>
        ) : null}

        {params.settings === 'notifications_invalid' ? (
          <div className="notice warning" role="status" aria-live="polite">
            That reminder timing option was not recognized. Pick one from the dashboard and try again.
          </div>
        ) : null}

        {params.settings === 'notifications_unavailable' ? (
          <div className="notice warning" role="status" aria-live="polite">
            Notification settings could not be saved yet because the latest profile settings update has not finished in the database.
          </div>
        ) : null}

        {params.settings === 'notifications_error' ? (
          <div className="notice warning" role="status" aria-live="polite">
            We could not save notification settings yet. Try again in a minute.
          </div>
        ) : null}

        {billingMissing ? (
          <div className="notice warning" role="status" aria-live="polite">
            We could not find your billing record yet. Try again in a minute. If it still looks off,
            use the same email on the homepage to reopen your dashboard.
          </div>
        ) : null}

        {calendarSettingsWarning ? (
          <div className="notice warning" role="status" aria-live="polite">
            {calendarSettingsWarning}
          </div>
        ) : null}

        {needsBookingCalendar ? (
          <div className="notice warning" role="status" aria-live="polite">
            Your calendar is connected, but Manoa still needs one place to add new events. Open
            Calendar settings and turn on <strong>Books here</strong> for one calendar. You only
            need one.
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
            <a className="button dashboard-button" href="/api/calendar/google/start">
              {googleAccounts.length ? (canAddGoogleAccount ? 'Add Google account' : 'Reconnect Google') : 'Connect Google'}
            </a>
            <a className="button dashboard-button secondary-button" href="/api/calendar/outlook/start">
              {outlookAccounts.length
                ? canAddOutlookAccount
                  ? 'Add Outlook account (beta)'
                  : 'Reconnect Outlook (beta)'
                : 'Connect Outlook (beta)'}
            </a>
            <a className="button dashboard-button secondary-button" href={appleConnectHref}>
              {appleAccounts.length ? 'Reconnect Apple' : 'Connect Apple'}
            </a>
          </div>
          <p className="dashboard-stage-footnote">
            Apple uses an app-specific password. Google and Outlook use sign-in redirects.
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
                      <a
                        className="nav-link"
                        href={
                          account.provider === 'apple'
                            ? `/setup/apple-calendar?account_id=${account.accountId}`
                            : account.provider === 'outlook'
                              ? `/api/calendar/outlook/start?account_id=${account.accountId}`
                              : `/api/calendar/google/start?account_id=${account.accountId}`
                        }
                      >
                        Reconnect
                      </a>
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

          <div className="dashboard-example-card">
            <span className="dashboard-example-label">Try first</span>
            <strong>
              {totalConnectedAccounts
                ? 'Start with one of these texts.'
                : 'Once your calendar is connected, start with one of these texts.'}
            </strong>
            <ul className="dashboard-example-list">
              {onboardingExampleTexts.map((example) => (
                <li key={example}>{example}</li>
              ))}
            </ul>
          </div>

          {manoaNumber && totalConnectedAccounts && smsReady ? (
            <div className="dashboard-contact-callout">
              <div className="dashboard-contact-callout-copy">
                <p className="dashboard-contact-callout-label">Save this number first</p>
                <h3>Add Manoa to your contacts.</h3>
                <p>
                  Save Manoa now so you always know exactly who to text when you want to schedule,
                  move, or check something on your calendar.
                </p>
              </div>
              <div className="dashboard-contact-callout-actions">
                <a className="button dashboard-button" href="/api/contact-card">
                  Add Manoa to contacts
                </a>
                <div className="dashboard-number-card">
                  <span className="dashboard-number-label">Manoa number</span>
                  <strong>{displayNumber}</strong>
                </div>
              </div>
            </div>
          ) : null}

          {totalConnectedAccounts ? (
            <DashboardTextConsole
              initialMessages={initialThreadMessages}
              starterPrompts={quickExamples}
            />
          ) : (
            <div className="dashboard-empty-state">
              <strong>Connect a calendar first.</strong>
              <p>Choose Google, Apple, or Outlook (beta) above to unlock the console.</p>
            </div>
          )}

          <div className="dashboard-stage-actions">
            {manoaNumber && totalConnectedAccounts && smsReady ? (
              <a className="button dashboard-button" href={`sms:${manoaNumber}`}>
                Text Manoa now
              </a>
            ) : null}
            {manoaNumber && totalConnectedAccounts && smsReady ? (
              <a className="button dashboard-button secondary-button" href="/api/contact-card">
                Download contact card
              </a>
            ) : null}
            <a className="button dashboard-button secondary-button" href={supportHref}>
              Need help?
            </a>
            <a className="button dashboard-button secondary-button" href="/api/billing-portal">
              Manage billing
            </a>
          </div>

          <p className="dashboard-stage-footnote">
            SMS: <strong>{displayNumber || 'pending approval'}</strong> • Account:{' '}
            <strong>{profile.email}</strong> • Phone: <strong>{displayUserPhone || 'not added'}</strong>
            {!smsReady ? ' • Texting not enabled' : ''}
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
              <p className="dashboard-label">Support</p>
              <h3>Get unstuck fast</h3>
              <p>
                If something is off, email support or text HELP from your Manoa number. Manoa will
                also understand “start over” or “nevermind” if you want to drop the current request.
              </p>
              <div className="dashboard-sms-meta">
                <p>
                  <strong>Support email</strong>
                  <span>
                    <a href={`mailto:${siteSupportEmail}`}>{siteSupportEmail}</a>
                  </span>
                </p>
                <p>
                  <strong>By text</strong>
                  <span>Reply HELP any time.</span>
                </p>
                <p>
                  <strong>Reset a stuck thread</strong>
                  <span>Say “start over” or “nevermind.”</span>
                </p>
              </div>
              <a className="button dashboard-button secondary-button" href={supportHref}>
                Email support
              </a>
            </article>

            <article className="dashboard-support-card">
              <p className="dashboard-label">Texting</p>
              <h3>{smsReady ? 'Texting is on' : 'Texting is optional'}</h3>
              <p>
                {smsReady
                  ? `Manoa can text ${displayUserPhone} for scheduling, reminders, and account updates.`
                  : 'You can use Manoa without texting. Turn SMS on here if you want Manoa to text this account too.'}
              </p>

              {smsReady ? (
                <>
                  <div className="dashboard-sms-meta">
                    <p>
                      <strong>Phone</strong>
                      <span>{displayUserPhone}</span>
                    </p>
                    <p>
                      <strong>How to opt out</strong>
                      <span>Reply STOP at any time, or turn texting off here.</span>
                    </p>
                    <p>
                      <strong>Help</strong>
                      <span>Reply HELP any time for help.</span>
                    </p>
                  </div>
                  <form className="dashboard-inline-consent" action="/api/profile/sms-consent" method="post">
                    <input type="hidden" name="intent" value="disable" />
                    <button className="button dashboard-button secondary-button" type="submit">
                      Turn off texting
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <p className="dashboard-sms-helper">
                    Turn texting on to receive scheduling, reminder, and account messages from Manoa.
                  </p>
                  <form className="dashboard-inline-consent" action="/api/profile/sms-consent" method="post">
                    <input type="hidden" name="intent" value="enable" />
                    {!profile.phone_e164 ? (
                      <div className="field">
                        <label htmlFor="dashboard-phone">Phone for texting</label>
                        <input
                          id="dashboard-phone"
                          name="phone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          placeholder="+1 555 555 5555"
                          required
                        />
                      </div>
                    ) : (
                      <div className="dashboard-sms-meta">
                        <p>
                          <strong>Phone</strong>
                          <span>{displayUserPhone}</span>
                        </p>
                      </div>
                    )}
                    <label className="consent-check pricing-consent" htmlFor="dashboard-sms-consent">
                      <input
                        id="dashboard-sms-consent"
                        name="sms_consent"
                        type="checkbox"
                        value="yes"
                      />
                      <span>
                        I agree to receive recurring service-related SMS messages from Manoa, including
                        scheduling, reminders, and account notifications. Message frequency varies. Msg
                        &amp; data rates may apply. Reply STOP to opt out and HELP for help. See{' '}
                        <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms</a>.
                      </span>
                    </label>
                    <button className="button dashboard-button" type="submit">
                      Turn on texting
                    </button>
                  </form>
                </>
              )}
            </article>

            <article className="dashboard-support-card">
              <p className="dashboard-label">Notifications</p>
              <h3>Choose what Manoa texts</h3>
              <p>Keep the daily agenda, event reminders, and timing under your control.</p>
              <NotificationSettingsForm
                profileId={profile.id}
                morningAgendaEnabled={profile.morning_agenda_enabled}
                reminderTextsEnabled={profile.reminder_texts_enabled}
                reminderLeadMinutes={profile.reminder_lead_minutes}
              />
            </article>

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
