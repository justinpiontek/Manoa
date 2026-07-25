import { formatPhoneForDisplay, normalizePhone } from '@/src/lib/phone'
import { listConfiguredCalendarAccounts, type CalendarProvider } from '@/src/lib/calendar/google'
import { getAuthenticatedDashboardProfile } from '@/src/lib/dashboardAuth'
import { getDashboardProfile, type DashboardProfile } from '@/src/lib/profiles'
import { siteSupportEmail } from '@/src/lib/siteMetadata'
import { supabaseAdmin } from '@/src/lib/supabaseAdmin'
import ManoaWordmark from '@/src/components/ManoaWordmark'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Manoa Support View',
  description: 'Internal support view for checking a Manoa account setup state.',
}

export const dynamic = 'force-dynamic'

type SupportPageProps = {
  searchParams: Promise<{
    email?: string
    phone?: string
  }>
}

type SupportProfileRow = {
  id: string
  email: string
  phone_e164: string | null
  timezone: string
  phone_confirmed_at: string | null
  sms_opted_out_at: string | null
  created_at: string
  updated_at: string
}

type SupportSubscriptionRow = {
  status: string | null
  current_period_end: string | null
  updated_at: string
}

type SupportPendingActionRow = {
  id: string
  kind: string
  status: string
  sms_from: string
  payload: Record<string, unknown> | null
  created_at: string
  updated_at: string
  expires_at: string
}

type SupportSmsRow = {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  created_at: string
}

type SupportReminderRow = {
  id: string
  status: string
  due_at: string
  event_starts_at: string
  body: string
}

function providerLabel(provider: CalendarProvider) {
  if (provider === 'outlook') return 'Outlook'
  if (provider === 'apple') return 'Apple'
  return 'Google'
}

function isSupportViewer(email: string | null | undefined) {
  return Boolean(email && email.trim().toLowerCase() === siteSupportEmail.toLowerCase())
}

function formatDateTime(value: string | null | undefined, timeZone: string) {
  if (!value) return 'None yet'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value))
}

function formatDate(value: string | null | undefined, timeZone: string) {
  if (!value) return 'None yet'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone,
  }).format(new Date(value))
}

function humanizePendingKind(kind: string) {
  return kind
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function firstLine(value: string) {
  return value.split(/\n+/).find(Boolean) || value
}

function deriveSupportChecklist({
  dashboardProfile,
  rawProfile,
  bookingCalendarCount,
  conflictCalendarCount,
  connectedAccountCount,
  pendingActions,
  pendingReminderCount,
}: {
  dashboardProfile: DashboardProfile
  rawProfile: SupportProfileRow
  bookingCalendarCount: number
  conflictCalendarCount: number
  connectedAccountCount: number
  pendingActions: SupportPendingActionRow[]
  pendingReminderCount: number
}) {
  const items: string[] = []
  const subscriptionStatus = (dashboardProfile.subscriptionStatus || '').toLowerCase()

  if (!subscriptionStatus || !['active', 'trialing'].includes(subscriptionStatus)) {
    items.push('Subscription is not active yet.')
  }

  if (!connectedAccountCount) {
    items.push('No active calendar connections found.')
  } else if (!bookingCalendarCount) {
    items.push('A calendar is connected, but none are marked Books here yet.')
  }

  if (!rawProfile.phone_e164) {
    items.push('No phone is on file, so this account can only use the dashboard console.')
  } else if (rawProfile.sms_opted_out_at) {
    items.push('Texting is turned off for this phone number.')
  }

  if (!conflictCalendarCount && connectedAccountCount) {
    items.push('No calendars are marked for conflict checking yet.')
  }

  if (pendingActions.length) {
    items.push(`The thread is waiting on ${humanizePendingKind(pendingActions[0].kind)}.`)
  }

  if (
    dashboardProfile.reminder_texts_enabled &&
    rawProfile.phone_e164 &&
    !rawProfile.sms_opted_out_at &&
    pendingReminderCount === 0
  ) {
    items.push('Reminder texts are on, but there are no pending reminder jobs right now.')
  }

  return items.length ? items : ['Account looks complete from the support side.']
}

async function findSupportProfile(email: string, phone: string) {
  if (!email && !phone) return null

  const query = supabaseAdmin
    .from('profiles')
    .select(
      'id,email,phone_e164,timezone,phone_confirmed_at,sms_opted_out_at,created_at,updated_at',
    )

  const result = email
    ? await query.eq('email', email).maybeSingle<SupportProfileRow>()
    : await query.eq('phone_e164', phone).maybeSingle<SupportProfileRow>()

  if (result.error) throw result.error
  return result.data
}

export default async function DashboardSupportPage({ searchParams }: SupportPageProps) {
  const params = await searchParams
  const viewer = await getAuthenticatedDashboardProfile()
  const emailQuery = params.email?.trim().toLowerCase() || ''
  const rawPhoneQuery = params.phone?.trim() || ''
  const normalizedPhoneQuery = rawPhoneQuery ? normalizePhone(rawPhoneQuery) : ''

  if (!viewer) {
    return (
      <main className="dashboard-shell">
        <div className="dashboard-card">
          <ManoaWordmark className="legal-back compact" href="/" />
          <p className="legal-eyebrow">Support</p>
          <h1 className="dashboard-title">We need your account link.</h1>
          <p className="dashboard-lede">Use the homepage login first, then come back here.</p>
          <div className="dashboard-footer">
            <a className="button dashboard-button" href="/login">
              Go to login
            </a>
          </div>
        </div>
      </main>
    )
  }

  if (!isSupportViewer(viewer.email)) {
    return (
      <main className="dashboard-shell">
        <div className="dashboard-card">
          <div className="dashboard-topbar">
            <ManoaWordmark className="legal-back compact" href="/" />
            <div className="dashboard-topbar-actions">
              <a className="nav-link" href="/dashboard">
                Back to dashboard
              </a>
            </div>
          </div>
          <p className="legal-eyebrow">Support</p>
          <h1 className="dashboard-title">This page is owner-only.</h1>
          <p className="dashboard-lede">
            Your account can use the normal dashboard, but it cannot open the internal support
            view.
          </p>
        </div>
      </main>
    )
  }

  const targetProfile = await findSupportProfile(emailQuery, normalizedPhoneQuery)
  const hasSearch = Boolean(emailQuery || normalizedPhoneQuery)

  let supportState:
    | null
    | {
        rawProfile: SupportProfileRow
        dashboardProfile: DashboardProfile
        subscription: SupportSubscriptionRow | null
        calendarAccounts: Awaited<ReturnType<typeof listConfiguredCalendarAccounts>>
        pendingActions: SupportPendingActionRow[]
        recentTexts: SupportSmsRow[]
        upcomingReminders: SupportReminderRow[]
        checklist: string[]
        calendarWarning: string
      } = null

  if (targetProfile) {
    const dashboardProfile = await getDashboardProfile(targetProfile.id)
    if (!dashboardProfile) {
      throw new Error('Support view could not load the full dashboard profile.')
    }

    const [
      subscriptionResult,
      pendingActionsResult,
      recentTextsResult,
      upcomingRemindersResult,
      calendarAccountsResult,
    ] = await Promise.all([
      supabaseAdmin
        .from('subscriptions')
        .select('status,current_period_end,updated_at')
        .eq('profile_id', targetProfile.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle<SupportSubscriptionRow>(),
      supabaseAdmin
        .from('pending_actions')
        .select('id,kind,status,sms_from,payload,created_at,updated_at,expires_at')
        .eq('profile_id', targetProfile.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(5),
      supabaseAdmin
        .from('sms_messages')
        .select('id,direction,body,created_at')
        .eq('profile_id', targetProfile.id)
        .order('created_at', { ascending: false })
        .limit(12),
      supabaseAdmin
        .from('reminders')
        .select('id,status,due_at,event_starts_at,body')
        .eq('profile_id', targetProfile.id)
        .eq('status', 'pending')
        .order('due_at', { ascending: true })
        .limit(8),
      listConfiguredCalendarAccounts(targetProfile.id)
        .then((accounts) => ({ accounts, warning: '' }))
        .catch((error: unknown) => ({
          accounts: [] as Awaited<ReturnType<typeof listConfiguredCalendarAccounts>>,
          warning:
            error instanceof Error && error.message
              ? 'Configured calendars could not be loaded cleanly from the support view.'
              : 'Configured calendars could not be loaded from the support view.',
        })),
    ])

    if (subscriptionResult.error) throw subscriptionResult.error
    if (pendingActionsResult.error) throw pendingActionsResult.error
    if (recentTextsResult.error) throw recentTextsResult.error
    if (upcomingRemindersResult.error) throw upcomingRemindersResult.error

    const calendarAccounts = calendarAccountsResult.accounts
    const bookingCalendarCount = calendarAccounts.reduce(
      (count, account) => count + account.calendars.filter((calendar) => calendar.allowNewEvents).length,
      0,
    )
    const conflictCalendarCount = calendarAccounts.reduce(
      (count, account) =>
        count + account.calendars.filter((calendar) => calendar.includeInConflicts).length,
      0,
    )
    const pendingActions = (pendingActionsResult.data || []) as SupportPendingActionRow[]
    const upcomingReminders = (upcomingRemindersResult.data || []) as SupportReminderRow[]

    supportState = {
      rawProfile: targetProfile,
      dashboardProfile,
      subscription: subscriptionResult.data,
      calendarAccounts,
      pendingActions,
      recentTexts: (recentTextsResult.data || []) as SupportSmsRow[],
      upcomingReminders,
      checklist: deriveSupportChecklist({
        dashboardProfile,
        rawProfile: targetProfile,
        bookingCalendarCount,
        conflictCalendarCount,
        connectedAccountCount: calendarAccounts.length,
        pendingActions,
        pendingReminderCount: upcomingReminders.length,
      }),
      calendarWarning: calendarAccountsResult.warning,
    }
  }

  return (
    <main className="dashboard-shell">
      <div className="dashboard-card">
        <div className="dashboard-topbar">
          <ManoaWordmark className="legal-back compact" href="/" />
          <div className="dashboard-topbar-actions">
            <a className="nav-link" href="/dashboard">
              Back to dashboard
            </a>
            <a className="nav-link secondary" href="/auth/signout">
              Sign out
            </a>
          </div>
        </div>

        <p className="legal-eyebrow">Support</p>
        <h1 className="dashboard-title">Support view</h1>
        <p className="dashboard-lede">
          Search a Manoa account by email or texting phone so you can see exactly where setup or
          usage is getting stuck.
        </p>
        <p className="dashboard-status-line">Owner-only • Internal support snapshot</p>

        <section className="dashboard-stage">
          <div className="dashboard-stage-head">
            <div>
              <p className="dashboard-stage-label">Search</p>
              <h2>Load one account</h2>
              <p>Exact email is best. Phone should be the number the customer is texting from.</p>
            </div>
          </div>

          <form className="dashboard-support-search" method="get">
            <div className="dashboard-search-inputs">
              <div className="field">
                <label htmlFor="support-email">Email</label>
                <input
                  id="support-email"
                  name="email"
                  type="email"
                  autoComplete="off"
                  defaultValue={emailQuery}
                  placeholder="customer@example.com"
                />
              </div>
              <div className="field">
                <label htmlFor="support-phone">Phone</label>
                <input
                  id="support-phone"
                  name="phone"
                  type="tel"
                  autoComplete="off"
                  defaultValue={rawPhoneQuery}
                  placeholder="+1 555 555 5555"
                />
              </div>
            </div>

            <div className="dashboard-stage-actions">
              <button className="button dashboard-button" type="submit">
                Load account
              </button>
              {hasSearch ? (
                <a className="button dashboard-button secondary-button" href="/dashboard/support">
                  Clear
                </a>
              ) : null}
            </div>
          </form>

          <p className="dashboard-stage-footnote">
            Support login: <strong>{viewer.email}</strong>
          </p>
        </section>

        {hasSearch && !targetProfile ? (
          <div className="notice warning" role="status" aria-live="polite">
            No Manoa account matched that email or phone yet.
          </div>
        ) : null}

        {supportState ? (
          <>
            {supportState.calendarWarning ? (
              <div className="notice warning" role="status" aria-live="polite">
                {supportState.calendarWarning}
              </div>
            ) : null}

            <section className="dashboard-stage">
              <div className="dashboard-stage-head">
                <div>
                  <p className="dashboard-stage-label">Snapshot</p>
                  <h2>{supportState.rawProfile.email}</h2>
                  <p>Fresh read of the setup state, texting state, and latest thread activity.</p>
                </div>
                <span className="dashboard-stage-status">
                  Profile created{' '}
                  {formatDate(supportState.rawProfile.created_at, supportState.rawProfile.timezone)}
                </span>
              </div>

              <div className="dashboard-support-grid">
                <article className="dashboard-support-card">
                  <p className="dashboard-label">Likely next fix</p>
                  <h3>What looks blocked right now</h3>
                  <ul className="dashboard-support-list">
                    {supportState.checklist.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>

                <article className="dashboard-support-card">
                  <p className="dashboard-label">Account</p>
                  <h3>Basic identity</h3>
                  <div className="dashboard-sms-meta">
                    <p>
                      <strong>Email</strong>
                      <span>{supportState.rawProfile.email}</span>
                    </p>
                    <p>
                      <strong>Phone</strong>
                      <span>
                        {supportState.rawProfile.phone_e164
                          ? formatPhoneForDisplay(supportState.rawProfile.phone_e164)
                          : 'Not added'}
                      </span>
                    </p>
                    <p>
                      <strong>Timezone</strong>
                      <span>{supportState.dashboardProfile.timezone}</span>
                    </p>
                    <p>
                      <strong>Last updated</strong>
                      <span>
                        {formatDateTime(
                          supportState.rawProfile.updated_at,
                          supportState.rawProfile.timezone,
                        )}
                      </span>
                    </p>
                  </div>
                </article>

                <article className="dashboard-support-card">
                  <p className="dashboard-label">Billing</p>
                  <h3>Subscription</h3>
                  <div className="dashboard-sms-meta">
                    <p>
                      <strong>Status</strong>
                      <span>{supportState.dashboardProfile.subscriptionStatus || 'Unknown'}</span>
                    </p>
                    <p>
                      <strong>Current period end</strong>
                      <span>
                        {formatDate(
                          supportState.subscription?.current_period_end,
                          supportState.rawProfile.timezone,
                        )}
                      </span>
                    </p>
                  </div>
                </article>

                <article className="dashboard-support-card">
                  <p className="dashboard-label">Texting</p>
                  <h3>Phone and consent</h3>
                  <div className="dashboard-sms-meta">
                    <p>
                      <strong>Phone confirmed</strong>
                      <span>
                        {supportState.rawProfile.phone_confirmed_at
                          ? formatDateTime(
                              supportState.rawProfile.phone_confirmed_at,
                              supportState.rawProfile.timezone,
                            )
                          : 'Not confirmed'}
                      </span>
                    </p>
                    <p>
                      <strong>SMS turned on</strong>
                      <span>{supportState.rawProfile.sms_opted_out_at ? 'No' : 'Yes'}</span>
                    </p>
                    <p>
                      <strong>Morning agenda</strong>
                      <span>{supportState.dashboardProfile.morning_agenda_enabled ? 'On' : 'Off'}</span>
                    </p>
                    <p>
                      <strong>Reminder texts</strong>
                      <span>
                        {supportState.dashboardProfile.reminder_texts_enabled
                          ? `${supportState.dashboardProfile.reminder_lead_minutes} minutes before`
                          : 'Off'}
                      </span>
                    </p>
                  </div>
                </article>

                <article className="dashboard-support-card">
                  <p className="dashboard-label">Defaults</p>
                  <h3>Scheduling behavior</h3>
                  <div className="dashboard-sms-meta">
                    <p>
                      <strong>Default event length</strong>
                      <span>{supportState.dashboardProfile.default_event_duration_minutes} minutes</span>
                    </p>
                    <p>
                      <strong>Calendar connected flag</strong>
                      <span>{supportState.dashboardProfile.calendarConnected ? 'Yes' : 'No'}</span>
                    </p>
                    <p>
                      <strong>Google connected flag</strong>
                      <span>{supportState.dashboardProfile.googleCalendarConnected ? 'Yes' : 'No'}</span>
                    </p>
                  </div>
                </article>

                <article className="dashboard-support-card">
                  <p className="dashboard-label">Pending thread state</p>
                  <h3>
                    {supportState.pendingActions.length
                      ? `${supportState.pendingActions.length} active step${
                          supportState.pendingActions.length === 1 ? '' : 's'
                        }`
                      : 'No active pending step'}
                  </h3>
                  {supportState.pendingActions.length ? (
                    <div className="dashboard-support-stack">
                      {supportState.pendingActions.map((action) => (
                        <details key={action.id} className="dashboard-support-details">
                          <summary>
                            {humanizePendingKind(action.kind)} • expires{' '}
                            {formatDateTime(action.expires_at, supportState.rawProfile.timezone)}
                          </summary>
                          <div className="dashboard-support-details-body">
                            <p>
                              Waiting since{' '}
                              {formatDateTime(action.created_at, supportState.rawProfile.timezone)}
                            </p>
                            <pre className="dashboard-support-code">
                              {JSON.stringify(action.payload || {}, null, 2)}
                            </pre>
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : (
                    <p>Nothing is waiting on a reply right now.</p>
                  )}
                </article>

                <article className="dashboard-support-card">
                  <p className="dashboard-label">Reminder jobs</p>
                  <h3>
                    {supportState.upcomingReminders.length
                      ? `${supportState.upcomingReminders.length} upcoming reminder${
                          supportState.upcomingReminders.length === 1 ? '' : 's'
                        }`
                      : 'No pending reminders'}
                  </h3>
                  {supportState.upcomingReminders.length ? (
                    <div className="dashboard-support-stack">
                      {supportState.upcomingReminders.map((reminder) => (
                        <div key={reminder.id} className="dashboard-support-log-item">
                          <strong>
                            Due {formatDateTime(reminder.due_at, supportState.rawProfile.timezone)}
                          </strong>
                          <span>
                            Event starts{' '}
                            {formatDateTime(
                              reminder.event_starts_at,
                              supportState.rawProfile.timezone,
                            )}
                          </span>
                          <p>{firstLine(reminder.body)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p>No queued reminder texts are on this account right now.</p>
                  )}
                </article>
              </div>
            </section>

            <section className="dashboard-stage">
              <div className="dashboard-stage-head">
                <div>
                  <p className="dashboard-stage-label">Calendars</p>
                  <h2>Configured calendar accounts</h2>
                  <p>These are the calendars Manoa can currently see for this account.</p>
                </div>
                <span className="dashboard-stage-status">
                  {supportState.calendarAccounts.length} connected account
                  {supportState.calendarAccounts.length === 1 ? '' : 's'}
                </span>
              </div>

              {supportState.calendarAccounts.length ? (
                <div className="calendar-account-stack">
                  {supportState.calendarAccounts.map((account) => (
                    <article key={account.accountId} className="calendar-account-card">
                      <div className="calendar-account-head">
                        <div>
                          <h3>{account.accountEmail || `${providerLabel(account.provider)} account`}</h3>
                          <p>
                            {providerLabel(account.provider)} • {account.calendars.length} calendar
                            {account.calendars.length === 1 ? '' : 's'}
                          </p>
                        </div>
                      </div>

                      <div className="dashboard-support-stack">
                        {account.calendars.map((calendar) => (
                          <div key={calendar.connectionId} className="dashboard-support-log-item">
                            <strong>{calendar.label || calendar.sourceName}</strong>
                            <span>
                              {calendar.allowNewEvents ? 'Books here' : 'No booking'} •{' '}
                              {calendar.includeInConflicts ? 'Checks conflicts' : 'No conflicts'} •{' '}
                              {calendar.canWrite ? 'Writable' : 'Read only'}
                              {calendar.isPrimary ? ' • Primary' : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="dashboard-empty-state">
                  <strong>No active calendar accounts.</strong>
                  <p>This usually means the user has not finished calendar connection yet.</p>
                </div>
              )}
            </section>

            <section className="dashboard-stage">
              <div className="dashboard-stage-head">
                <div>
                  <p className="dashboard-stage-label">Recent texts</p>
                  <h2>Latest conversation</h2>
                  <p>Newest messages first so you can see where the thread turned.</p>
                </div>
              </div>

              {supportState.recentTexts.length ? (
                <div className="dashboard-support-stack">
                  {supportState.recentTexts.map((message) => (
                    <article key={message.id} className="dashboard-support-log-item">
                      <div className="dashboard-support-log-head">
                        <strong>{message.direction === 'inbound' ? 'User' : 'Manoa'}</strong>
                        <span>
                          {formatDateTime(message.created_at, supportState.rawProfile.timezone)}
                        </span>
                      </div>
                      <p>{message.body}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="dashboard-empty-state">
                  <strong>No text history yet.</strong>
                  <p>This account has not sent or received SMS messages yet.</p>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  )
}
