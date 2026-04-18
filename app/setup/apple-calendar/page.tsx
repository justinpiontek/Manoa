import ManoaWordmark from '@/src/components/ManoaWordmark'
import AppleCalendarConnectForm from '@/src/components/AppleCalendarConnectForm'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Apple Calendar Setup',
  description: 'Prepare iCloud Calendar for Apple Calendar support in Manoa.',
}

const appleSteps = [
  {
    title: 'Open Apple Account',
    body: 'Go to appleaccount.apple.com and sign in with the Apple Account that owns the calendars you want Manoa to use.',
    href: 'https://appleaccount.apple.com',
    cta: 'Open Apple Account',
  },
  {
    title: 'Check two-factor authentication',
    body: 'Open Sign-In & Security and make sure Two-Factor Authentication is turned on. Apple requires this before app-specific passwords work.',
  },
  {
    title: 'Create an app-specific password',
    body: 'In Sign-In & Security, choose App-Specific Passwords, create one named Manoa, then copy the generated password.',
  },
  {
    title: 'Paste it into Manoa',
    body: 'Come back here, enter your iCloud email and the app-specific password, then connect Apple Calendar.',
  },
]

type AppleCalendarSetupPageProps = {
  searchParams: Promise<{
    profile_id?: string
    account_id?: string
  }>
}

export default async function AppleCalendarSetupPage({ searchParams }: AppleCalendarSetupPageProps) {
  const params = await searchParams
  const profileId = params.profile_id || ''
  const reconnectAccountId = params.account_id || ''

  return (
    <main className="setup-shell">
      <div className="setup-card">
        <ManoaWordmark className="legal-back compact" href="/" />
        <p className="legal-eyebrow">Apple Calendar</p>
        <h1 className="setup-title">Connect Apple Calendar.</h1>
        <p className="setup-lede">
          Apple uses the manual iCloud path. It takes a few more steps than Google, but the flow is:
          create an Apple app-specific password, paste it here, then Manoa will import your Apple
          calendars. One Apple account is supported right now.
        </p>

        <div className="status-row" aria-label="Apple setup progress">
          <div className="status-pill pending">
            <strong>Two-factor authentication</strong>
            <span>Required</span>
          </div>
          <div className="status-pill pending">
            <strong>App-specific password</strong>
            <span>Required</span>
          </div>
          <div className={`status-pill ${profileId ? 'ready' : 'pending'}`}>
            <strong>Apple sync in Manoa</strong>
            <span>{profileId ? 'Ready to connect' : 'Open from dashboard'}</span>
          </div>
        </div>

        <div className="setup-grid apple-step-grid">
          {appleSteps.map((step, index) => (
            <article key={step.title} className="setup-step">
              <span className="step-number">{index + 1}</span>
              <h2>{step.title}</h2>
              <p>{step.body}</p>
              {'href' in step && step.href ? (
                <a className="nav-link apple-step-link" href={step.href} target="_blank" rel="noreferrer">
                  {step.cta}
                </a>
              ) : null}
            </article>
          ))}
        </div>

        <div className="dashboard-support-grid apple-connect-grid">
          <article className="dashboard-support-card apple-connect-card">
            <p className="dashboard-label">Final step</p>
            <h3>Paste the password here</h3>
            <p>
              Use your iCloud email and the app-specific password Apple generated for Manoa. Do not
              paste your normal Apple password.
            </p>
            {profileId ? (
              <AppleCalendarConnectForm
                profileId={profileId}
                reconnectAccountId={reconnectAccountId || null}
              />
            ) : (
              <p className="setup-note">
                Open this page from your dashboard so Manoa knows which account should receive the Apple
                calendars.
              </p>
            )}
          </article>

          <article className="dashboard-support-card">
            <p className="dashboard-label">Before you connect</p>
            <h3>Quick checklist</h3>
            <ul className="dashboard-example-list">
              <li>Two-factor authentication is on.</li>
              <li>You created a password named Manoa.</li>
              <li>You copied the generated app-specific password.</li>
              <li>You are using the Apple Account with the calendars you want.</li>
            </ul>
          </article>
        </div>

        <div className="notice warning" role="status">
          Apple app-specific passwords are different from your normal Apple password. You can revoke
          the Manoa password later from your Apple Account if needed.
        </div>

        <div className="dashboard-support-grid">
          <article className="dashboard-support-card">
            <p className="dashboard-label">Helpful links</p>
            <h3>Official Apple steps</h3>
            <ul className="dashboard-example-list">
              <li>
                <a href="https://support.apple.com/en-us/102660">Turn on two-factor authentication</a>
              </li>
              <li>
                <a href="https://support.apple.com/en-us/102654">Create an app-specific password</a>
              </li>
            </ul>
          </article>

          <article className="dashboard-support-card">
            <p className="dashboard-label">What to save</p>
            <h3>Keep these ready</h3>
            <ul className="dashboard-example-list">
              <li>Your iCloud email address</li>
              <li>Your new app-specific password</li>
              <li>The Apple Account with the calendars you want Manoa to respect</li>
            </ul>
          </article>
        </div>

        <div className="setup-footer">
          <a
            className="button dashboard-link-button"
            href={profileId ? `/dashboard?profile_id=${profileId}` : '/dashboard'}
          >
            Back to dashboard
          </a>
          <a className="nav-link" href="/">
            Back to the site
          </a>
        </div>
      </div>
    </main>
  )
}
