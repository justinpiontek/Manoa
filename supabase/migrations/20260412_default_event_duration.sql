alter table public.profiles
  add column if not exists default_event_duration_minutes integer not null default 30;

update public.profiles
set default_event_duration_minutes = 30
where default_event_duration_minutes is null;
