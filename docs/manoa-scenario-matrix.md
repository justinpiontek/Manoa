# Manoa Scenario Matrix

This document is the practical "don't miss anything" checklist for Manoa.

It is organized around what real users will actually do, what Manoa should do
in response, and what must work before launch.

## Launch Priorities

### Must work before first beta

- signup, payment, and calendar connection
- schedule a new event by text
- reschedule a personal event
- reschedule a user-owned meeting
- safe handling for external appointments
- cancel a personal event
- morning agenda text
- reminders
- phone-number identity and subscription checks
- clear error messages when Manoa cannot act

### Can wait until later

- Outlook and Apple calendar support
- recurring-series editing
- organizer message drafts
- attendee message drafting outside the calendar provider
- `call with me`
- travel-time reminders
- multilingual support
- advanced preferences and quiet hours

## 1. Onboarding And Access

### 1.1 Signup and payment

- User signs up with email and phone
  - Manoa creates profile and sends to checkout
- User pays successfully
  - subscription becomes active
- User abandons checkout
  - texting should say subscription is not active
- User enters an invalid phone number
  - block signup with clear validation
- User enters the wrong phone number
  - first text from a different number should not attach to the account
- User changes phone number later
  - needs a controlled account update flow

### 1.2 Calendar connection

- User paid but has not connected Google Calendar
  - texting should say to connect calendar first
- User connected Google, then revoked access
  - texting should say calendar needs reconnecting
- User has multiple calendars later
  - Manoa should respect calendar hints like `work` or `personal`

### 1.3 Identity

- User texts from the saved number
  - Manoa should recognize them silently
- User texts from an unknown number
  - Manoa should not reveal account details
- Twilio signature is invalid
  - reject the request
- Subscription is inactive, canceled, or past due
  - do not process scheduling commands

## 2. New Scheduling

### 2.1 Straightforward scheduling

- `schedule lunch tomorrow`
- `9am meeting Tuesday on work calendar`
- `book coffee Friday`
- `add dentist reminder next week`

Expected behavior:

- parse intent, day, time, duration, and calendar
- check availability
- return three choices
- book on `1`, `2`, or `3`

### 2.2 Natural language variations

- typo-heavy texts
- short texts like `tuesday 3pm`
- voice-to-text style texts
- `work email` instead of `work calendar`
- `tmrw`, `tomororw`, `tomororws`
- `afternoon`, `morning`, `after 2`
- duration like `45 min` or `1 hour`

Expected behavior:

- tolerate common shorthand and typos
- if confidence is low, ask one short follow-up

### 2.3 Availability edge cases

- exact requested time is open
  - option 1 should match it
- exact requested time is busy
  - show nearby options
- no open times on that day
  - say so and suggest another day
- another calendar event appears before user replies
  - re-check availability before final booking
- user replies after options expire
  - ask them to send the request again

### 2.4 Booking edge cases

- user replies `2`
- user replies `option 2`
- user sends another scheduling request instead of choosing
- user sends multiple texts quickly
- user replies twice

Expected behavior:

- avoid double-booking
- latest valid request should win
- previous pending options should be superseded cleanly

## 3. Rescheduling

### 3.1 Personal events

- `reschedule lunch`
- `move gym tomorrow`

Expected behavior:

- find the event
- offer new times
- move it
- update reminders

### 3.2 User-owned meetings

- `reschedule client review`
- `move team sync to Thursday`

Expected behavior:

- preserve attendees
- preserve meeting details
- update event through the calendar provider
- send attendee updates through the provider

### 3.3 Invited meetings

- `reschedule board meeting`
- `move my 3pm with Alex`

Expected behavior:

- do not pretend Manoa changed the organizer's meeting
- ask whether to:
  - move it on the user's calendar only
  - draft a message to the organizer
  - leave it alone

### 3.4 External appointments

- `reschedule dentist`
- `move my doctor appointment`
- `change haircut`

Expected behavior:

- do not claim the office accepted a new time
- suggest open times from the user's own calendar
- let the user hold one of those times for the call
- draft a call note
- use a saved office phone number if available
- ask for the number once if missing

### 3.5 Reschedule edge cases

- multiple possible events match
  - ask which one
- target event not found
  - ask for more detail
- target event is in the past
  - explain it cannot be moved
- recurring event
  - ask `just this one or the whole series?`
- event has no clear owner
  - classify or ask one short question

## 4. Canceling

### 4.1 Personal events

- `cancel lunch`

Expected behavior:

- remove it from the calendar

### 4.2 User-owned meetings

- `cancel team standup`

Expected behavior:

- cancel it
- notify attendees through the calendar provider

### 4.3 Invited meetings

- `cancel investor meeting`

Expected behavior:

- do not pretend the meeting is canceled for everyone
- ask whether to:
  - remove it from the user's calendar
  - draft a decline message
  - keep it

### 4.4 External appointments

- `cancel dentist`

Expected behavior:

- do not say the office canceled it
- provide office number if known
- draft a cancel note
- optionally remove only the user's reminder or hold block

## 5. Agenda And Reminders

### 5.1 Morning agenda

- user has several events today
- user has no events today
- user has all-day events
- user is in another timezone

Expected behavior:

- morning text should be short and reliable
- use the user's local timezone
- avoid noisy or overly chatty copy

### 5.2 Reminders

- reminder 30 minutes before event
- event was moved after reminder was queued
- event was canceled after reminder was queued
- duplicate reminder job runs
- event is all-day

Expected behavior:

- do not send stale reminders
- dedupe reminders
- skip canceled events
- handle moved events correctly

### 5.3 Prep reminders for external appointments

- user held time to call dentist
- office number is known
- office number is missing

Expected behavior:

- reminder can say:
  - `You planned to call the dentist today. Your open times are ...`

## 6. External Appointment Memory

### 6.1 Saving business numbers

- phone number found in event description
- phone number found in location
- user texts the office number manually
- user says `skip`

Expected behavior:

- save it once
- associate it with the office label
- reuse it next time

### 6.2 Alias matching

- `dentist`
- `Dr. Patel`
- `Patel dental`
- `Patel Family Dentistry`

Expected behavior:

- these should all be mappable to the same saved contact when possible

### 6.3 Bad saved data

- saved number is outdated
- user wants to replace the number
- office has multiple locations

Expected behavior:

- support overwrite/update later
- do not keep using obviously wrong data forever

## 7. Calendar Authority

Manoa must classify what it is allowed to change.

### Event types to recognize

- personal event
- owned meeting
- invited meeting
- external appointment
- unknown

### Signals to use

- organizer email
- attendee count
- event description
- location
- saved office contacts
- user text clues

### Failure mode to avoid

- changing a calendar event and wording the reply like the real-world
  appointment changed

## 8. Texting UX

### 8.1 Good conversational behavior

- ask one follow-up, not five
- reply with exact actions taken
- say what changed and what did not
- keep messages short

### 8.2 Important reply types

- `1`, `2`, `3`
- `option 1`
- `yes`
- `no`
- `skip`
- `call`
- `stop`
- `help`

### 8.3 Compliance and operational texts

- `STOP`
  - opt out
- `START`
  - opt back in
- `HELP`
  - basic support response

These matter for real SMS operations even if the product logic is separate.

## 9. Reliability And Failure Cases

### 9.1 Google Calendar

- token expired
- token revoked
- free/busy API fails
- event insert fails
- event patch fails
- duplicate webhook or retry behavior later

Expected behavior:

- return a calm error message
- do not claim the event was changed if it failed

### 9.2 Twilio

- inbound webhook retried
- outbound SMS fails
- malformed webhook payload
- unrecognized sending number

Expected behavior:

- idempotent processing where possible
- message logging
- do not duplicate bookings from retries

### 9.3 Stripe

- webhook delayed
- webhook duplicated
- checkout completed but subscription status not synced yet

Expected behavior:

- avoid locking out a real paid user longer than necessary
- keep subscription state consistent

### 9.4 Cron jobs

- morning agenda job runs twice
- reminder job runs late
- reminder job misses a window

Expected behavior:

- dedupe
- send late only if still useful
- never spam

## 10. Time And Date Edge Cases

- daylight saving changes
- user travels to another timezone
- event created in one timezone and viewed in another
- `next Tuesday` near midnight
- `tomorrow` after 11:30 PM
- all-day events
- recurring weekly events

Expected behavior:

- everything should resolve in the user's effective timezone
- texts should use readable local times

## 11. Scenarios That Need A Clear Product Answer Before Wider Launch

- recurring series editing: one event or all?
- invited meetings: calendar-only by default or ask every time?
- should owned meetings always notify attendees automatically?
- should external appointment holds expire if the user never calls?
- should Manoa ever place the office call automatically?
- should Manoa support two-way contact memory edits by text?

## 12. Suggested Beta Test Script

Before opening Manoa to real users, test at least these flows:

1. signup -> pay -> connect Google Calendar -> text from saved phone
2. schedule a new event from a vague text
3. schedule a specific time request
4. reschedule a personal event
5. reschedule an owned meeting
6. reschedule an invited meeting
7. reschedule a dentist appointment
8. save an office number by SMS
9. cancel a personal event
10. cancel an external appointment safely
11. receive a morning agenda
12. receive a reminder after moving an event
13. text from an unknown phone number
14. text with an inactive subscription
15. reconnect after Google access is revoked

## Product Principle

If there is any doubt, Manoa should do the honest version:

- automate what is clearly safe
- prepare the user for what still needs a human
- never bluff
- never pretend a real-world appointment changed unless it truly changed
