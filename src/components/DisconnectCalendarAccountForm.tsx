'use client'

import { useState } from 'react'

type DisconnectCalendarAccountFormProps = {
  profileId: string
  provider: 'google' | 'outlook' | 'apple'
  accountId: string
}

export default function DisconnectCalendarAccountForm({
  profileId,
  provider,
  accountId,
}: DisconnectCalendarAccountFormProps) {
  const [pending, setPending] = useState(false)

  function handleSubmit() {
    window.setTimeout(() => {
      setPending(true)
    }, 0)
  }

  return (
    <form action="/api/calendar/disconnect" method="post" onSubmit={handleSubmit}>
      <input type="hidden" name="profile_id" value={profileId} />
      <input type="hidden" name="provider" value={provider} />
      <input type="hidden" name="account_id" value={accountId} />
      <button className="nav-link secondary" type="submit" disabled={pending}>
        {pending ? 'Disconnecting...' : 'Disconnect'}
      </button>
    </form>
  )
}
