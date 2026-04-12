import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Use Cases | Manoa',
  description:
    'Explore ways to use Manoa to schedule by text, get calendar reminders, and handle appointment changes without opening another app.',
}

const useCases = [
  {
    href: '/schedule-by-text',
    title: 'Schedule by text',
    description:
      'Text what you need, get the best times, and confirm with 1, 2, or 3 instead of bouncing between calendar views.',
  },
  {
    href: '/calendar-reminders-by-text',
    title: 'Calendar reminders by text',
    description:
      'Get a daily agenda plus short reminder texts so your schedule stays visible without opening your calendar app.',
  },
  {
    href: '/reschedule-appointments-by-text',
    title: 'Reschedule appointments by text',
    description:
      'Handle doctor, dentist, salon, and service appointments honestly by prepping the call and updating your calendar after the change is confirmed.',
  },
]

export default function UseCasesPage() {
  return (
    <main className="use-case-shell">
      <div className="use-case-card">
        <a className="legal-back" href="/">
          Back to Manoa
        </a>

        <p className="use-case-eyebrow">Use cases</p>
        <h1 className="use-case-title">Ways people can use Manoa right now.</h1>
        <p className="use-case-lede">
          These pages go deeper on the kinds of calendar work Manoa handles best today, while the
          main site stays focused on the simple signup flow.
        </p>

        <div className="use-case-hub-grid">
          {useCases.map((item) => (
            <a key={item.href} className="use-case-hub-card" href={item.href}>
              <span className="use-case-panel-label">{item.title}</span>
              <h2>{item.title}</h2>
              <p>{item.description}</p>
              <span>Read more</span>
            </a>
          ))}
        </div>

        <section className="use-case-section">
          <p className="use-case-section-label">Why this exists</p>
          <div className="use-case-list-grid">
            <article className="use-case-mini-card">
              <h2>Keep the homepage simple</h2>
              <p>
                Your main landing page should keep selling the core idea. These pages handle the
                deeper questions for people who want specifics.
              </p>
            </article>
            <article className="use-case-mini-card">
              <h2>Support SEO and sharing</h2>
              <p>
                Each page gives you a cleaner destination to share in content, social posts,
                directory listings, and future ad tests.
              </p>
            </article>
            <article className="use-case-mini-card">
              <h2>Grow without redesigning</h2>
              <p>
                You can keep adding new pages over time for workflows like recurring events,
                invitees, or work and personal calendar routing.
              </p>
            </article>
          </div>
        </section>
      </div>
    </main>
  )
}
