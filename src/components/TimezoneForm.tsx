'use client'

import { useEffect, useMemo, useState } from 'react'

type TimezoneFormProps = {
  profileId: string
  currentTimezone: string
}

const commonTimezones = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
]

function timezoneLabel(timezone: string) {
  const city = timezone.split('/').pop()?.replace(/_/g, ' ') || timezone
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(new Date())
    const shortName = parts.find((part) => part.type === 'timeZoneName')?.value
    return shortName ? `${city} (${shortName})` : city
  } catch {
    return timezone
  }
}

export default function TimezoneForm({
  profileId,
  currentTimezone,
}: TimezoneFormProps) {
  const [pending, setPending] = useState(false)
  const [detectedTimezone, setDetectedTimezone] = useState('')
  const [selectedTimezone, setSelectedTimezone] = useState(currentTimezone)

  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (detected) {
      setDetectedTimezone(detected)
    }
  }, [])

  const timezoneOptions = useMemo(() => {
    return [...new Set([currentTimezone, detectedTimezone, ...commonTimezones].filter(Boolean))]
  }, [currentTimezone, detectedTimezone])

  function handleSubmit() {
    window.setTimeout(() => {
      setPending(true)
    }, 0)
  }

  return (
    <form
      action="/api/profile/timezone"
      method="post"
      className="duration-form"
      onSubmit={handleSubmit}
      aria-busy={pending}
    >
      <input type="hidden" name="profile_id" value={profileId} />
      <label className="calendar-field">
        <span>Timezone</span>
        <select
          name="timezone"
          value={selectedTimezone}
          disabled={pending}
          onChange={(event) => setSelectedTimezone(event.target.value)}
        >
          {timezoneOptions.map((timezone) => (
            <option key={timezone} value={timezone}>
              {timezoneLabel(timezone)}
            </option>
          ))}
        </select>
      </label>

      {detectedTimezone && detectedTimezone !== currentTimezone ? (
        <p className="setup-note">
          Browser detected {timezoneLabel(detectedTimezone)}.
          {' '}
          <button
            className="inline-action"
            type="button"
            disabled={pending}
            onClick={() => setSelectedTimezone(detectedTimezone)}
          >
            Use detected timezone
          </button>
        </p>
      ) : (
        <p className="setup-note">Manoa uses this for texted times, reminders, and daily agendas.</p>
      )}

      <button className="nav-link calendar-save-button" type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Save timezone'}
      </button>
    </form>
  )
}
