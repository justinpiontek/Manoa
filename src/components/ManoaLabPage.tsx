'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  classifySimulatorEvent,
  createInitialSimulatorState,
  getPendingChoices,
  type SimulatorState,
} from '@/src/lib/sms/simulator'

const quickPrompts = [
  'book budget review with Sam and Priya Tuesday at 2pm',
  'set up a weekly 1:1 with Sam every Tuesday at 2pm',
  'can you fit in a 9am meeting Tuesday on my work calendar',
  'what does tomorrow look like',
  'reschedule my dentist appointment',
  'the 11am one',
  'they moved it to Tuesday at 2pm',
  'STOP',
]

export default function ManoaLabPage() {
  const [state, setState] = useState<SimulatorState>(() => createInitialSimulatorState())
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const threadRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const thread = threadRef.current
    if (!thread) return
    thread.scrollTop = thread.scrollHeight
  }, [state.messages])

  const pendingChoices = useMemo(() => getPendingChoices(state), [state])

  async function send(text: string) {
    const clean = text.trim()
    if (!clean || isSending) return

    setIsSending(true)
    try {
      const response = await fetch('/api/lab/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          state,
          body: clean,
        }),
      })

      if (!response.ok) {
        throw new Error('Simulator request failed')
      }

      const result = (await response.json()) as { state: SimulatorState }
      setState(result.state)
      setDraft('')
    } catch {
      setState((current) => ({
        ...current,
        messages: [
          ...current.messages,
          { role: 'user', text: clean },
          {
            role: 'manoa',
            text: 'Something went wrong in the lab preview. Try again in a second.',
          },
        ],
      }))
    } finally {
      setIsSending(false)
    }
  }

  function toggleFlag(flag: 'recognized' | 'subscriptionActive' | 'calendarConnected' | 'smsEnabled') {
    setState((current) => ({ ...current, [flag]: !current[flag] }))
  }

  return (
    <main className="lab-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Back to Manoa">
          <span className="mark" aria-hidden="true">
            M
          </span>
          <span className="brand-name">Manoa</span>
        </a>
        <a className="nav-link" href="/">
          Back to site
        </a>
      </header>

      <section className="lab-hero" aria-label="Internal preview">
        <p className="eyebrow">Internal preview</p>
        <h1>See what the backend is deciding.</h1>
        <p className="lede">
          This page uses the real parser and event-authority rules, but runs them against an in-memory
          calendar so you can test the logic without waiting on Twilio, Stripe, or Google.
        </p>
      </section>

      <section className="lab-controls panel" aria-label="Simulation switches">
        <button
          type="button"
          className={`toggle ${state.recognized ? 'on' : 'off'}`}
          onClick={() => toggleFlag('recognized')}
        >
          Number recognized: {state.recognized ? 'On' : 'Off'}
        </button>
        <button
          type="button"
          className={`toggle ${state.subscriptionActive ? 'on' : 'off'}`}
          onClick={() => toggleFlag('subscriptionActive')}
        >
          Subscription active: {state.subscriptionActive ? 'On' : 'Off'}
        </button>
        <button
          type="button"
          className={`toggle ${state.calendarConnected ? 'on' : 'off'}`}
          onClick={() => toggleFlag('calendarConnected')}
        >
          Calendar connected: {state.calendarConnected ? 'On' : 'Off'}
        </button>
        <button
          type="button"
          className={`toggle ${state.smsEnabled ? 'on' : 'off'}`}
          onClick={() => toggleFlag('smsEnabled')}
        >
          SMS enabled: {state.smsEnabled ? 'On' : 'Off'}
        </button>
        <button
          type="button"
          className="toggle reset"
          onClick={() => {
            setState(createInitialSimulatorState())
            setDraft('')
          }}
        >
          Reset state
        </button>
      </section>

      <section className="lab-grid">
        <div className="panel lab-phone">
          <div className="phone-header">
            <span>Manoa</span>
            <small>Internal SMS preview</small>
          </div>
          <div ref={threadRef} className="demo-thread lab-thread" aria-live="polite">
            {state.messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`sms ${message.role}`}>
                {message.text.split('\n').map((line, lineIndex) => (
                  <span key={`${index}-${lineIndex}`}>
                    {line}
                    {lineIndex < message.text.split('\n').length - 1 ? <br /> : null}
                  </span>
                ))}
              </div>
            ))}
          </div>

          {pendingChoices.length ? (
            <div className="lab-choice-bar">
              {pendingChoices.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className="demo-choice"
                  onClick={() => void send(choice.value)}
                  disabled={isSending}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="demo-actions">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                className="demo-prompt"
                type="button"
                onClick={() => setDraft(prompt)}
                disabled={isSending}
              >
                {prompt}
              </button>
            ))}
          </div>

          <form
            className="demo-form"
            onSubmit={(event) => {
              event.preventDefault()
              void send(draft)
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoComplete="off"
              placeholder="Text Manoa here"
              aria-label="Internal Manoa preview"
              disabled={isSending}
            />
            <button className="button" type="submit">
              {isSending ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>

        <div className="lab-stack">
          <section className="panel lab-panel">
            <p className="plan-label">Last decision</p>
            {state.lastDebug ? (
              <div className="lab-debug">
                <p>
                  <strong>Intent:</strong> {state.lastDebug.intent}
                </p>
                <p>
                  <strong>Branch:</strong> {state.lastDebug.branch}
                </p>
                <p>
                  <strong>Understood by:</strong> {state.lastDebug.understoodBy || 'Fallback parser'}
                </p>
                {state.lastDebug.matchedEvent ? (
                  <p>
                    <strong>Matched event:</strong> {state.lastDebug.matchedEvent}
                  </p>
                ) : null}
                {state.lastDebug.authority ? (
                  <p>
                    <strong>Authority:</strong> {state.lastDebug.authority}
                  </p>
                ) : null}
                <ul className="lab-notes">
                  {state.lastDebug.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="lab-empty">Send a message to watch the logic path.</p>
            )}
          </section>

          <section className="panel lab-panel">
            <p className="plan-label">Today</p>
            <div className="lab-list">
              {state.todayEvents.map((event) => (
                <article key={event.id} className="lab-item">
                  <div>
                    <strong>
                      {event.timeLabel} {event.title}
                    </strong>
                    <span>{event.calendarName}</span>
                    {event.description ? <span>{event.description}</span> : null}
                  </div>
                  <em>{classifySimulatorEvent(state, event)}</em>
                </article>
              ))}
            </div>
          </section>

          <section className="panel lab-panel">
            <p className="plan-label">Tomorrow</p>
            <div className="lab-list">
              {state.tomorrowEvents.map((event) => (
                <article key={event.id} className="lab-item">
                  <div>
                    <strong>
                      {event.timeLabel} {event.title}
                    </strong>
                    <span>{event.calendarName}</span>
                    {event.description ? <span>{event.description}</span> : null}
                  </div>
                  <em>{classifySimulatorEvent(state, event)}</em>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}
