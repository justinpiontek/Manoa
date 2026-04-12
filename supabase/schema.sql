create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  phone_e164 text not null unique,
  timezone text not null default 'America/Chicago',
  default_event_duration_minutes integer not null default 30,
  phone_confirmed_at timestamptz,
  sms_opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_email_idx on public.profiles (lower(email));

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  status text not null,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_profile_id_idx on public.subscriptions (profile_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);

create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  account_id text not null default 'primary',
  account_email text,
  calendar_id text not null default 'primary',
  calendar_name text not null default 'Google Calendar',
  calendar_label text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  access_role text not null default 'owner',
  is_primary boolean not null default false,
  include_in_conflicts boolean not null default true,
  allow_new_events boolean not null default true,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, provider, calendar_id)
);

create index if not exists calendar_connections_profile_id_idx on public.calendar_connections (profile_id);

create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  twilio_message_sid text,
  from_e164 text not null,
  body text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  created_at timestamptz not null default now()
);

create index if not exists sms_messages_profile_id_idx on public.sms_messages (profile_id);
create index if not exists sms_messages_from_e164_idx on public.sms_messages (from_e164);

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

create table if not exists public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  sms_from text not null,
  kind text not null check (
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
  ),
  payload jsonb not null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pending_actions_lookup_idx
  on public.pending_actions (profile_id, sms_from, status, expires_at desc);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  phone_e164 text not null,
  calendar_event_id text,
  calendar_id text,
  event_starts_at timestamptz,
  due_at timestamptz not null,
  body text not null,
  status text not null default 'pending',
  twilio_message_sid text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reminders_due_idx on public.reminders (status, due_at);
