import { appUrl } from '@/src/lib/env'
import type { UseCaseBenefit, UseCaseFaq, UseCaseLink, UseCaseStep } from '@/src/lib/useCases'

type UseCasePageProps = {
  href: string
  eyebrow: string
  title: string
  description: string
  intro: string
  exampleUser: string
  exampleManoa: string
  benefits: UseCaseBenefit[]
  idealFor: string[]
  steps: UseCaseStep[]
  faqs: UseCaseFaq[]
  relatedLinks: UseCaseLink[]
}

export default function UseCasePage({
  href,
  eyebrow,
  title,
  description,
  intro,
  exampleUser,
  exampleManoa,
  benefits,
  idealFor,
  steps,
  faqs,
  relatedLinks,
}: UseCasePageProps) {
  const baseUrl = appUrl()
  const fullUrl = `${baseUrl}${href}`
  const softwareApplicationStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Manoa',
    applicationCategory: 'ProductivityApplication',
    operatingSystem: 'Any',
    url: baseUrl,
    description,
    offers: {
      '@type': 'Offer',
      price: '19.99',
      priceCurrency: 'USD',
      url: `${baseUrl}/#signup`,
    },
  }
  const faqStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  }
  const breadcrumbStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Manoa',
        item: baseUrl,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Use cases',
        item: `${baseUrl}/use-cases`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: title,
        item: fullUrl,
      },
    ],
  }

  return (
    <main className="use-case-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(softwareApplicationStructuredData),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqStructuredData),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbStructuredData),
        }}
      />
      <div className="use-case-card">
        <div className="use-case-topbar">
          <a className="legal-back" href="/">
            Back to Manoa
          </a>
          <a className="nav-link secondary" href="/use-cases">
            All use cases
          </a>
        </div>

        <p className="use-case-eyebrow">{eyebrow}</p>
        <h1 className="use-case-title">{title}</h1>
        <p className="use-case-lede">{description}</p>

        <section className="use-case-hero-grid" aria-label={title}>
          <div className="use-case-panel">
            <p className="use-case-panel-label">How it works</p>
            <p className="use-case-copy">{intro}</p>

            <div className="hero-example use-case-example" aria-label="Example conversation">
              <p className="hero-example-label">Example</p>
              <div className="hero-example-bubble user">
                <strong>You</strong>
                <span>{exampleUser}</span>
              </div>
              <div className="hero-example-bubble manoa">
                <strong>Manoa</strong>
                <span>{exampleManoa}</span>
              </div>
            </div>

            <div className="use-case-benefit-grid">
              {benefits.map((benefit) => (
                <article key={benefit.title} className="use-case-mini-card">
                  <h2>{benefit.title}</h2>
                  <p>{benefit.body}</p>
                </article>
              ))}
            </div>
          </div>

          <aside className="use-case-panel use-case-cta-panel">
            <p className="use-case-panel-label">Start with Manoa</p>
            <h2 className="use-case-cta-title">Use the same signup flow you already have.</h2>
            <p className="use-case-copy">
              Sign up once, connect Google Calendar or Outlook, and then handle this workflow by
              text from your phone.
            </p>
            <div className="use-case-cta-list">
              <span>$19.99 per month</span>
              <span>Cancel anytime</span>
              <span>No app to install</span>
            </div>
            <a className="button" href="/#signup">
              Start texting Manoa
            </a>
            <a className="nav-link secondary use-case-secondary-link" href="/login">
              Log in
            </a>
          </aside>
        </section>

        <section className="use-case-section">
          <p className="use-case-section-label">Best for</p>
          <div className="use-case-list-grid">
            {idealFor.map((item) => (
              <article key={item} className="use-case-mini-card">
                <p>{item}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="use-case-section">
          <p className="use-case-section-label">What happens</p>
          <div className="use-case-list-grid">
            {steps.map((step) => (
              <article key={step.title} className="use-case-mini-card">
                <h2>{step.title}</h2>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="use-case-section">
          <p className="use-case-section-label">FAQ</p>
          <div className="use-case-faq-grid">
            {faqs.map((faq) => (
              <article key={faq.question} className="use-case-mini-card">
                <h2>{faq.question}</h2>
                <p>{faq.answer}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="use-case-section">
          <p className="use-case-section-label">Related pages</p>
          <div className="use-case-list-grid">
            {relatedLinks.map((link) => (
              <a key={link.href} className="use-case-link-card" href={link.href}>
                <strong>{link.label}</strong>
                <span>{link.description}</span>
              </a>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
