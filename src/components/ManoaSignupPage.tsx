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
    question: 'Do I need an app?',
    answer:
      'No. You sign up on the site once, connect your calendar, and then use Manoa by text.',
  },
  {
    question: 'What calendars work with Manoa?',
    answer:
      'Manoa connects to Google Calendar, Outlook, and Apple Calendar.',
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
      'Enter your email and phone, finish checkout, connect your calendar, and send your first text. The whole flow is designed to stay short.',
  },
]

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

const homepageSoftwareApplicationStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Manoa',
  applicationCategory: 'ProductivityApplication',
  operatingSystem: 'Any',
  url: siteUrl,
  description:
    'Manoa is a calendar assistant by text. Schedule meetings, add events from screenshots and flyers, get reminders, and manage your calendar without opening another app.',
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

export default function ManoaSignupPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [demoState, setDemoState] = useState(() => createDemoState())
  const [demoInput, setDemoInput] = useState(DEMO_STARTER_INPUT)
  const [demoPending, setDemoPending] = useState(false)
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
      return
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
    <main className="shell">
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
      <header className="topbar">
        <ManoaWordmark className="brand" href="/" priority />
        <button
          className={`menu-toggle ${mobileMenuOpen ? 'open' : ''}`}
          type="button"
          aria-label="Open navigation"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>
        <nav className={`top-nav ${mobileMenuOpen ? 'open' : ''}`} aria-label="Main navigation">
          <a className="top-link" href="/use-cases" onClick={() => setMobileMenuOpen(false)}>
            Features
          </a>
          <a className="top-link" href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>
            How it works
          </a>
          <a className="top-link" href="#pricing" onClick={() => setMobileMenuOpen(false)}>
            Pricing
          </a>
          <a className="top-link" href="#signup" onClick={() => setMobileMenuOpen(false)}>
            Sign up
          </a>
          <a className="top-link" href="#faq" onClick={() => setMobileMenuOpen(false)}>
            FAQ
          </a>
          <a className="nav-link secondary" href="/login" onClick={() => setMobileMenuOpen(false)}>
            Log in
          </a>
        </nav>
      </header>

      {statusNotice ? (
        <div className={`notice ${statusNotice.tone}`} role="status" aria-live="polite">
          {statusNotice.text}
        </div>
      ) : null}

      <section className="simple-hero" aria-label="Text Manoa">
        <p className="eyebrow">Calendar assistant by text</p>
        <h1>Text your calendar instead of opening it.</h1>
        <p className="simple-hero-lede">
          Manoa is a calendar assistant by text. Schedule meetings, add events from screenshots
          and flyers, and get reminders without opening another app.
        </p>

        <div className="simple-thread" aria-label="Example conversation">
          <div className="simple-bubble user">Schedule a meeting this week</div>
          <div className="simple-bubble manoa">
            <span>Here are 3 times that work:</span>
            <span>Tue 10am</span>
            <span>Wed 2pm</span>
            <span>Thu 11am</span>
          </div>
        </div>

        <a className="button simple-hero-button" href="#pricing">
          Start texting Manoa
        </a>
        <p className="simple-hero-note">Takes 30 seconds • Cancel anytime</p>
        <ul className="simple-hero-benefits" aria-label="Why Manoa feels simple">
          <li>No apps or links</li>
          <li>Send photos, screenshots, flyers, and reminder cards</li>
          <li>Never forget anything with daily agenda and reminders by text</li>
        </ul>
      </section>

      <section className="home-section capability-section" aria-label="What Manoa can handle">
        <div className="capability-copy">
          <p className="section-label section-label-left">Send what you have</p>
          <h2>Text it, snap it, or paste it.</h2>
          <p>
            Manoa can read event details from text messages, screenshots, school flyers, and
            photos, then ask before adding anything to your calendar.
          </p>
        </div>
        <div className="capability-grid">
          <article>
            <strong>Photo to calendar</strong>
            <span>Appointment cards, school flyers, invitations, full schedules.</span>
          </article>
          <article>
            <strong>Plain text requests</strong>
            <span>Meetings, lunches, calls, workouts, reminders, and errands.</span>
          </article>
          <article>
            <strong>Agenda and reminders</strong>
            <span>Ask what is next or get nudged before things start.</span>
          </article>
          <article>
            <strong>Asks when unclear</strong>
            <span>If the date, time, calendar, or person is missing, Manoa asks.</span>
          </article>
        </div>
      </section>

      <section className="home-section" aria-label="Popular ways to use Manoa">
        <p className="section-label section-label-left">Popular searches</p>
        <h2>Start with the calendar problem you already have.</h2>
        <p className="use-case-lede">
          These pages cover the ways people are most likely to find and use Manoa: scheduling by
          text, adding events from screenshots, turning school flyers into calendar events, and
          getting reminders by text.
        </p>
        <div className="use-case-list-grid">
          {homepageUseCases.map((useCase) => (
            <a key={useCase.href} className="use-case-link-card" href={useCase.href}>
              <strong>{useCase.title}</strong>
              <span>{useCase.description}</span>
            </a>
          ))}
        </div>
      </section>

      <section className="home-section working-demo-section" aria-label="Working demo">
        <div className="working-demo-grid">
          <div>
            <p className="section-label section-label-left">Working demo</p>
            <h2 className="working-demo-title">Try the real texting flow.</h2>
            <p className="working-demo-lede">
              This demo uses the same style Manoa uses in the real product: short replies, clear
              numbered options, and honest follow-ups when something still needs a real call.
            </p>
            <button className="demo-prompt working-demo-reset" type="button" onClick={resetDemo}>
              Reset demo
            </button>
          </div>

          <div className="demo-panel" aria-busy={demoPending}>
            <div className="phone-preview" aria-label="SMS preview">
              <div className="phone-header">
                <span>Manoa</span>
                <small>Text message</small>
              </div>
              <div ref={threadRef} className="demo-thread" aria-live="polite">
                {messages.map((message, messageIndex) => (
                  <div key={`${message.role}-${messageIndex}`} className={`sms ${message.role}`}>
                    {message.lines.map((line, lineIndex) => (
                      <span key={`${line}-${lineIndex}`}>
                        {line}
                        {lineIndex < message.lines.length - 1 ? <br /> : null}
                      </span>
                    ))}
                    {message.options ? (
                      <div className="demo-choices">
                        {message.options.map((option, optionIndex) => (
                          <button
                            key={`${option.start}-${option.calendarName}-${optionIndex}`}
                            type="button"
                            className="demo-choice"
                            disabled={demoPending}
                            onClick={() => {
                              void handleDemoText(String(optionIndex + 1))
                            }}
                          >
                            {optionIndex + 1}. {option.dayLabel} at {option.timeLabel} on{' '}
                            {option.calendarName}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
            <form
              className="demo-form"
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
              <button className="button" type="submit" disabled={demoPending}>
                {demoPending ? 'Sending...' : 'Send'}
              </button>
            </form>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="home-section anchor-section" aria-label="How Manoa works">
        <p className="section-label">How it works</p>
        <div className="simple-step-grid">
          <article className="simple-step-card">
            <span className="step-number">1</span>
            <h3>Connect your calendar</h3>
            <p>Takes seconds</p>
          </article>
          <article className="simple-step-card">
            <span className="step-number">2</span>
            <h3>Text what you need</h3>
            <p>&ldquo;Schedule a meeting this week&rdquo;</p>
          </article>
          <article className="simple-step-card">
            <span className="step-number">3</span>
            <h3>Pick a time</h3>
            <p>Manoa handles the rest</p>
          </article>
        </div>
        <ul className="simple-benefit-list" aria-label="Why Manoa feels simple">
          <li>Finds your free time instantly</li>
          <li>No apps or links</li>
          <li>Daily agenda and reminders get sent by text</li>
        </ul>
      </section>

      <section id="pricing" className="home-section pricing-section anchor-section" aria-label="Pricing">
        <p className="section-label">Simple pricing</p>
        <h2 className="pricing-title">$19.99 / month</h2>
        <p className="pricing-trial">14-day free trial</p>
        <p className="pricing-lede">Your availability handled for you — by text.</p>

        <aside id="signup" className="panel pricing-card" aria-label="Start Manoa">
          <form action="/api/start-checkout" method="post">
            <input type="hidden" name="plan" value="personal_monthly_1999" />
            <div className="pricing-form-grid">
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
                <label htmlFor="phone">
                  Phone <span className="field-label-note">(optional — for texting features)</span>
                </label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+1 555 555 5555"
                />
              </div>
            </div>
            <button className="button pricing-button" type="submit">
              Start setup
            </button>
            <p className="pricing-trial-note">Start with 14 days free. Cancel before billing if it is not for you.</p>
            <label className="consent-check pricing-consent" htmlFor="sms-consent">
              <input
                id="sms-consent"
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
            <p className="pricing-optional-note">
              You can use Manoa without texting. Add a phone and turn texts on later if you want.
            </p>
          </form>

          <p className="pricing-meta">Connect Google, Outlook, or Apple after checkout.</p>
          <p className="fine-print pricing-fine-print">
            Manoa only sends service-related account texts. Message frequency varies. Msg &amp;
            data rates may apply.
          </p>
        </aside>
      </section>

      <section id="faq" className="faq anchor-section" aria-label="Frequently asked questions">
        <p className="faq-label">FAQ</p>
        <h2>Answers before you sign up.</h2>
        <div className="faq-grid">
          {homepageFaqs.map((faq) => (
            <article key={faq.question} className="faq-item">
              <h3>{faq.question}</h3>
              <p>{faq.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="home-footer">
        <p>Manoa. Text your calendar back into shape.</p>
        <p className="home-footer-links">
          <a href="/use-cases">Use cases</a> · <a href="/privacy">Privacy</a> ·{' '}
          <a href="/terms">Terms</a> · <a href={`mailto:${siteSupportEmail}`}>Support</a>
        </p>
      </footer>
    </main>
  )
}
