'use client'

import { useState } from 'react'

type AppleCalendarConnectFormProps = {
  reconnectAccountId?: string | null
}

export default function AppleCalendarConnectForm({
  reconnectAccountId,
}: AppleCalendarConnectFormProps) {
  const [pending, setPending] = useState(false)

  function handleSubmit() {
    window.setTimeout(() => {
      setPending(true)
    }, 0)
  }

  return (
    <form action="/api/calendar/apple/connect" method="post" className="apple-connect-form" onSubmit={handleSubmit}>
      {reconnectAccountId ? <input type="hidden" name="account_id" value={reconnectAccountId} /> : null}

      <label className="calendar-field">
        <span>iCloud email</span>
        <input
          type="email"
          name="apple_email"
          placeholder="you@icloud.com"
          autoComplete="email"
          required
          disabled={pending}
        />
      </label>

      <label className="calendar-field">
        <span>App-specific password</span>
        <input
          type="password"
          name="app_specific_password"
          placeholder="xxxx-xxxx-xxxx-xxxx"
          autoComplete="off"
          required
          disabled={pending}
        />
      </label>

      <p className="setup-note">
        Use the app-specific password from your Apple Account, not your normal Apple password.
      </p>

      <button className="button dashboard-button" type="submit" disabled={pending}>
        {pending ? 'Connecting Apple Calendar...' : 'Connect Apple Calendar'}
      </button>
    </form>
  )
}
