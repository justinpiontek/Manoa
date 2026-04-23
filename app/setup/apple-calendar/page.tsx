import ManoaWordmark from '@/src/components/ManoaWordmark'
import AppleCalendarConnectForm from '@/src/components/AppleCalendarConnectForm'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Apple Calendar Setup',
  description: 'Prepare iCloud Calendar for Apple Calendar support in Manoa.',
}

const appleSteps = [
  {
    title: 'Open Apple Account in a new tab',
    body: 'Sign in with the Apple Account that owns the calendars you want Manoa to use.',
    href: 'https://account.apple.com',
    cta: 'Open Apple Account',
    visual: 'account',
  },
  {
    title: 'Go to Sign-In & Security',
    body: 'Make sure Two-Factor Authentication is on. Apple requires it for this connection.',
    visual: 'security',
  },
  {
    title: 'Create an app-specific password',
    body: 'Choose App-Specific Passwords, name it Manoa, create it, then copy the generated password.',
    visual: 'password',
  },
  {
    title: 'Paste it here',
    body: 'Come back to this page and paste the generated password below. Do not use your normal Apple password.',
    visual: 'paste',
  },
]

type AppleStepVisualKind = (typeof appleSteps)[number]['visual']

function AppleStepVisual({ visual }: { visual: AppleStepVisualKind }) {
  if (visual === 'account') {
    return (
      <div className="apple-step-visual" aria-hidden="true">
        <div className="apple-browser-bar">
          <span />
          <strong>account.apple.com</strong>
        </div>
        <div className="apple-visual-panel">
          <div className="apple-visual-avatar" />
          <div>
            <strong>Apple Account</strong>
            <span>Sign in</span>
          </div>
        </div>
      </div>
    )
  }

  if (visual === 'security') {
    return (
      <div className="apple-step-visual" aria-hidden="true">
        <div className="apple-visual-list">
          <span>Personal Information</span>
          <strong>Sign-In & Security</strong>
          <span>Payment & Shipping</span>
        </div>
        <div className="apple-visual-callout">Two-Factor Authentication On</div>
      </div>
    )
  }

  if (visual === 'password') {
    return (
      <div className="apple-step-visual" aria-hidden="true">
        <div className="apple-visual-card-title">App-Specific Passwords</div>
        <div className="apple-visual-input">Manoa</div>
        <div className="apple-visual-button">Create</div>
      </div>
    )
  }

  return (
    <div className="apple-step-visual" aria-hidden="true">
      <div className="apple-visual-card-title">Paste into Manoa</div>
      <div className="apple-visual-input">you@icloud.com</div>
      <div className="apple-visual-input is-password">xxxx-xxxx-xxxx-xxxx</div>
      <div className="apple-visual-button">Connect</div>
    </div>
  )
}

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
          Apple takes a few extra steps. Keep this page open, open Apple Account in a new tab,
          create an app-specific password named Manoa, then paste it here.
        </p>

        <div className="apple-setup-panel">
          <section className="apple-setup-steps" aria-label="Apple Calendar connection steps">
            <p className="dashboard-label">Do this first</p>
            <ol className="apple-setup-list">
              {appleSteps.map((step, index) => (
                <li key={step.title}>
                  <span>{index + 1}</span>
                  <div>
                    <AppleStepVisual visual={step.visual} />
                    <strong>{step.title}</strong>
                    <p>{step.body}</p>
                    {'href' in step && step.href ? (
                      <a className="nav-link apple-step-link" href={step.href} target="_blank" rel="noreferrer">
                        {step.cta}
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="dashboard-support-card apple-connect-card">
            <p className="dashboard-label">Then paste here</p>
            <h2>Connect to Manoa</h2>
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
          </section>
        </div>

        <details className="apple-help-details">
          <summary>Need help finding the Apple password screen?</summary>
          <div>
            <p>
              In Apple Account, open <strong>Sign-In & Security</strong>, then look for{' '}
              <strong>App-Specific Passwords</strong>. Two-factor authentication must be on first.
            </p>
            <ul className="dashboard-example-list">
              <li>
                <a href="https://support.apple.com/en-us/102660">Apple: turn on two-factor authentication</a>
              </li>
              <li>
                <a href="https://support.apple.com/en-us/102654">Apple: create an app-specific password</a>
              </li>
            </ul>
          </div>
        </details>

        <div className="notice warning" role="status">
          Apple app-specific passwords are different from your normal Apple password. You can revoke
          the Manoa password later from your Apple Account if needed.
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
