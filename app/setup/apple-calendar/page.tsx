import ManoaWordmark from '@/src/components/ManoaWordmark'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Apple Calendar Setup',
  description: 'Prepare iCloud Calendar for Apple Calendar support in Manoa.',
}

const appleSteps = [
  {
    title: 'Turn on two-factor authentication',
    body: 'On your iPhone, open Settings, tap your Apple Account, then open Sign-In & Security and make sure Two-Factor Authentication is on.',
  },
  {
    title: 'Confirm a trusted device or phone number exists',
    body: 'Apple needs at least one trusted device or phone number before it will let third-party apps use app-specific passwords.',
  },
  {
    title: 'Generate an app-specific password',
    body: 'At appleaccount.apple.com, sign in to your Apple Account, open Sign-In & Security, then generate an app-specific password for Manoa.',
  },
  {
    title: 'Keep your iCloud email and app-specific password ready',
    body: 'That pair is what Apple-style calendar syncing usually uses. It is more manual than Google or Outlook, which is why this path takes longer.',
  },
]

export default function AppleCalendarSetupPage() {
  return (
    <main className="setup-shell">
      <div className="setup-card">
        <ManoaWordmark className="legal-back compact" href="/" />
        <p className="legal-eyebrow">Apple Calendar</p>
        <h1 className="setup-title">Prepare iCloud Calendar for Manoa.</h1>
        <p className="setup-lede">
          Apple&apos;s calendar connection is the longer manual path. The good news is you can prep
          it now: two-factor authentication first, then an app-specific password for iCloud.
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
          <div className="status-pill pending">
            <strong>Apple sync in Manoa</strong>
            <span>Guide ready</span>
          </div>
        </div>

        <div className="setup-grid">
          {appleSteps.map((step, index) => (
            <article key={step.title} className="setup-step">
              <span className="step-number">{index + 1}</span>
              <h2>{step.title}</h2>
              <p>{step.body}</p>
            </article>
          ))}
        </div>

        <div className="notice warning" role="status">
          Apple can be simplified on Manoa&apos;s side later, but the 2FA and app-specific password
          pieces are still Apple&apos;s required setup today.
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
          <a className="button dashboard-link-button" href="/dashboard">
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
