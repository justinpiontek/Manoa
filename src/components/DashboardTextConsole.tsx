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
          <small>Real calendars</small>
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
              <strong>Send a text to Manoa.</strong>
              <p>This uses your real account, calendars, and scheduling logic.</p>
            </div>
          )}
        </div>

        {!messages.length && starterPrompts.length ? (
          <div className="dashboard-live-shortcuts" aria-label="Try one of these">
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
        ) : null}

        <form
          className="demo-form dashboard-live-form dashboard-live-composer"
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
            placeholder="Text Manoa..."
            aria-label="Text Manoa from the dashboard"
            disabled={pending}
          />
          <button className="button" type="submit" disabled={pending}>
            {pending ? 'Sending...' : 'Send'}
          </button>
        </form>

        <label className={`dashboard-photo-upload dashboard-photo-upload-compact ${pending || photoPending ? 'is-disabled' : ''}`}>
          <span>{photoPending ? 'Reading photo...' : 'Add photo or screenshot'}</span>
          <input
            type="file"
            accept="image/*"
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
