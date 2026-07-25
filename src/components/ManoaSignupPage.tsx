'use client'

import ManoaWordmark from '@/src/components/ManoaWordmark'
import { DEMO_STARTER_INPUT, applyDemoText, createDemoState } from '@/src/lib/demoSms'
import { siteSupportEmail } from '@/src/lib/siteMetadata'
import { useEffect, useRef, useState } from 'react'

const homepageUseCases = [
  {
    href: '/schedule-by-text',
    label: 'Schedule by text',
    title: 'Book something new',
    description:
      'Text what you need, get a few open times, and confirm with 1, 2, or 3 instead of opening your calendar.',
  },
  {
    href: '/add-event-from-screenshot',
    label: 'Add event from screenshot',
    title: 'Turn screenshots into calendar events',
    description:
      'Send an invitation, reminder card, or screenshot and let Manoa pull out the date, time, and place for you.',
  },
  {
    href: '/school-flyer-to-calendar',
    label: 'School flyer to calendar',
    title: 'Pull school dates off flyers',
    description:
      'Send school handouts and important-dates pages so Manoa can help you add the real events to your family calendar.',
  },
  {
    href: '/calendar-reminders-by-text',
    label: 'Agenda and reminders',
    title: 'Stay on top of the day',
    description:
      'Get morning agenda texts and short reminders so your schedule stays visible without another app.',
  },
  {
    href: '/reschedule-appointments-by-text',
    label: 'Appointment changes',
    title: 'Handle dentist and doctor moves honestly',
    description:
      'Prep the call, hold time on your calendar, and update the reminder after the office confirms the change.',
  },
  {
    href: '/multiple-calendars-by-text',
    label: 'Work and personal calendars',
    title: 'Route events to the right calendar',
    description:
      'Use simple hints like work or personal so Manoa can help across the calendars that matter.',
  },
  {
    href: '/multiple-calendars-by-text',
    label: 'Multiple calendars',
    title: 'Keep work, home, and family straight',
    description:
      'Use simple hints like work or family so Manoa can route events to the right calendar and check the right conflicts.',
  },
]

const homepageFaqs = [
  {
    question: 'What can I text Manoa?',
    answer:
      'Try things like "Schedule lunch Tuesday at noon," "What\'s on my calendar tomorrow?," "Move dentist to Friday at 3pm," or send a screenshot or flyer and tell Manoa which calendar to use.',
  },
  {
    question: 'Do I need an app?',
    answer:
      'No. You sign up on the site once, connect your calendar, and then use Manoa by text.',
  },
  {
    question: 'What calendars work with Manoa?',
    answer: 'Manoa works with Google Calendar, Apple Calendar, and Outlook (beta).',
  },
  {
    question: 'Will Manoa change things without me knowing?',
    answer:
      'No. Manoa only books after you confirm by text, and it stays clear about what it changed in your calendar versus what still needs a real call or follow-up.',
  },
  {
    question: 'Can Manoa reschedule doctor or dentist appointments?',
    answer:
      'Manoa will not pretend it changed an office appointment. It can prepare your best times, hold space on your calendar, and update your reminder once the office confirms the new time.',
  },
  {
    question: 'Can I cancel anytime?',
    answer:
      'Yes. The plan is monthly, and you can manage billing or cancel from your Manoa dashboard.',
  },
  {
    question: 'What does setup look like?',
    answer:
      'Enter your email and phone, finish checkout, connect Google, Apple, or Outlook (beta), and send your first text. The whole flow is designed to stay short.',
  },
]

const heroFeaturePoints = [
  { icon: 'chat', label: 'Schedule by text' },
  { icon: 'edit', label: 'Move or cancel plans' },
  { icon: 'calendar', label: 'Add from photos & flyers' },
  { icon: 'bell', label: 'Agenda & reminder texts' },
] as const

type FeatureCard = {
  href: string
  icon: IconName
  title: string
  example: string
  badge?: string
}

const featureCards: FeatureCard[] = [
  {
    href: '/schedule-by-text',
    icon: 'chat',
    title: 'Schedule something new',
    example: '"Schedule lunch Tuesday at noon."',
  },
  {
    href: '/calendar-reminders-by-text',
    icon: 'search',
    title: 'Check your schedule',
    example: '"What\'s on my calendar tomorrow?"',
  },
  {
    href: '/reschedule-appointments-by-text',
    icon: 'edit',
    title: 'Move or cancel a plan',
    example: '"Move dentist to Friday at 3pm."',
  },
  {
    href: '/calendar-reminders-by-text',
    icon: 'bell',
    title: 'Get agenda & reminders',
    example: '"Turn on morning agenda."',
  },
  {
    href: '/add-event-from-screenshot',
    icon: 'image',
    title: 'Add from photos & flyers',
    example: '"(sends a screenshot or school flyer)"',
    badge: 'New',
  },
] as const

const controlPoints = [
  {
    icon: 'shield',
    title: "You're in control",
    body: 'Manoa only takes action after you confirm.',
  },
  {
    icon: 'lock',
    title: 'Secure & private',
    body: 'We never sell your data. Your calendar stays yours.',
  },
  {
    icon: 'chat',
    title: 'Works over text',
    body: 'No app to download. Text from any phone number.',
  },
] as const

const pricingBullets = [
  'Schedule and reschedule by text',
  'Agenda and reminder texts',
  'Add events from screenshots & flyers',
  'Works with Google, Apple, and Outlook (beta)',
]

const reviewPeople = ['JS', 'AM', 'RB', 'KT']

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

const homepageSoftwareApplicationStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Manoa',
  applicationCategory: 'ProductivityApplication',
  operatingSystem: 'Any',
  url: siteUrl,
  description:
    'Manoa is your calendar assistant by text. Schedule events, move plans, add events from screenshots and flyers, and get agenda and reminder texts without opening another app.',
  offers: {
    '@type': 'Offer',
    price: '19.99',
    priceCurrency: 'USD',
    url: `${siteUrl}/#signup`,
  },
}

const homepageFaqStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: homepageFaqs.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.answer,
    },
  })),
}

const homepageUseCaseStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Popular Manoa use cases',
  itemListElement: homepageUseCases.map((useCase, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: useCase.title,
    url: `${siteUrl}${useCase.href}`,
  })),
}

type IconName =
  | 'chat'
  | 'calendar'
  | 'bell'
  | 'lock'
  | 'search'
  | 'edit'
  | 'image'
  | 'shield'
  | 'question'

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.25 8h9.5M8.75 3l4 5-4 5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

function FeatureIcon({ name }: { name: IconName }) {
  switch (name) {
    case 'calendar':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5.5" width="16" height="14.5" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 3.8v3.4M16 3.8v3.4M4 9.5h16" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      )
    case 'bell':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4.5a4.2 4.2 0 0 0-4.2 4.2v2.1c0 1.1-.4 2.1-1.2 3l-1 1h12.8l-1-1a4.2 4.2 0 0 1-1.2-3V8.7A4.2 4.2 0 0 0 12 4.5Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
          <path d="M10.1 18.2a2.2 2.2 0 0 0 3.8 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      )
    case 'lock':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5.5" y="10.3" width="13" height="9" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8.5 10.3V8.5a3.5 3.5 0 0 1 7 0v1.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      )
    case 'search':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="m16 16 3.5 3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      )
    case 'edit':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 18.2h3.1L18.4 9a1.8 1.8 0 0 0 0-2.6l-.8-.8a1.8 1.8 0 0 0-2.6 0L5.8 14.8V18.2Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
          <path d="M13.7 6.9 17.1 10.3M6 20.1h12" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      )
    case 'image':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="9" cy="10" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="m7 16 3.4-3.8 2.7 2.7 1.7-1.9 2.2 3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>
      )
    case 'shield':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4.2 6.5 6.3v5.5c0 3.5 2.2 6.5 5.5 7.9 3.3-1.4 5.5-4.4 5.5-7.9V6.3L12 4.2Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
          <path d="M12 8v7M8.8 11.2H15.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      )
    case 'question':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9.7 9.5a2.5 2.5 0 1 1 4.5 1.5c-.7.8-1.5 1.2-1.5 2.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
          <circle cx="12" cy="16.8" r="1" fill="currentColor" />
        </svg>
      )
    case 'chat':
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 7.2h12a3 3 0 0 1 3 3v3.9a3 3 0 0 1-3 3H11l-3.8 2.6v-2.6H6a3 3 0 0 1-3-3v-3.9a3 3 0 0 1 3-3Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
          <path d="M8 11.2h8M8 14h5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      )
  }
}

function MiniBrand() {
  return (
    <div className="landing-mini-brand">
      <span className="landing-mini-brand-mark">M</span>
      <strong>Manoa</strong>
    </div>
  )
}

function PhoneMockup({ variant }: { variant: 'schedule' | 'reschedule' }) {
  return (
    <div className={`landing-phone-frame is-${variant}`}>
      <div className="landing-phone-shell">
        <div className="landing-phone-notch" aria-hidden="true" />
        <div className="landing-phone-screen">
          <div className="landing-phone-screen-inner">
            <div className="landing-phone-status">
              <span>8:41</span>
              <div className="landing-phone-status-icons" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className="landing-phone-header">
              <MiniBrand />
              <button className="landing-phone-menu" type="button" aria-label="Open menu">
                <span />
                <span />
                <span />
              </button>
            </div>

            <div className="landing-phone-thread">
              {variant === 'schedule' ? (
                <>
                  <div className="landing-phone-bubble user">
                    <span>Schedule team meeting next week</span>
                  </div>

                  <div className="landing-phone-bubble card">
                    <div className="landing-phone-card-head">
                      <span className="landing-phone-message-icon" aria-hidden="true">
                        🗓️
                      </span>
                      <strong>Which calendar should I put &quot;Team Meeting&quot; on?</strong>
                    </div>
                    <p className="landing-phone-card-text">Current request: next week.</p>

                    <div className="landing-phone-options">
                      <div className="landing-phone-option">
                        <span className="landing-phone-option-number">
                          <span className="landing-phone-option-number-value">1</span>
                        </span>
                        <span className="landing-phone-option-text">Home</span>
                      </div>
                      <div className="landing-phone-option">
                        <span className="landing-phone-option-number">
                          <span className="landing-phone-option-number-value">2</span>
                        </span>
                        <span className="landing-phone-option-text">Family</span>
                      </div>
                    </div>

                    <p className="landing-phone-card-footer">Reply with a number or calendar name.</p>
                  </div>

                  <div className="landing-phone-bubble user compact">
                    <span>1</span>
                  </div>

                  <div className="landing-phone-bubble card">
                    <strong>I found these times:</strong>

                    <div className="landing-phone-options">
                      <div className="landing-phone-option">
                        <span className="landing-phone-option-number">
                          <span className="landing-phone-option-number-value">1</span>
                        </span>
                        <span className="landing-phone-option-text">Mon, Jul 27 at 10:00 AM on Home</span>
                      </div>
                      <div className="landing-phone-option">
                        <span className="landing-phone-option-number">
                          <span className="landing-phone-option-number-value">2</span>
                        </span>
                        <span className="landing-phone-option-text">Mon, Jul 27 at 11:00 AM on Home</span>
                      </div>
                      <div className="landing-phone-option">
                        <span className="landing-phone-option-number">
                          <span className="landing-phone-option-number-value">3</span>
                        </span>
                        <span className="landing-phone-option-text">Mon, Jul 27 at 1:00 PM on Home</span>
                      </div>
                    </div>

                    <p className="landing-phone-card-footer">Reply 1, 2, or 3.</p>
                  </div>

                  <div className="landing-phone-bubble user compact">
                    <span>1</span>
                  </div>

                  <div className="landing-phone-bubble confirm">
                    <span className="landing-phone-confirm-icon" aria-hidden="true">
                      ✅
                    </span>
                    <div>
                      <strong>Booked Team Meeting for Mon, Jul 27 at 10:00 AM.</strong>
                      <span>I&apos;ll remind you before it starts.</span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="landing-phone-bubble user">
                    <span>Change team meeting to Tuesday at 9am</span>
                  </div>

                  <div className="landing-phone-bubble card">
                    <strong>I can move Team Meeting to:</strong>

                    <div className="landing-phone-options">
                      <div className="landing-phone-option">
                        <span className="landing-phone-option-number">
                          <span className="landing-phone-option-number-value">1</span>
                        </span>
                        <span className="landing-phone-option-text">Tue, Jul 28 at 9:00 AM on Home</span>
                      </div>
                      <div className="landing-phone-option">
                        <span className="landing-phone-option-number">
                          <span className="landing-phone-option-number-value">2</span>
                        </span>
                        <span className="landing-phone-option-text">Tue, Jul 28 at 10:00 AM on Home</span>
                      </div>
                      <div className="landing-phone-option">
                        <span className="landing-phone-option-number">
                          <span className="landing-phone-option-number-value">3</span>
                        </span>
                        <span className="landing-phone-option-text">Tue, Jul 28 at 11:00 AM on Home</span>
                      </div>
                    </div>

                    <p className="landing-phone-card-footer">Reply 1, 2, or 3.</p>
                  </div>

                  <div className="landing-phone-bubble user compact">
                    <span>1</span>
                  </div>

                  <div className="landing-phone-bubble neutral">
                    <strong>Moved Team Meeting to Tue, Jul 28 at 9:00 AM.</strong>
                  </div>
                </>
              )}
            </div>

            <div className="landing-phone-composer">
              <button type="button" className="landing-composer-icon" aria-label="Add">
                +
              </button>
              <div className="landing-composer-input">Text Manoa anything...</div>
              <button type="button" className="landing-composer-send" aria-label="Send">
                <ArrowIcon />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ManoaSignupPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [demoState, setDemoState] = useState(() => createDemoState())
  const [demoInput, setDemoInput] = useState(DEMO_STARTER_INPUT)
  const [demoPending, setDemoPending] = useState(false)
  const [signupPhone, setSignupPhone] = useState('')
  const [statusNotice, setStatusNotice] = useState<{
    tone: 'success' | 'warning'
    text: string
  } | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const messages = demoState.messages

  useEffect(() => {
    const thread = threadRef.current
    if (!thread) return
    thread.scrollTop = thread.scrollHeight
  }, [messages])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    if (params.get('calendar') === 'connected') {
      setStatusNotice({
        tone: 'success',
        text: 'Calendar connected. Manoa can now check availability and book events for your account.',
      })
      return
    }

    if (params.get('checkout') === 'cancelled') {
      setStatusNotice({
        tone: 'warning',
        text: 'Checkout was cancelled. You can come back here any time and start again.',
      })
      return
    }

    const checkoutError = params.get('checkout_error')
    if (checkoutError) {
      setStatusNotice({
        tone: 'warning',
        text: checkoutError,
      })
      return
    }

    if (params.get('access') === 'not_found') {
      setStatusNotice({
        tone: 'warning',
        text: 'We could not find an account with that email and phone number together. Try the exact signup details you used.',
      })
      return
    }

    if (params.get('access') === 'invalid') {
      setStatusNotice({
        tone: 'warning',
        text: 'Use the same email and phone number you signed up with to open your dashboard.',
      })
    }
  }, [])

  async function handleDemoText(text: string) {
    const trimmed = text.trim()
    if (!trimmed || demoPending) return

    setDemoPending(true)

    try {
      const response = await fetch('/api/demo/text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          body: trimmed,
          state: demoState,
        }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { state?: ReturnType<typeof createDemoState> }
        | null

      if (!response.ok || !payload?.state) {
        throw new Error('Demo route failed.')
      }

      setDemoState(payload.state)
    } catch {
      setDemoState((current) => applyDemoText(current, trimmed))
    } finally {
      setDemoPending(false)
    }
  }

  function resetDemo() {
    setDemoState(createDemoState())
    setDemoInput(DEMO_STARTER_INPUT)
  }

  return (
    <main className="shell landing-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(homepageSoftwareApplicationStructuredData),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(homepageFaqStructuredData),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(homepageUseCaseStructuredData),
        }}
      />

      <header className="topbar landing-topbar">
        <ManoaWordmark className="landing-brand" href="/" priority />
        <div className="landing-header-right">
          <nav className={`top-nav landing-top-nav ${mobileMenuOpen ? 'open' : ''}`} aria-label="Main navigation">
            <a className="top-link landing-top-link" href="#features" onClick={() => setMobileMenuOpen(false)}>
              Features
            </a>
            <a className="top-link landing-top-link" href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>
              How It Works
            </a>
            <a className="top-link landing-top-link" href="#pricing" onClick={() => setMobileMenuOpen(false)}>
              Pricing
            </a>
            <a className="top-link landing-top-link" href="#faq" onClick={() => setMobileMenuOpen(false)}>
              FAQ
            </a>
            <a className="top-link landing-utility-link" href="/login" onClick={() => setMobileMenuOpen(false)}>
              Log in
            </a>
            <a className="button landing-nav-cta" href="#signup" onClick={() => setMobileMenuOpen(false)}>
              Start setup
              <ArrowIcon />
            </a>
          </nav>

          <a className="button landing-header-cta" href="#signup">
            Start setup
            <ArrowIcon />
          </a>

          <button
            className={`menu-toggle landing-menu-toggle ${mobileMenuOpen ? 'open' : ''}`}
            type="button"
            aria-label="Open navigation"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </header>

      {statusNotice ? (
        <div className={`notice ${statusNotice.tone}`} role="status" aria-live="polite">
          {statusNotice.text}
        </div>
      ) : null}

      <section className="landing-hero" aria-label="Text Manoa">
        <div className="landing-hero-copy">
          <p className="eyebrow landing-badge">Calendar assistant by text</p>
          <h1 className="landing-title">Text your calendar instead of opening it.</h1>
          <p className="landing-lede">
            Schedule something new, move plans, add events from screenshots and flyers, and get
            agenda and reminder texts without opening another app.
          </p>

          <div className="landing-hero-actions">
            <a className="button landing-primary-button" href="#signup">
              Start setup - takes 30 seconds
              <ArrowIcon />
            </a>
            <a className="landing-secondary-button" href="#demo">
              Try the demo
            </a>
          </div>

          <div className="landing-hero-points" aria-label="What Manoa does">
            {heroFeaturePoints.map((point) => (
              <div key={point.label} className="landing-hero-point">
                <div className="landing-icon-tile">
                  <FeatureIcon name={point.icon} />
                </div>
                <span>{point.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="landing-hero-visual">
          <PhoneMockup variant="schedule" />
        </div>
      </section>

      <section id="features" className="landing-feature-section">
        <p className="landing-section-kicker">What Manoa helps with</p>
        <h2 className="landing-section-title">The everyday calendar jobs Manoa handles by text.</h2>

        <div className="landing-feature-grid">
          {featureCards.map((card) => (
            <a key={card.title} className="landing-feature-card" href={card.href}>
              <div className="landing-feature-icon">
                <FeatureIcon name={card.icon} />
              </div>
              {card.badge ? <span className="landing-feature-badge">{card.badge}</span> : null}
              <strong>{card.title}</strong>
              <span>{card.example}</span>
            </a>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="landing-control-section">
        <div className="landing-control-visual">
          <PhoneMockup variant="reschedule" />
        </div>

        <div className="landing-control-copy">
          <div className="landing-control-icon">
            <FeatureIcon name="shield" />
          </div>
          <h2 className="landing-control-title">
            Your calendar stays yours. <span>You&apos;re always in control.</span>
          </h2>

          <div className="landing-control-points">
            {controlPoints.map((point) => (
              <article key={point.title} className="landing-control-point">
                <div className="landing-control-point-icon">
                  <FeatureIcon name={point.icon} />
                </div>
                <div>
                  <strong>{point.title}</strong>
                  <p>{point.body}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="landing-proof">
            <div className="landing-avatar-stack" aria-hidden="true">
              {reviewPeople.map((person) => (
                <span key={person} className="landing-avatar-chip">
                  {person}
                </span>
              ))}
            </div>
            <div>
              <p className="landing-proof-stars">★★★★★</p>
              <p className="landing-proof-copy">
                Loved by busy professionals, parents, and student athletes.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="landing-pricing-section">
        <div className="landing-pricing-copy">
          <p className="landing-section-kicker">Simple pricing</p>
          <h2 className="landing-pricing-title">
            Less than the cost of <span>lunch</span> each month.
          </h2>
          <ul className="landing-pricing-list">
            {pricingBullets.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <aside id="signup" className="panel landing-pricing-card" aria-label="Start Manoa">
          <p className="landing-plan-label">Manoa Premium</p>
          <p className="landing-plan-trial">Start with 14 days free</p>
          <div className="landing-plan-price">
            <strong>$19.99</strong>
            <span>/month after trial</span>
          </div>
          <p className="landing-plan-copy">
            Text your calendar instead of opening it.
          </p>

          <form action="/api/start-checkout" method="post" className="landing-signup-form">
            <input type="hidden" name="plan" value="personal_monthly_1999" />
            <div className="pricing-form-grid landing-pricing-form-grid">
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="phone">Phone</label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+1 555 555 5555"
                  value={signupPhone}
                  onChange={(event) => setSignupPhone(event.target.value)}
                />
              </div>
            </div>

            <button className="button landing-pricing-button" type="submit">
              Start free trial
              <ArrowIcon />
            </button>

            <p className="landing-card-meta">Secure checkout. Cancel anytime.</p>
            <p className="pricing-optional-note">Connect Google, Apple, or Outlook (beta) after checkout.</p>

            {signupPhone.trim() ? (
              <label className="consent-check pricing-consent" htmlFor="sms-consent">
                <input id="sms-consent" name="sms_consent" type="checkbox" value="yes" />
                <span>
                  I agree to receive recurring service-related SMS messages from Manoa, including
                  scheduling, reminders, and account notifications. Message frequency varies. Msg
                  &amp; data rates may apply. Reply STOP to opt out and HELP for help. See{' '}
                  <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms</a>.
                </span>
              </label>
            ) : null}

            <p className="pricing-optional-note">You can add a phone later if you want texting.</p>
          </form>
        </aside>
      </section>

      <section id="demo" className="landing-demo-section" aria-label="Interactive demo">
        <div className="landing-demo-copy">
          <p className="landing-section-kicker">Try the demo</p>
          <h2 className="landing-demo-title">See the real texting flow.</h2>
          <p className="landing-demo-lede">
            This keeps the live demo working on the homepage. Try a scheduling request, an agenda
            question, or a reschedule and see how the replies feel.
          </p>
          <button className="landing-secondary-button landing-demo-reset" type="button" onClick={resetDemo}>
            Reset demo
          </button>
        </div>

        <div className="landing-demo-panel" aria-busy={demoPending}>
          <div className="landing-demo-phone">
            <div className="landing-demo-phone-head">
              <MiniBrand />
              <small>Live demo</small>
            </div>
            <div ref={threadRef} className="landing-demo-thread" aria-live="polite">
              {messages.map((message, messageIndex) => (
                <div key={`${message.role}-${messageIndex}`} className={`landing-demo-message ${message.role}`}>
                  {message.lines.map((line, lineIndex) => (
                    <span key={`${line}-${lineIndex}`}>
                      {line}
                      {lineIndex < message.lines.length - 1 ? <br /> : null}
                    </span>
                  ))}
                  {message.options ? (
                    <div className="landing-demo-choices">
                      {message.options.map((option, optionIndex) => (
                        <button
                          key={`${option.start}-${option.calendarName}-${optionIndex}`}
                          type="button"
                          className="landing-demo-choice"
                          disabled={demoPending}
                          onClick={() => {
                            void handleDemoText(String(optionIndex + 1))
                          }}
                        >
                          {optionIndex + 1}. {option.dayLabel} at {option.timeLabel} on {option.calendarName}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <form
              className="landing-demo-form"
              onSubmit={async (event) => {
                event.preventDefault()
                await handleDemoText(demoInput)
                setDemoInput('')
              }}
            >
              <input
                value={demoInput}
                onChange={(event) => setDemoInput(event.target.value)}
                autoComplete="off"
                placeholder="Need a meeting with Beth this week"
                aria-label="Text Manoa demo"
                disabled={demoPending}
              />
              <button className="button landing-demo-send" type="submit" disabled={demoPending}>
                {demoPending ? 'Sending...' : 'Send'}
              </button>
            </form>
          </div>
        </div>
      </section>

      <section id="faq" className="landing-faq-section">
        <details className="landing-faq-panel">
          <summary>
            <span className="landing-faq-summary-copy">
              <span className="landing-faq-summary-icon">
                <FeatureIcon name="question" />
              </span>
              Questions? We&apos;ve got answers.
            </span>
            <span className="landing-faq-summary-chevron" aria-hidden="true">
              <ArrowIcon />
            </span>
          </summary>

          <div className="landing-faq-grid">
            {homepageFaqs.map((faq) => (
              <article key={faq.question} className="landing-faq-item">
                <h3>{faq.question}</h3>
                <p>{faq.answer}</p>
              </article>
            ))}
          </div>
        </details>
      </section>

      <footer className="home-footer landing-footer">
        <div className="landing-footer-brand">
          <ManoaWordmark className="landing-footer-wordmark" href="/" />
          <p>&copy; {new Date().getFullYear()} Manoa. All rights reserved.</p>
        </div>
        <p className="home-footer-links landing-footer-links">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href={`mailto:${siteSupportEmail}`}>Contact</a>
        </p>
      </footer>
    </main>
  )
}
