'use client'

import type { SmsThreadMessage } from '@/src/lib/sms/thread'
import { useEffect, useRef, useState } from 'react'

type DashboardTextConsoleProps = {
  initialMessages: SmsThreadMessage[]
  starterPrompts: string[]
}

export default function DashboardTextConsole({
  initialMessages,
  starterPrompts,
}: DashboardTextConsoleProps) {
  const [messages, setMessages] = useState(initialMessages)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [photoPending, setPhotoPending] = useState(false)
  const [error, setError] = useState('')
  const threadRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const thread = threadRef.current
    if (!thread) return
    thread.scrollTop = thread.scrollHeight
  }, [messages])

  async function sendText(rawText: string) {
    const text = rawText.trim()
    if (!text || pending) return

    setPending(true)
    setError('')

    try {
      const response = await fetch('/api/dashboard/text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: text }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; messages?: SmsThreadMessage[] }
        | null

      if (!response.ok || !payload?.messages) {
        setError(payload?.error || 'That text did not go through yet.')
        return
      }

      setMessages(payload.messages)
      setInput('')
    } catch {
      setError('That text did not go through yet.')
    } finally {
      setPending(false)
    }
  }

  async function sendPhoto(file: File | null | undefined) {
    if (!file || pending || photoPending) return

    setPhotoPending(true)
    setError('')

    try {
      const formData = new FormData()
      formData.append('image', file)
      if (input.trim()) {
        formData.append('caption', input.trim())
      }

      const response = await fetch('/api/dashboard/photo', {
        method: 'POST',
        body: formData,
      })

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; messages?: SmsThreadMessage[] }
        | null

      if (!response.ok || !payload?.messages) {
        setError(payload?.error || 'I could not read that photo yet.')
        return
      }

      setMessages(payload.messages)
      setInput('')
    } catch {
      setError('I could not read that photo yet.')
    } finally {
      setPhotoPending(false)
    }
  }

  return (
    <div className="dashboard-live-grid">
      <div className="phone-preview dashboard-live-phone" aria-label="Live Manoa console">
        <div className="phone-header">
          <span>Manoa</span>
          <small>Live console</small>
        </div>
        <div ref={threadRef} className="demo-thread dashboard-live-thread" aria-live="polite">
          {messages.length ? (
            messages.map((message) => (
              <div key={message.id} className={`sms ${message.role}`}>
                {message.lines.map((line, index) => (
                  <span key={`${message.id}-${index}`}>
                    {line}
                    {index < message.lines.length - 1 ? <br /> : null}
                  </span>
                ))}
              </div>
            ))
          ) : (
            <div className="dashboard-live-empty">
              <strong>No texts yet.</strong>
              <p>Send one below and Manoa will use your real account, calendars, and scheduling logic.</p>
            </div>
          )}
        </div>
      </div>

      <div className="dashboard-live-panel">
        <p className="dashboard-label">Use Manoa here</p>
        <h3>Real backend, real calendars.</h3>
        <p>
          This runs through the same backend Manoa will use for SMS. It is the easiest way to use
          the real product before texting approval finishes.
        </p>

        <div className="dashboard-live-prompts">
          {starterPrompts.map((prompt) => (
            <button
              key={prompt}
              className="demo-prompt"
              type="button"
              disabled={pending}
              onClick={() => {
                setInput(prompt)
                void sendText(prompt)
              }}
            >
              {prompt}
            </button>
          ))}
        </div>

        <form
          className="demo-form dashboard-live-form"
          onSubmit={(event) => {
            event.preventDefault()
            void sendText(input)
          }}
          aria-busy={pending}
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            autoComplete="off"
            placeholder="What's on my calendar tomorrow?"
            aria-label="Text Manoa from the dashboard"
            disabled={pending}
          />
          <button className="button" type="submit" disabled={pending}>
            {pending ? 'Sending...' : 'Send'}
          </button>
        </form>

        <label className={`dashboard-photo-upload ${pending || photoPending ? 'is-disabled' : ''}`}>
          <span>{photoPending ? 'Reading photo...' : 'Read photo, screenshot, or flyer'}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={pending || photoPending}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              void sendPhoto(file)
            }}
          />
        </label>

        {error ? (
          <p className="dashboard-live-error" role="status" aria-live="polite">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
