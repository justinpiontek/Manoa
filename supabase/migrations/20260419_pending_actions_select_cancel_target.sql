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
      'select_cancel_target',
      'invited_reschedule_action',
      'invited_reschedule_hold',
      'invited_cancel_action',
      'external_call_prep',
      'external_cancel_confirm',
      'external_reschedule_confirm',
      'save_business_contact_phone'
    )
  );
