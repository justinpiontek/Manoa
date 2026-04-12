'use client'

import { useState } from 'react'

type DefaultDurationFormProps = {
  profileId: string
  defaultDurationMinutes: number
}

const durationOptions = [15, 30, 45, 60, 90]

export default function DefaultDurationForm({
  profileId,
  defaultDurationMinutes,
}: DefaultDurationFormProps) {
  const [pending, setPending] = useState(false)

  function handleSubmit() {
    window.setTimeout(() => {
      setPending(true)
    }, 0)
  }

  return (
    <form
      action="/api/profile/default-duration"
      method="post"
      className="duration-form"
      onSubmit={handleSubmit}
      aria-busy={pending}
    >
      <input type="hidden" name="profile_id" value={profileId} />
      <label className="calendar-field">
        <span>Default new-event length</span>
        <select
          name="default_event_duration_minutes"
          defaultValue={String(defaultDurationMinutes)}
          disabled={pending}
        >
          {durationOptions.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} minutes
            </option>
          ))}
        </select>
      </label>
      <button className="nav-link calendar-save-button" type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Save duration'}
      </button>
    </form>
  )
}
