alter table public.profiles
  add column if not exists sms_opted_out_at timestamptz;

alter table public.pending_actions
  drop constraint if exists pending_actions_kind_check;

alter table public.pending_actions
  add constraint pending_actions_kind_check check (
    kind in (
      'schedule',
      'reschedule',
      'select_reschedule_target',
      'invited_reschedule_action',
      'invited_reschedule_hold',
      'invited_cancel_action',
      'external_call_prep',
      'save_business_contact_phone'
    )
  );

alter table public.reminders
  add column if not exists calendar_event_id text,
  add column if not exists calendar_id text,
  add column if not exists event_starts_at timestamptz;
