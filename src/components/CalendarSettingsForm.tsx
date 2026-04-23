'use client'

import { useState } from 'react'

type CalendarSettingsFormProps = {
  profileId: string
  connectionId: string
  sourceName: string
  providerLabel: string
  isPrimary: boolean
  canWrite: boolean
  label: string
  includeInConflicts: boolean
  allowNewEvents: boolean
}

export default function CalendarSettingsForm({
  profileId,
  connectionId,
  sourceName,
  providerLabel,
  isPrimary,
  canWrite,
  label,
  includeInConflicts,
  allowNewEvents,
}: CalendarSettingsFormProps) {
  const [pendingAction, setPendingAction] = useState<'save' | 'remove' | null>(null)

  const isPending = pendingAction !== null
  const typeLabel = isPrimary ? `Primary ${providerLabel}` : providerLabel
  const bookingLabel = canWrite ? (allowNewEvents ? 'Books here' : 'No booking') : 'Read only'

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const submitEvent = event.nativeEvent as SubmitEvent
    const submitter = submitEvent.submitter as HTMLButtonElement | null
    const nextAction = submitter?.value === 'remove' ? 'remove' : 'save'
    window.setTimeout(() => {
      setPendingAction(nextAction)
    }, 0)
  }

  return (
    <form
      action="/api/calendar/google/update"
      method="post"
      className={`calendar-setting-card${isPending ? ' is-pending' : ''}`}
      aria-busy={isPending}
      onSubmit={handleSubmit}
    >
      <input type="hidden" name="profile_id" value={profileId} />
      <input type="hidden" name="connection_id" value={connectionId} />
      <input type="hidden" name="include_in_conflicts" value="false" />
      <input type="hidden" name="allow_new_events" value="false" />

      <details className="calendar-setting-details">
        <summary className="calendar-setting-summary">
          <div className="calendar-setting-title">
            <strong>{sourceName}</strong>
            <span>{typeLabel} calendar • Manoa: {label}</span>
          </div>
          <div className="calendar-setting-status">
            <span className={`calendar-setting-badge${includeInConflicts ? ' is-on' : ''}`}>
              {includeInConflicts ? 'Conflicts' : 'No conflicts'}
            </span>
            <span className={`calendar-setting-badge${allowNewEvents ? ' is-on' : ''}`}>
              {bookingLabel}
            </span>
          </div>
          <span className="calendar-edit-cue">Edit</span>
        </summary>

        <div className="calendar-setting-body">
          <label className="calendar-field">
            <span>Name in Manoa</span>
            <input name="calendar_label" defaultValue={label} disabled={isPending} />
          </label>

          <div className="calendar-toggle-row">
            <label className="calendar-toggle">
              <input
                type="checkbox"
                name="include_in_conflicts"
                value="on"
                defaultChecked={includeInConflicts}
                disabled={isPending}
              />
              <span>Block conflicts</span>
            </label>

            <label className="calendar-toggle">
              <input
                type="checkbox"
                name="allow_new_events"
                value="on"
                defaultChecked={allowNewEvents}
                disabled={!canWrite || isPending}
              />
              <span>{canWrite ? 'New events here' : 'Read only'}</span>
            </label>
          </div>

          <div className="calendar-card-actions">
            <button
              className="nav-link calendar-save-button"
              type="submit"
              disabled={isPending}
              name="intent"
              value="save"
            >
              {pendingAction === 'save' ? 'Saving...' : 'Save'}
            </button>
            <button
              className="nav-link secondary calendar-remove-button"
              type="submit"
              formAction="/api/calendar/remove"
              disabled={isPending}
              name="intent"
              value="remove"
            >
              {pendingAction === 'remove' ? 'Removing...' : 'Remove from Manoa'}
            </button>
          </div>
        </div>
      </details>
    </form>
  )
}
