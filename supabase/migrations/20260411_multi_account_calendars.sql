alter table public.calendar_connections
  add column if not exists account_id text not null default 'primary',
  add column if not exists account_email text,
  add column if not exists calendar_name text not null default 'Google Calendar',
  add column if not exists calendar_label text,
  add column if not exists access_role text not null default 'owner',
  add column if not exists is_primary boolean not null default false,
  add column if not exists include_in_conflicts boolean not null default true,
  add column if not exists allow_new_events boolean not null default true;

update public.calendar_connections
set
  account_id = coalesce(nullif(account_id, ''), calendar_id),
  account_email = coalesce(account_email, nullif(calendar_id, 'primary')),
  calendar_name = coalesce(nullif(calendar_name, ''), 'Google Calendar'),
  calendar_label = coalesce(calendar_label, calendar_name),
  access_role = coalesce(nullif(access_role, ''), 'owner'),
  is_primary = coalesce(is_primary, calendar_id = 'primary'),
  include_in_conflicts = coalesce(include_in_conflicts, true),
  allow_new_events = coalesce(allow_new_events, true)
where provider = 'google';

alter table public.pending_actions
  drop constraint if exists pending_actions_kind_check;

alter table public.pending_actions
  add constraint pending_actions_kind_check check (
    kind in (
      'schedule',
      'choose_calendar',
      'resolve_invitees',
      'reschedule',
      'select_reschedule_target',
      'invited_reschedule_action',
      'invited_reschedule_hold',
      'invited_cancel_action',
      'external_call_prep',
      'external_cancel_confirm',
      'external_reschedule_confirm',
      'save_business_contact_phone'
    )
  );
