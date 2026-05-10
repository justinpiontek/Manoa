'use client'

import { useState } from 'react'

type NotificationSettingsFormProps = {
  profileId: string
  morningAgendaEnabled: boolean
  reminderTextsEnabled: boolean
  reminderLeadMinutes: number
}

const reminderLeadOptions = [5, 15, 30, 60]

export default function NotificationSettingsForm({
  profileId,
  morningAgendaEnabled,
  reminderTextsEnabled,
  reminderLeadMinutes,
}: NotificationSettingsFormProps) {
  const [pending, setPending] = useState(false)
  const [remindersOn, setRemindersOn] = useState(reminderTextsEnabled)

  function handleSubmit() {
    window.setTimeout(() => {
      setPending(true)
    }, 0)
  }

  return (
    <form
      action="/api/profile/notifications"
      method="post"
      className="dashboard-notification-form"
      onSubmit={handleSubmit}
      aria-busy={pending}
    >
      <input type="hidden" name="profile_id" value={profileId} />

      <label className="dashboard-toggle-row" htmlFor="morning-agenda-enabled">
        <input
          id="morning-agenda-enabled"
          name="morning_agenda_enabled"
          type="checkbox"
          value="yes"
          defaultChecked={morningAgendaEnabled}
          disabled={pending}
        />
        <span>
          <strong>Morning agenda</strong>
          <small>Send one text around 6:30 AM with today’s schedule.</small>
        </span>
      </label>

      <label className="dashboard-toggle-row" htmlFor="reminder-texts-enabled">
        <input
          id="reminder-texts-enabled"
          name="reminder_texts_enabled"
          type="checkbox"
          value="yes"
          defaultChecked={reminderTextsEnabled}
          disabled={pending}
          onChange={(event) => setRemindersOn(event.target.checked)}
        />
        <span>
          <strong>Reminder texts</strong>
          <small>Text before timed events so nothing sneaks up on you.</small>
        </span>
      </label>

      <label className="calendar-field">
        <span>Reminder timing</span>
        <select
          name="reminder_lead_minutes"
          defaultValue={String(reminderLeadMinutes)}
          disabled={pending || !remindersOn}
        >
          {reminderLeadOptions.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes === 60 ? '1 hour before' : `${minutes} minutes before`}
            </option>
          ))}
        </select>
      </label>

      <p className="setup-note">
        Texting still has to be on for this account before these notifications can send.
      </p>

      <button className="nav-link calendar-save-button" type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Save notifications'}
      </button>
    </form>
  )
}
