const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

require.extensions['.ts'] = function loadTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  })
  module._compile(output.outputText, filename)
}

const { dateTimePartsInTimeZone, startOfDay } = require('../src/lib/calendar/dates.ts')
const { recurrenceRule, recurrenceSummary } = require('../src/lib/calendar/recurrence.ts')
const { scheduleCandidateTimesForTitle } = require('../src/lib/calendar/schedulingPreferences.ts')
const { applyDemoText, createDemoState } = require('../src/lib/demoSms.ts')
const { classifyEventAuthority } = require('../src/lib/eventAuthority.ts')
const {
  calendarImagePayloadToSmsText,
  calendarImagePayloadToSmsTexts,
} = require('../src/lib/sms/calendarImage.ts')
const {
  isInviteeEmailFollowUp,
  parseExistingEventInviteRequest,
  parseInviteesFromText,
  resolveInviteeFollowUp,
} = require('../src/lib/sms/invitees.ts')
const { parseSmsIntent } = require('../src/lib/sms/parser.ts')

const timeZone = 'America/Chicago'

function parts(date) {
  return dateTimePartsInTimeZone(date, timeZone)
}

function assertScheduleWindow(text, label) {
  const intent = parseSmsIntent(text, timeZone)
  assert.equal(intent.type, 'schedule', text)
  assert.equal(intent.dateWindow?.label, label, text)
  return intent
}

function assertAgendaWindow(text, label) {
  const intent = parseSmsIntent(text, timeZone)
  assert.equal(intent.type, 'agenda', text)
  assert.equal(intent.label || intent.dateWindow?.label, label, text)
  return intent
}

function assertScheduleTitle(text, expectedTitle) {
  const intent = parseSmsIntent(text, timeZone)
  assert.equal(intent.type, 'schedule', text)
  assert.equal(intent.title, expectedTitle, text)
  return intent
}

function assertInviteParse(text, expectedCleanedText, expectedNames) {
  const parsed = parseInviteesFromText(text)
  assert.equal(parsed.cleanedText, expectedCleanedText, text)
  assert.deepEqual(parsed.names, expectedNames, text)
  return parsed
}

const thisWeek = assertScheduleWindow('schedule haircut sometime this week', 'this week')
assert.equal(parts(thisWeek.dateWindow.start).day, parts(startOfDay(0, timeZone)).day)

const nextWeek = assertScheduleWindow('schedule meeting early next week', 'next week')
assert.equal(parts(nextWeek.dateWindow.start).weekday, 1)
assert.equal(nextWeek.title, 'meeting')

const may = assertScheduleWindow('I need a dentist appointment in May sometime', 'May')
assert.equal(parts(may.dateWindow.start).month, 5)
assert.equal(parts(may.dateWindow.end).month, 5)

const midMay = assertScheduleWindow('schedule dentist mid May', 'mid May')
assert.equal(midMay.title, 'dentist')
assert.equal(parts(midMay.dateWindow.start).month, 5)

const endOfMonth = assertScheduleWindow('schedule call end of month', 'end of the month')
assert.equal(endOfMonth.title, 'call')

const nextWeekThursday = parseSmsIntent('need a dentist appointment next week Thur', timeZone)
assert.equal(nextWeekThursday.type, 'schedule')
assert.equal(parts(nextWeekThursday.dateWindow.start).weekday, 4)

const tomorrowAfternoon = assertScheduleWindow('lunch tomorrow afternoon', 'tomorrow')
assert.deepEqual(tomorrowAfternoon.exactTime, { hour: 14, minute: 0 })

const tonight = assertScheduleWindow('meeting tonight', 'today')
assert.deepEqual(tonight.exactTime, { hour: 18, minute: 0 })

const bareAfternoonHour = assertScheduleTitle('meeting tomorrow at 2', 'meeting')
assert.deepEqual(bareAfternoonHour.exactTime, { hour: 14, minute: 0 })

const bareMorningHour = assertScheduleTitle('schedule meeting at 9', 'meeting')
assert.deepEqual(bareMorningHour.exactTime, { hour: 9, minute: 0 })

const bareEveningSix = assertScheduleTitle('schedule meeting at 6', 'meeting')
assert.deepEqual(bareEveningSix.exactTime, { hour: 18, minute: 0 })

const bareEveningSeven = assertScheduleTitle('schedule meeting at 7', 'meeting')
assert.deepEqual(bareEveningSeven.exactTime, { hour: 19, minute: 0 })

const bareEveningEight = assertScheduleTitle('schedule meeting at 8', 'meeting')
assert.deepEqual(bareEveningEight.exactTime, { hour: 20, minute: 0 })

const bareMorningTen = assertScheduleTitle('schedule meeting at 10', 'meeting')
assert.deepEqual(bareMorningTen.exactTime, { hour: 10, minute: 0 })

const bareMorningEleven = assertScheduleTitle('schedule meeting at 11', 'meeting')
assert.deepEqual(bareMorningEleven.exactTime, { hour: 11, minute: 0 })

const bareNoon = assertScheduleTitle('schedule meeting at 12', 'meeting')
assert.deepEqual(bareNoon.exactTime, { hour: 12, minute: 0 })

const changeThatTo515 = parseSmsIntent('change that to 5:15', timeZone)
assert.equal(changeThatTo515.type, 'reschedule')
assert.deepEqual(changeThatTo515.exactTime, { hour: 17, minute: 15 })
assert.equal(changeThatTo515.query, 'that')

const moveItTo515 = parseSmsIntent('move it to 5:15', timeZone)
assert.equal(moveItTo515.type, 'reschedule')
assert.deepEqual(moveItTo515.exactTime, { hour: 17, minute: 15 })
assert.equal(moveItTo515.query, 'it')

const rawTimeOnly = parseSmsIntent('5:15', timeZone)
assert.equal(rawTimeOnly.type, 'unknown')

const thisWednesdayDinner = assertScheduleTitle(
  'this Wednesday, Salmon/Haddock for dinner',
  'salmon/haddock for dinner',
)
assert.equal(parts(thisWednesdayDinner.dateWindow.start).weekday, 3)

const oneHourMeeting = assertScheduleTitle('schedule 1 hour meeting', 'meeting')
assert.equal(oneHourMeeting.durationMinutes, 60)

const quickCall = assertScheduleTitle('schedule quick 15 min call', 'quick call')
assert.equal(quickCall.durationMinutes, 15)

assert.deepEqual(scheduleCandidateTimesForTitle('lunch').slice(0, 3), [
  { hour: 11, minute: 0 },
  { hour: 12, minute: 0 },
  { hour: 13, minute: 0 },
])

const locationEvent = assertScheduleTitle('Schedule Mokums 3rd bday may 17 10am at Mary’s house', 'mokums 3rd bday')
assert.equal(locationEvent.location, 'Mary’s house')
assert.deepEqual(locationEvent.exactTime, { hour: 10, minute: 0 })

assertScheduleTitle('already scheduled dentist May 17 at 10:30', 'dentist')

assert.equal(
  calendarImagePayloadToSmsText({
    has_calendar_items: true,
    confidence: 'high',
    notes: null,
    items: [
      {
        is_confirmed_or_fixed: true,
        title: 'Wellness Coaching',
        date_ymd: '2026-05-04',
        time_24h: '11:00',
        duration_minutes: 30,
        location: 'Microsoft Teams meeting',
        organizer_or_source: 'Amy L. Sheedy',
        item_type: 'meeting',
        confidence: 'high',
        notes: null,
      },
    ],
  }),
  'add Wellness Coaching on 5/4/2026 at 11:00am at Microsoft Teams meeting for 30 minutes',
)

const nextMondayAgenda = parseSmsIntent("what's next Mondays agenda", timeZone)
assert.equal(nextMondayAgenda.type, 'agenda')
assert.equal(parts(nextMondayAgenda.dateWindow.start).weekday, 1)

const mondayEveningUtcStart = '2026-04-21T00:00:00.000Z'
assert.equal(
  recurrenceSummary({ unit: 'week', interval: 1 }, mondayEveningUtcStart, timeZone),
  'Repeats every Monday.',
)
assert.equal(
  recurrenceRule({ unit: 'week', interval: 1 }, mondayEveningUtcStart, timeZone),
  'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
)
assert.equal(
  recurrenceRule({ unit: 'week', interval: 1, weekday: 2 }, mondayEveningUtcStart, timeZone),
  'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
)
assert.equal(
  recurrenceRule({ unit: 'month', interval: 1, mode: 'nth_weekday', weekday: 3 }, mondayEveningUtcStart, timeZone),
  'RRULE:FREQ=MONTHLY;INTERVAL=1;BYDAY=WE;BYSETPOS=3',
)

assertAgendaWindow("what's coming up", 'coming up')

const lookup = parseSmsIntent("When's Oakleys appointment", timeZone)
assert.equal(lookup.type, 'lookup')
assert.equal(lookup.query, 'Oakleys appointment')
assert.equal(lookup.mode, 'when')

const whereLookup = parseSmsIntent("Where is Oakleys appointment", timeZone)
assert.equal(whereLookup.type, 'lookup')
assert.equal(whereLookup.query, 'Oakleys appointment')
assert.equal(whereLookup.mode, 'where')

const staceyInvite = assertInviteParse('meeting with Stacey tomorrow at 2', 'meeting tomorrow at 2', ['Stacey'])
assert.equal(staceyInvite.directInvitees.length, 0)
const staceyInviteSchedule = parseSmsIntent(staceyInvite.cleanedText, timeZone)
assert.equal(staceyInviteSchedule.type, 'schedule')
assert.deepEqual(staceyInviteSchedule.exactTime, { hour: 14, minute: 0 })

assertInviteParse('call with Mike Friday', 'call Friday', ['Mike'])
assertInviteParse('lunch with Sarah next week', 'lunch next week', ['Sarah'])
assertInviteParse('meeting with Alex in May', 'meeting in May', ['Alex'])
assertInviteParse('invite Priya to meeting Tuesday', 'meeting Tuesday', ['Priya'])

const directInvite = parseInviteesFromText('meeting with Stacey stacey@example.com tomorrow')
assert.equal(directInvite.cleanedText, 'meeting tomorrow')
assert.deepEqual(directInvite.names, [])
assert.deepEqual(directInvite.directInvitees, [{ displayName: 'Stacey', email: 'stacey@example.com' }])

const inviteFollowUp = resolveInviteeFollowUp('Stacey stacey@example.com', ['Stacey'])
assert.deepEqual(inviteFollowUp.resolved, [{ displayName: 'Stacey', email: 'stacey@example.com' }])
assert.deepEqual(inviteFollowUp.unresolvedNames, [])

const bareInviteFollowUp = resolveInviteeFollowUp('sw312@mac.com', ['Stacey'])
assert.deepEqual(bareInviteFollowUp.resolved, [{ displayName: 'Stacey', email: 'sw312@mac.com' }])
assert.deepEqual(bareInviteFollowUp.unresolvedNames, [])

const combinedChoiceInviteFollowUp = resolveInviteeFollowUp('2, email is sw312@mac.com', ['Stacey'])
assert.deepEqual(combinedChoiceInviteFollowUp.resolved, [
  { displayName: 'Stacey', email: 'sw312@mac.com' },
])
assert.deepEqual(combinedChoiceInviteFollowUp.unresolvedNames, [])

const yesInviteFollowUp = resolveInviteeFollowUp('yes, justin@metongamedia.com', ['Justin'])
assert.deepEqual(yesInviteFollowUp.resolved, [
  { displayName: 'Justin', email: 'justin@metongamedia.com' },
])
assert.deepEqual(yesInviteFollowUp.unresolvedNames, [])
assert.equal(isInviteeEmailFollowUp('yes, justin@metongamedia.com', ['Justin']), true)
assert.equal(isInviteeEmailFollowUp('justin@metongamedia.com', ['Justin']), true)
assert.equal(isInviteeEmailFollowUp('no, justin@metongamedia.com', ['Justin']), false)

assert.deepEqual(parseExistingEventInviteRequest('invite Stacey to dinner Monday'), {
  eventQuery: 'dinner Monday',
  names: ['Stacey'],
  directInvitees: [],
})
assert.deepEqual(parseExistingEventInviteRequest('add Sam sam@example.com to team meeting'), {
  eventQuery: 'team meeting',
  names: [],
  directInvitees: [{ displayName: 'Sam', email: 'sam@example.com' }],
})
assert.deepEqual(parseExistingEventInviteRequest('add Stacey to the event'), {
  eventQuery: 'that',
  names: ['Stacey'],
  directInvitees: [],
})
assert.deepEqual(parseExistingEventInviteRequest('Can you add Stacey to it?'), {
  eventQuery: 'that',
  names: ['Stacey'],
  directInvitees: [],
})

let rescheduleDemoState = createDemoState()
rescheduleDemoState = applyDemoText(rescheduleDemoState, 'reschedule school pickup')
rescheduleDemoState = applyDemoText(rescheduleDemoState, 'move it to 5:15')
assert.equal(rescheduleDemoState.messages.at(-1)?.role, 'manoa')
assert.equal(rescheduleDemoState.messages.at(-1)?.lines[0], 'I can move School pickup to one of these:')
assert.ok(rescheduleDemoState.messages.at(-1)?.lines.some((line) => /5:15 PM/.test(line)))

const authorityBaseEvent = {
  id: 'event',
  title: 'Planning meeting',
  start: startOfDay(1, timeZone).toISOString(),
  end: startOfDay(1, timeZone).toISOString(),
  provider: 'google',
  calendarId: 'primary',
  calendarName: 'Work',
  timeLabel: '9:00 AM',
  location: '',
  description: '',
  organizerEmail: '',
  attendeeCount: 0,
}
assert.equal(classifyEventAuthority({ event: authorityBaseEvent, profileEmail: 'me@example.com' }), 'personal')
assert.equal(
  classifyEventAuthority({
    event: { ...authorityBaseEvent, attendeeCount: 2, organizerEmail: 'me@example.com' },
    profileEmail: 'me@example.com',
  }),
  'owned_meeting',
)
assert.equal(
  classifyEventAuthority({
    event: {
      ...authorityBaseEvent,
      provider: 'apple',
      attendeeCount: 2,
      organizerEmail: 'icloud@example.com',
      ownerEmail: 'icloud@example.com',
    },
    profileEmail: 'login@example.com',
  }),
  'owned_meeting',
)
assert.equal(
  classifyEventAuthority({
    event: { ...authorityBaseEvent, attendeeCount: 2, organizerEmail: 'stacey@example.com' },
    profileEmail: 'me@example.com',
  }),
  'invited_meeting',
)
assert.equal(
  classifyEventAuthority({
    event: { ...authorityBaseEvent, title: 'Dentist appointment' },
    profileEmail: 'me@example.com',
  }),
  'external_appointment',
)

assert.equal(
  calendarImagePayloadToSmsText({
    has_calendar_items: true,
    items: [{
      is_confirmed_or_fixed: true,
      title: 'Dentist appointment',
      date_ymd: '2026-05-17',
      time_24h: '10:30',
      duration_minutes: 45,
      location: 'Northwoods Dental',
      organizer_or_source: 'Northwoods Dental',
      item_type: 'appointment',
      confidence: 'high',
      notes: null,
    }],
    confidence: 'high',
    notes: null,
  }),
  'add Dentist appointment on 5/17/2026 at 10:30am at Northwoods Dental for 45 minutes',
)

assert.equal(
  calendarImagePayloadToSmsText({
    has_calendar_items: true,
    items: [{
      is_confirmed_or_fixed: true,
      title: 'Mokums birthday party',
      date_ymd: '2026-05-16',
      time_24h: '13:00',
      duration_minutes: null,
      location: 'Mary’s house',
      organizer_or_source: 'Mary',
      item_type: 'party',
      confidence: 'high',
      notes: null,
    }],
    confidence: 'high',
    notes: null,
  }),
  'add Mokums birthday party on 5/16/2026 at 1:00pm at Mary’s house',
)

assert.equal(
  calendarImagePayloadToSmsText({
    has_calendar_items: true,
    items: [{
      is_confirmed_or_fixed: false,
      title: 'Lunch with Stacey',
      date_ymd: '2026-04-22',
      time_24h: '12:00',
      duration_minutes: null,
      location: 'Rhinelander',
      organizer_or_source: 'Stacey',
      item_type: 'meeting',
      confidence: 'medium',
      notes: null,
    }],
    confidence: 'medium',
    notes: null,
  }),
  'schedule Lunch with Stacey on 4/22/2026 at 12:00pm at Rhinelander',
)

assert.deepEqual(
  calendarImagePayloadToSmsTexts({
    has_calendar_items: true,
    items: [
      {
        is_confirmed_or_fixed: true,
        title: 'Soccer practice',
        date_ymd: '2026-04-23',
        time_24h: '18:00',
        duration_minutes: 60,
        location: 'Field 2',
        organizer_or_source: null,
        item_type: 'sports',
        confidence: 'high',
        notes: null,
      },
      {
        is_confirmed_or_fixed: true,
        title: 'School concert',
        date_ymd: '2026-04-24',
        time_24h: '19:00',
        duration_minutes: null,
        location: 'Auditorium',
        organizer_or_source: null,
        item_type: 'school',
        confidence: 'high',
        notes: null,
      },
    ],
    confidence: 'high',
    notes: null,
  }),
  [
    'add Soccer practice on 4/23/2026 at 6:00pm at Field 2 for 60 minutes',
    'add School concert on 4/24/2026 at 7:00pm at Auditorium',
  ],
)

let demoState = createDemoState()
demoState = applyDemoText(demoState, 'schedule haircut this week sometime')
assert.equal(demoState.pendingAction?.kind, 'external_call_prep')
demoState = applyDemoText(demoState, '1')
assert.ok(demoState.events.some((event) => /\(pending\)$/i.test(event.title)))
demoState = applyDemoText(demoState, 'confirmed')
assert.match(demoState.messages.at(-1).lines.join('\n'), /marked .*haircut.* as confirmed/i)
assert.ok(!demoState.events.some((event) => /haircut.*\(pending\)$/i.test(event.title)))

let agendaDemoState = createDemoState()
agendaDemoState = applyDemoText(agendaDemoState, 'whats tomorrow')
assert.match(agendaDemoState.messages.at(-1).lines.join('\n'), /Tomorrow's schedule:/)
agendaDemoState = applyDemoText(agendaDemoState, 'whats happening toda')
assert.match(agendaDemoState.messages.at(-1).lines.join('\n'), /Today:/)

let lunchDemoState = createDemoState()
lunchDemoState = applyDemoText(lunchDemoState, 'schedule lunch tomorrow on Work')
assert.equal(lunchDemoState.pendingAction?.kind, 'schedule')
assert.deepEqual(
  lunchDemoState.pendingAction.options.map((option) => option.timeLabel),
  ['11:00 AM', '12:00 PM', '1:00 PM'],
)

let correctionState = createDemoState()
correctionState = applyDemoText(correctionState, 'schedule meeting tomorrow')
assert.equal(correctionState.pendingAction?.kind, 'schedule')
correctionState = applyDemoText(correctionState, 'actually I meant Friday')
assert.equal(correctionState.pendingAction?.kind, 'schedule')
assert.match(correctionState.messages.at(-1).lines.join('\n'), /\b(?:Fri|Tomorrow)\b/)

let freshCorrectionState = createDemoState()
freshCorrectionState = applyDemoText(freshCorrectionState, 'schedule meeting tomorrow')
assert.equal(freshCorrectionState.pendingAction?.kind, 'schedule')
freshCorrectionState = applyDemoText(freshCorrectionState, 'actually schedule lunch tomorrow')
assert.equal(freshCorrectionState.pendingAction?.kind, 'schedule')
assert.ok(freshCorrectionState.pendingAction.options.every((option) => option.title === 'Lunch'))
assert.doesNotMatch(freshCorrectionState.messages.at(-1).lines.join('\n'), /\bMeeting\b/)

let sameRequestCorrectionState = createDemoState()
sameRequestCorrectionState = applyDemoText(sameRequestCorrectionState, 'schedule meeting tomorrow')
assert.equal(sameRequestCorrectionState.pendingAction?.kind, 'schedule')
sameRequestCorrectionState = applyDemoText(sameRequestCorrectionState, 'actually do it for wednesday')
assert.equal(sameRequestCorrectionState.pendingAction?.kind, 'schedule')
assert.ok(sameRequestCorrectionState.pendingAction.options.every((option) => option.title === 'Meeting'))
assert.match(sameRequestCorrectionState.messages.at(-1).lines.join('\n'), /\bWed\b/)
assert.doesNotMatch(sameRequestCorrectionState.messages.at(-1).lines.join('\n'), /\bIt For\b|\bMeeting For\b/)

let cancelCorrectionState = createDemoState()
cancelCorrectionState = applyDemoText(cancelCorrectionState, 'schedule meeting tomorrow')
cancelCorrectionState = applyDemoText(cancelCorrectionState, 'actually cancel that')
assert.equal(cancelCorrectionState.pendingAction, null)
assert.match(cancelCorrectionState.messages.at(-1).lines.join('\n'), /dropped that request/i)

let cancelJustBookedState = createDemoState()
cancelJustBookedState = applyDemoText(cancelJustBookedState, '4pm meeting tomorrow on Work')
cancelJustBookedState = applyDemoText(cancelJustBookedState, 'yes')
assert.equal(cancelJustBookedState.pendingAction?.kind, 'recent_created_event')
const justBookedEventId = cancelJustBookedState.pendingAction.eventId
cancelJustBookedState = applyDemoText(cancelJustBookedState, 'actually cancel that')
assert.equal(cancelJustBookedState.pendingAction, null)
assert.match(cancelJustBookedState.messages.at(-1).lines.join('\n'), /canceled meeting/i)
assert.ok(!cancelJustBookedState.events.some((event) => event.id === justBookedEventId))

let scheduleAfterBookedState = createDemoState()
scheduleAfterBookedState = applyDemoText(scheduleAfterBookedState, '4pm meeting tomorrow on Work')
scheduleAfterBookedState = applyDemoText(scheduleAfterBookedState, 'yes')
scheduleAfterBookedState = applyDemoText(scheduleAfterBookedState, 'this Wednesday, Salmon/Haddock for dinner')
assert.ok(!/already booked/i.test(scheduleAfterBookedState.messages.at(-1).lines.join('\n')))
assert.equal(
  scheduleAfterBookedState.pendingAction?.options?.[0]?.title.toLowerCase(),
  'salmon/haddock for dinner',
)

let nextWeekCorrectionState = createDemoState()
nextWeekCorrectionState = applyDemoText(nextWeekCorrectionState, 'schedule meeting tomorrow')
nextWeekCorrectionState = applyDemoText(nextWeekCorrectionState, 'never mind schedule next week')
assert.equal(nextWeekCorrectionState.pendingAction?.kind, 'schedule')
assert.match(nextWeekCorrectionState.messages.at(-1).lines.join('\n'), /\b(Mon|Tomorrow)\b/)

let lookupState = createDemoState()
lookupState.events.push({
  id: 'oakley',
  title: "Oakley's appointment",
  calendar: 'Family',
  start: startOfDay(4, timeZone).toISOString(),
  kind: 'owned',
})
lookupState = applyDemoText(lookupState, "When's Oakleys appointment")
assert.match(lookupState.messages.at(-1).lines.join('\n'), /Oakley's appointment is/i)

let punctuationCancelState = createDemoState()
punctuationCancelState.events.push({
  id: 'mortgage',
  title: 'Mortgage due ($1,400)',
  calendar: 'Home',
  start: startOfDay(5, timeZone).toISOString(),
  kind: 'owned',
})
punctuationCancelState = applyDemoText(punctuationCancelState, 'Cancel mortgage due ($1,400)')
assert.match(punctuationCancelState.messages.at(-1).lines.join('\n'), /Canceled Mortgage due/i)
assert.ok(!punctuationCancelState.events.some((event) => event.id === 'mortgage'))

console.log('SMS behavior checks passed.')
