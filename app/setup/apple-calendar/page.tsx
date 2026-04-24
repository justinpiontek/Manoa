import ManoaWordmark from '@/src/components/ManoaWordmark'
import AppleCalendarConnectForm from '@/src/components/AppleCalendarConnectForm'
import Image from 'next/image'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Apple Calendar Setup',
  description: 'Prepare iCloud Calendar for Apple Calendar support in Manoa.',
}

type AppleStepScreenshot = {
  src: string
  width: number
  height: number
  alt: string
}

type AppleStep = {
  title: string
  body: string
  href?: string
  cta?: string
  screenshots: AppleStepScreenshot[]
}

const appleSteps: AppleStep[] = [
  {
    title: 'Open Apple Account and sign in',
    body: 'Go to Apple Account, sign in, and open Sign-In and Security.',
    href: 'https://account.apple.com',
    cta: 'Open Apple Account',
    screenshots: [
      {
        src: '/images/apple-calendar/sign-in-security.png',
        width: 1053,
        height: 898,
        alt: 'Apple Account Sign-In and Security page with the App-Specific Passwords card visible.',
      },
    ],
  },
  {
    title: 'Open App-Specific Passwords',
    body: 'Choose App-Specific Passwords, then select Generate an app-specific password.',
    screenshots: [
      {
        src: '/images/apple-calendar/app-specific-passwords.png',
        width: 695,
        height: 498,
        alt: 'Apple App-Specific Passwords panel with a generate password button.',
      },
    ],
  },
  {
    title: 'Create and copy the Manoa password',
    body: 'Type Manoa as the label, create it, then copy the password Apple shows.',
    screenshots: [
      {
        src: '/images/apple-calendar/generate-password.png',
        width: 470,
        height: 371,
        alt: 'Apple generate app-specific password dialog with a label field.',
      },
      {
        src: '/images/apple-calendar/copy-password.png',
        width: 449,
        height: 300,
        alt: 'Apple dialog showing the generated app-specific password to copy.',
      },
    ],
  },
]

function AppleStepVisual({ screenshots }: { screenshots: AppleStepScreenshot[] }) {
  return (
    <div className={`apple-step-visual apple-step-screenshots${screenshots.length > 1 ? ' is-pair' : ''}`}>
      {screenshots.map((screenshot) => (
        <Image
          key={screenshot.src}
          src={screenshot.src}
          width={screenshot.width}
          height={screenshot.height}
          alt={screenshot.alt}
          sizes="(max-width: 700px) 100vw, 700px"
        />
      ))}
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
          create an app-specific password named Manoa, then enter the email and password in step 4.
        </p>

        <div className="apple-setup-panel">
          <section className="apple-setup-steps apple-setup-steps-full" aria-label="Apple Calendar connection steps">
            <p className="dashboard-label">Do this first</p>
            <ol className="apple-setup-list">
              {appleSteps.map((step, index) => (
                <li key={step.title}>
                  <span>{index + 1}</span>
                  <div>
                    <AppleStepVisual screenshots={step.screenshots} />
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
              <li className="apple-form-step">
                <span>4</span>
                <div className="apple-form-step-card">
                  <strong>Enter it in Manoa</strong>
                  <p>
                    Use the Apple email for your iCloud calendars and the app-specific password Apple generated.
                    Do not enter your normal Apple password.
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
                </div>
              </li>
            </ol>
          </section>
        </div>

        <details className="apple-help-details">
          <summary>Need help finding the Apple password screen?</summary>
          <div>
            <p>
              In Apple Account, open <strong>Sign-In & Security</strong>, then look for{' '}
              <strong>App-Specific Passwords</strong>. If you do not see it, Apple may need
              two-factor authentication turned on for your account first.
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
            href="/dashboard"
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
