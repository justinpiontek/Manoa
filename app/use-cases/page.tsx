import type { Metadata } from 'next'
import ManoaWordmark from '@/src/components/ManoaWordmark'
import { useCases } from '@/src/lib/useCases'

export const metadata: Metadata = {
  title: 'Use Cases | Manoa',
  description:
    'Explore ways to use Manoa to schedule by text, get calendar reminders, and handle appointment changes without opening another app.',
}

export default function UseCasesPage() {
  return (
    <main className="use-case-shell">
      <div className="use-case-card">
        <ManoaWordmark className="legal-back compact" href="/" />

        <p className="use-case-eyebrow">Use cases</p>
        <h1 className="use-case-title">Ways people can use Manoa right now.</h1>
        <p className="use-case-lede">
          If you want to see where Manoa fits into your day before signing up, start with the
          workflow that sounds most like you.
        </p>

        <div className="use-case-hub-grid">
          {useCases.map((item) => (
            <a key={item.href} className="use-case-hub-card" href={item.href}>
              <span className="use-case-panel-label">{item.eyebrow}</span>
              <h2>{item.cardTitle}</h2>
              <p>{item.cardDescription}</p>
              <span>Read more</span>
            </a>
          ))}
        </div>

        <section className="use-case-section">
          <p className="use-case-section-label">Start here</p>
          <div className="use-case-list-grid">
            <a className="use-case-link-card" href="/schedule-by-text">
              <strong>I need to book something new</strong>
              <span>
                Start with schedule by text if the main problem is turning a quick request into a
                real calendar event without opening your calendar.
              </span>
            </a>
            <a className="use-case-link-card" href="/calendar-reminders-by-text">
              <strong>I need to stay on top of my day</strong>
              <span>
                Start with calendar reminders by text if you want morning agendas and short
                reminders to keep your schedule visible.
              </span>
            </a>
            <a className="use-case-link-card" href="/reschedule-appointments-by-text">
              <strong>I need to move an existing appointment</strong>
              <span>
                Start with reschedule appointments by text if the tricky part is changing
                dentist, doctor, salon, or service appointments honestly.
              </span>
            </a>
          </div>
        </section>
      </div>
    </main>
  )
}
