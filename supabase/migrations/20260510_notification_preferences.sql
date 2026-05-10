alter table public.profiles
  add column if not exists morning_agenda_enabled boolean not null default true,
  add column if not exists reminder_texts_enabled boolean not null default true,
  add column if not exists reminder_lead_minutes integer not null default 15;

update public.profiles
set
  morning_agenda_enabled = coalesce(morning_agenda_enabled, true),
  reminder_texts_enabled = coalesce(reminder_texts_enabled, true),
  reminder_lead_minutes = coalesce(reminder_lead_minutes, 15)
where
  morning_agenda_enabled is null
  or reminder_texts_enabled is null
  or reminder_lead_minutes is null;
