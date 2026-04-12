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

  return (
    <form
      action={pendingAction === 'remove' ? '/api/calendar/remove' : '/api/calendar/google/update'}
      method="post"
      className={`calendar-setting-card${isPending ? ' is-pending' : ''}`}
      aria-busy={isPending}
    >
      <input type="hidden" name="profile_id" value={profileId} />
      <input type="hidden" name="connection_id" value={connectionId} />

      <div className="calendar-setting-head">
        <div>
          <strong>{sourceName}</strong>
          <span>{isPrimary ? `Primary ${providerLabel} calendar` : `${providerLabel} calendar`}</span>
        </div>
        {!canWrite ? <span className="calendar-setting-badge">Read only</span> : null}
      </div>

      <label className="calendar-field">
        <span>Name in Manoa</span>
        <input name="calendar_label" defaultValue={label} disabled={isPending} />
      </label>

      <label className="calendar-toggle">
        <input
          type="checkbox"
          name="include_in_conflicts"
          defaultChecked={includeInConflicts}
          disabled={isPending}
        />
        <span>Use this to block conflicting times</span>
      </label>

      <label className="calendar-toggle">
        <input
          type="checkbox"
          name="allow_new_events"
          defaultChecked={allowNewEvents}
          disabled={!canWrite || isPending}
        />
        <span>{canWrite ? 'Let Manoa place new events here' : 'This calendar is read only'}</span>
      </label>

      <div className="calendar-card-actions">
        <button
          className="nav-link calendar-save-button"
          type="submit"
          disabled={isPending}
          onClick={() => setPendingAction('save')}
        >
          {pendingAction === 'save' ? 'Saving...' : 'Save calendar settings'}
        </button>
        <button
          className="nav-link secondary calendar-remove-button"
          type="submit"
          disabled={isPending}
          onClick={() => setPendingAction('remove')}
        >
          {pendingAction === 'remove' ? 'Removing...' : 'Remove from Manoa'}
        </button>
      </div>
    </form>
  )
}
