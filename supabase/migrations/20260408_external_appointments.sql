create table if not exists public.business_contacts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  phone_e164 text not null,
  category text not null default 'business',
  notes text,
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, label)
);

create index if not exists business_contacts_profile_id_idx
  on public.business_contacts (profile_id);

alter table public.pending_actions
  drop constraint if exists pending_actions_kind_check;

alter table public.pending_actions
  add constraint pending_actions_kind_check check (
    kind in (
      'schedule',
      'reschedule',
      'select_reschedule_target',
      'external_call_prep',
      'save_business_contact_phone'
    )
  );
