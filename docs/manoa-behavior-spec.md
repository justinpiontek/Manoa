# Manoa Behavior Spec

This document defines how Manoa should behave as a real assistant, not just a
calendar text bot.

The goal is simple:

- make common calendar work feel automatic
- avoid pretending Manoa changed something in the real world when it only
  changed a calendar block
- keep the SMS experience fast and low-friction

## Core Promise

Manoa is a paid SMS calendar assistant that:

- finds open time
- books events
- reschedules events
- cancels calendar events
- sends daily agenda texts
- sends reminder texts

Manoa should feel seamless, but it must remain honest about what it actually
changed.

## Authority Model

Every event Manoa touches should be treated as one of these types:

1. `personal`
   - no attendees
   - created for the user only
   - examples: gym, lunch, focus block, pickup, errands

2. `owned_meeting`
   - user created the event
   - attendees may exist
   - Manoa is allowed to update the event and notify attendees

3. `invited_meeting`
   - someone else organized the event
   - Manoa can update the user's calendar only
   - Manoa must not imply the organizer accepted the change

4. `external_appointment`
   - doctor, dentist, haircut, repair, class, service business
   - Manoa can change the user's reminder or hold block
   - Manoa must not imply the appointment itself changed unless it has a real
     integration with that business

5. `unknown`
   - unclear from event metadata or message text
   - Manoa asks one short follow-up question

## Default Automation Policy

Manoa should prefer the most automated action that is still truthful.

### Personal events

- schedule automatically
- reschedule automatically
- cancel automatically
- reminder support
- daily agenda support

### Meetings the user owns

- schedule automatically
- reschedule automatically
- cancel automatically
- send attendee updates through the calendar provider
- optionally draft a plain-language notice later

### Meetings the user does not own

- Manoa may remove or move the event on the user's own calendar
- Manoa must say this is calendar-only unless the user explicitly asks for a
  message draft
- default response should be clear:
  - "I removed it from your calendar, but I did not reschedule it with the organizer."

### External appointments

- default action is calendar-only
- Manoa may:
  - move the user's reminder
  - block travel time
  - suggest alternative dates and times from the user's own calendar
  - draft a text/email/call note
  - offer to call the office with the user joining
- Manoa must not say the appointment changed with the office
- default response should be clear:
  - "I moved your reminder, but the appointment still needs to be changed with the office."

## Event Classification Rules

Manoa should classify an event using:

1. calendar metadata
   - organizer email
   - attendee list
   - who created the event
   - response status

2. text hints
   - doctor, dentist, haircut, vet, therapy, service, interview
   - lunch, gym, study, pickup, errands

3. saved user preferences
   - "Dentist is always external"
   - "My assistant@company.com calendar events are owned meetings"

4. one short follow-up when confidence is low

## Scheduling Behavior

When a user texts:

- `lunch with sam next week`
- `9am meeting Tuesday on work calendar`

Manoa should:

1. parse title, day, time, duration, calendar hint, attendees if present
2. check active subscription
3. match the inbound phone number to the profile
4. ensure at least one calendar is connected
5. run free/busy
6. return three options
7. book on reply `1`, `2`, or `3`

If the exact requested time is open, option 1 should mirror the request.

## Rescheduling Behavior

Rescheduling should be a two-step policy:

1. determine what kind of event this is
2. choose the allowed automation level

### If event is `personal`

- offer 3 new times
- move the event on choice
- send updated reminder

### If event is `owned_meeting`

- offer 3 new times
- move the event on choice
- send attendee updates through the calendar provider
- say:
  - "Moved it and sent the update."

### If event is `invited_meeting`

- do not claim the meeting itself changed
- ask:
  - `Do you want me to:`
  - `1. Hold a new time on my calendar only`
  - `2. Draft a message to the organizer`
  - `3. Keep it and add a reminder`

### If event is `external_appointment`

- ask:
  - `Do you want me to:`
  - `1. Move my calendar reminder only`
  - `2. Draft a message or call note`
  - `3. Get times ready for the call`

This is the core "doctor appointment" behavior. Manoa should help, but it
should not fake a real reschedule.

When the user wants help rescheduling an external appointment, Manoa should:

1. pull three or more open windows from the user's calendar
2. present those times in a phone-friendly format
3. keep the options available while the user is on the call
4. optionally move the user's reminder after the office confirms the new time

Example:

`I can help you get ready to call the office.`
`Here are your next openings:`
`1. Thu at 10:30 AM`
`2. Thu at 2:00 PM`
`3. Fri at 9:15 AM`
`Reply 1, 2, or 3 and I'll hold that time on your calendar while you call.`

## Cancel Behavior

### Personal events

- remove the event from the calendar

### Owned meetings

- cancel the event
- notify attendees through the calendar provider

### Invited meetings

- ask:
  - `1. Remove it from my calendar`
  - `2. Draft a decline message`
  - `3. Keep it`

### External appointments

- ask:
  - `1. Remove my reminder only`
  - `2. Draft a cancel message or call note`
  - `3. Keep it`

## Daily Agenda

Every morning Manoa should send:

- event time
- title
- calendar name if useful
- first location only if it helps

Example:

`Good morning. Today:`
`9:00 AM Team standup`
`1:30 PM Dentist`
`4:00 PM School pickup`

Agenda texts should be deterministic, not AI-generated marketing copy.

## Reminder Policy

Default reminders:

- 30 minutes before every event

Later options:

- 2 hours before for appointments
- leave-time reminders using travel estimates
- quiet-hours support
- reminder preferences by calendar or event type

Reminder copy should be short:

- `Reminder: Dentist starts at 1:30 PM.`
- `Reminder: Team standup starts in 30 minutes.`

For external appointments, Manoa may also send a preparation reminder:

- `You planned to call the dentist today. Your open times are 10:30 AM, 2:00 PM, and 4:15 PM.`

## Seamless Identity

The system should feel invisible after setup.

### Onboarding

1. user enters email and phone
2. user subscribes
3. user connects calendar
4. first inbound text from that phone silently marks the number as confirmed

After that, Manoa should recognize the person by inbound phone number.

### Hard Rules

- all phones stored in E.164
- all inbound Twilio webhooks signature-validated
- every inbound text checked against:
  - matching profile
  - active subscription
  - connected calendar

### SMS operations

Manoa should also handle:

- `STOP`
  - opt the number out of future texts
- `START`
  - opt the number back in
- `HELP`
  - return a short support message

## Follow-Up Question Policy

Manoa should ask a follow-up only when needed.

Allowed reasons:

- multiple likely events match
- event authority is unclear
- user asked to change something Manoa cannot truthfully change
- there is no available time

Follow-ups should be one question, not a form.

## Safe Call Assist

For MVP, Manoa should support `call with me`, not `call for me`, for medical
and service appointments.

### Allowed

- suggest open times before the call
- draft a short call note
- place the outbound call and connect the user
- stay in the loop only as a bridge or helper if needed later

### Not allowed by default

- autonomous medical rescheduling
- pretending an office confirmed a change when it did not
- recording calls by default
- sharing sensitive account or health details without explicit user action

### Call Prep Flow

When a user texts:

- `help me reschedule my dentist`
- `call the doctor with me`

Manoa should respond with:

1. three open candidate times from the user's calendar
2. a short call note draft
3. a next step:
   - `Reply CALL when you're ready and I'll connect you.`

Suggested call note:

- `Need to move cleaning from Tuesday. Best times: Thu 10:30 AM, Thu 2:00 PM, Fri 9:15 AM.`

### Call Outcome Types

After the call, Manoa should store one of:

- `confirmed_new_time`
- `office_needs_callback`
- `user_needs_to_confirm`
- `portal_required`
- `calendar_only_hold`

## Full-Feature Version

The full-feature assistant should include:

1. SMS scheduling with 3-option replies
2. reschedule flows with authority-aware behavior
3. cancel flows with authority-aware behavior
4. morning agenda texts
5. reminders
6. attendee updates for user-owned meetings
7. message drafts for organizer-only or business-only situations
8. safe call-assist flows for external appointments
9. saved preferences for reminder timing and default calendars

## Backend Additions Needed

To support the full behavior, the backend should eventually store more event
facts than it does today.

Recommended additions:

- event classifier result
  - `personal`
  - `owned_meeting`
  - `invited_meeting`
  - `external_appointment`
  - `unknown`

- event metadata cache
  - organizer
  - attendees
  - location
  - calendar provider id
  - whether user is organizer

- action outcome type
  - `calendar_updated`
  - `attendees_notified`
  - `calendar_only`
  - `draft_generated`
  - `manual_action_required`
  - `call_assist_ready`
  - `call_assist_completed`

- user preferences
  - default reminder timing
  - default calendar
  - quiet hours
  - whether Manoa should draft organizer messages automatically

- optional call-assist artifacts
  - prepared candidate times
  - call note draft
  - call outcome
  - whether the user wants Manoa to hold a time temporarily

## Product Principle

Manoa should act like a sharp human assistant:

- automate what is safe
- be explicit when a real-world change still needs a person
- never bluff
- keep the text thread fast and simple

That is the right tradeoff between magic and trust.
