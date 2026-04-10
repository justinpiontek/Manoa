create table if not exists public.people_contacts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  email text not null,
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, email)
);

create index if not exists people_contacts_profile_id_idx
  on public.people_contacts (profile_id);

alter table public.pending_actions
  drop constraint if exists pending_actions_kind_check;

alter table public.pending_actions
  add constraint pending_actions_kind_check check (
    kind in (
      'schedule',
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
