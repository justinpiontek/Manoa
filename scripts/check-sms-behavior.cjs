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

const bareNoon = assertScheduleTitle('schedule meeting at 12', 'meeting')
assert.deepEqual(bareNoon.exactTime, { hour: 12, minute: 0 })

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

assertAgendaWindow("what's coming up", 'coming up')

const lookup = parseSmsIntent("When's Oakleys appointment", timeZone)
assert.equal(lookup.type, 'lookup')
assert.equal(lookup.query, 'Oakleys appointment')

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
assert.match(correctionState.messages.at(-1).lines.join('\n'), /\bFri\b/)

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
