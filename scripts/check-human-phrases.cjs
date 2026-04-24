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

const { dateTimePartsInTimeZone } = require('../src/lib/calendar/dates.ts')
const { scheduleCandidateTimesForTitle } = require('../src/lib/calendar/schedulingPreferences.ts')
const {
  parseExistingEventInviteRequest,
  parseInviteesFromText,
  resolveInviteeFollowUp,
} = require('../src/lib/sms/invitees.ts')
const { parseSmsIntent } = require('../src/lib/sms/parser.ts')
const { resolvePendingChoice } = require('../src/lib/sms/pendingChoice.ts')

const timeZone = 'America/Chicago'

function intent(text) {
  return parseSmsIntent(text, timeZone)
}

function assertType(text, expectedType) {
  assert.equal(intent(text).type, expectedType, text)
}

function assertTypes(phrases, expectedType) {
  for (const phrase of phrases) {
    assertType(phrase, expectedType)
  }
}

function assertSchedule(phrase, options = {}) {
  const parsed = intent(phrase)
  assert.equal(parsed.type, 'schedule', phrase)

  if (options.title) assert.equal(parsed.title, options.title, phrase)
  if (options.calendarHint) assert.equal(parsed.calendarHint, options.calendarHint, phrase)
  if (options.windowLabel) assert.equal(parsed.dateWindow?.label, options.windowLabel, phrase)
  if (options.hour !== undefined) assert.equal(parsed.exactTime?.hour, options.hour, phrase)
  if (options.minute !== undefined) assert.equal(parsed.exactTime?.minute, options.minute, phrase)
  if (options.durationMinutes !== undefined) assert.equal(parsed.durationMinutes, options.durationMinutes, phrase)
  if (options.location) assert.equal(parsed.location, options.location, phrase)
  if (options.weekday !== undefined) {
    assert.equal(dateTimePartsInTimeZone(parsed.dateWindow?.start || parsed.baseDate, timeZone).weekday, options.weekday, phrase)
  }
}

function assertAgenda(phrase, options = {}) {
  const parsed = intent(phrase)
  assert.equal(parsed.type, 'agenda', phrase)
  if (options.windowLabel) assert.equal(parsed.label || parsed.dateWindow?.label, options.windowLabel, phrase)
  if (options.weekday !== undefined) {
    assert.equal(dateTimePartsInTimeZone(parsed.dateWindow?.start, timeZone).weekday, options.weekday, phrase)
  }
}

function assertCancel(phrase, queryPattern) {
  const parsed = intent(phrase)
  assert.equal(parsed.type, 'cancel', phrase)
  if (queryPattern) assert.match(parsed.query, queryPattern, phrase)
}

function assertReschedule(phrase, queryPattern) {
  const parsed = intent(phrase)
  assert.equal(parsed.type, 'reschedule', phrase)
  if (queryPattern) assert.match(parsed.query, queryPattern, phrase)
}

const schedulePhrases = [
  'schedule lunch tomorrow',
  'book lunch tomorow',
  'book lunch tommorow',
  'book lunch tommorrow',
  'put dinner on my calendar',
  'add soccer practice next Thursday',
  'book a meeting with Stacey',
  'I need to meet Beth this week',
  'find me time for a haircut',
  'can you fit in a call Friday afternoon',
  'hold 2pm for dentist',
  'block off tomorrow morning',
  'save this as an event tomorrow at 4',
  'I already booked dentist May 4 at 10',
  'pencil in coffee Friday morning',
  'plan dinner this weekend',
  'schedule breakfast tomorrow',
  'schedule supper next week',
  'schedule brunch Sunday',
  'quick 15 min call tomorrow',
  'schedule 1 hour meeting Friday',
  'schedule 2 hour meeting next week',
  'schedule gym workout today at 5',
  'schedule run tomorrow morning',
  'schedule oil change next week',
  'doctor appointment in May',
  'vet appointment Friday',
  'haircut Wednesday',
  'dentist next week',
  'meeting Friday',
  'call Thursday at noon',
  'coffee with Sarah Tuesday at 8',
  'dinner at Rhinelander Friday at 6',
  'lunch near the office tomorrow',
  'schedule budget review on Work calendar',
  'add school concert to Family calendar',
  'book design review into Metonga Media',
  'schedule test meeting today and repeats every Monday at 7pm',
  'monthly budget review on the 15th at 9',
  'weekly team meeting Tuesday at 10',
  'every other Friday call at 3',
  'meeting in 3 days',
  'meeting 2 weeks from now',
  'dentist appointment next month',
  'lunch tomorrow afternoon',
  'meeting tonight',
  'schedule meeting next Friday morning',
  'schedule meeting next week Thursday',
  'schedule call end of month',
  'schedule dentist mid May',
  'schedule meeting early next week',
  'can you squeeze in lunch tomorrow',
  'make time for a call next week',
  'find time for dentist in May',
  'schedule haircut sometime this week',
  'add birthday party May 16 at 1pm at Mary’s house',
  'save appointment card May 17 10:30am Northwoods Dental',
  'already scheduled dentist May 17 at 10:30',
  'throw lunch on Work calendar tomorrow at noon',
]

assertTypes(schedulePhrases, 'schedule')

assertSchedule('book lunch tomorow', { windowLabel: 'tomorrow' })
assertSchedule('schedule lunch tomorrow', { title: 'lunch', windowLabel: 'tomorrow' })
assertSchedule('schedule breakfast tomorrow', { title: 'breakfast' })
assertSchedule('schedule supper next week', { title: 'supper', windowLabel: 'next week' })
assertSchedule('quick 15 min call tomorrow', { title: 'quick call', durationMinutes: 15 })
assertSchedule('schedule 1 hour meeting Friday', { title: 'meeting', durationMinutes: 60 })
assertSchedule('call Thursday at noon', { hour: 12, minute: 0, weekday: 4 })
assertSchedule('dinner at Rhinelander Friday at 6', { title: 'dinner', location: 'Rhinelander' })
assertSchedule('schedule meeting at 6', { hour: 18, minute: 0 })
assertSchedule('schedule meeting at 7', { hour: 19, minute: 0 })
assertSchedule('schedule meeting at 8', { hour: 20, minute: 0 })
assertSchedule('schedule meeting at 10', { hour: 10, minute: 0 })
assertSchedule('schedule meeting at 11', { hour: 11, minute: 0 })
const changeThatTo515 = intent('change that to 5:15')
assert.equal(changeThatTo515.type, 'reschedule', 'change that to 5:15')
assert.deepEqual(changeThatTo515.exactTime, { hour: 17, minute: 15 }, 'change that to 5:15')
assert.match(changeThatTo515.query, /that/i, 'change that to 5:15')
const moveItTo515 = intent('move it to 5:15')
assert.equal(moveItTo515.type, 'reschedule', 'move it to 5:15')
assert.deepEqual(moveItTo515.exactTime, { hour: 17, minute: 15 }, 'move it to 5:15')
assert.match(moveItTo515.query, /it/i, 'move it to 5:15')
assertSchedule('schedule budget review on Work calendar', { calendarHint: 'Work' })
assertSchedule('add school concert to Family calendar', { calendarHint: 'Family' })
assertSchedule('book design review into Metonga Media', { calendarHint: 'Metonga Media' })
assertSchedule('schedule dentist mid May', { windowLabel: 'mid May' })
assertSchedule('schedule call end of month', { windowLabel: 'end of the month' })
assertSchedule('schedule meeting next week Thursday', { weekday: 4 })

assert.deepEqual(scheduleCandidateTimesForTitle('breakfast').slice(0, 3), [
  { hour: 8, minute: 0 },
  { hour: 8, minute: 30 },
  { hour: 9, minute: 0 },
])
assert.deepEqual(scheduleCandidateTimesForTitle('supper').slice(0, 3), [
  { hour: 17, minute: 30 },
  { hour: 18, minute: 0 },
  { hour: 18, minute: 30 },
])

const agendaPhrases = [
  "what's tomorrow",
  'whats tomorrow',
  "what's on my calendar tomorrow?",
  "what's my schedule for today",
  "today's schedule",
  "what's my agenda today",
  "what's my day look like tomorrow",
  'what am i doing today',
  'what do I have this week',
  "what's on my calendar next Monday",
  'show me next week',
  'show me next weeks schedule',
  "what's coming up",
  'upcoming',
  'do I have anything Friday morning',
  'am I free tomorrow at 3',
  'am I open next Thursday',
  'am I available this afternoon',
  'walk me through tomorrow',
  'brief me on today',
  'calendar for tomorrow',
  'next Mondays agenda',
  "what's next Mondays agenda",
  'what do I have next week',
]

assertTypes(agendaPhrases, 'agenda')
assertAgenda("what's coming up", { windowLabel: 'coming up' })
assertAgenda("what's on my calendar next Monday", { weekday: 1 })
assertAgenda("what's next Mondays agenda", { weekday: 1 })

const lookupPhrases = [
  "when's Oakleys appointment",
  'when is dentist',
  'what time is dinner',
  'where is my meeting',
  'where are soccer practice',
  'when do I have my doctor appointment',
]

assertTypes(lookupPhrases, 'lookup')

const cancelPhrases = [
  ['cancel lunch', /lunch/],
  ['delete that', /meeting|that/],
  ['remove the meeting tomorrow', /meeting/],
  ['drop dentist from my calendar', /dentist/],
  ['take dentist off my calendar', /dentist/],
  ['cancel the 2:30 meeting', /meeting/],
  ['cancel tomorrow meeting', /meeting/],
  ['cancel Wednesday appointment', /appointment/],
  ['actually cancel that', /meeting|that/],
  ['never mind cancel lunch', /lunch/],
]

for (const [phrase, queryPattern] of cancelPhrases) {
  assertCancel(phrase, queryPattern)
}

const reschedulePhrases = [
  ['move lunch to Friday', /lunch/],
  ['reschedule dentist appointment', /dentist/],
  ['move my 2:30 meeting to Friday', /meeting/],
  ['push meeting back 1 hour', /meeting/],
  ['change dinner to 6pm', /dinner/],
  ['move haircut to tomorrow', /haircut/],
  ['move that to next week', /meeting|that/],
  ['reschedule my doctor appointment next Thursday', /doctor/],
]

for (const [phrase, queryPattern] of reschedulePhrases) {
  assertReschedule(phrase, queryPattern)
}

const choicePhrases = [
  '1',
  'option 2',
  'second one',
  'go with third',
  'pick first please',
  'lets do 3',
  "I'd like the second one",
]

assertTypes(choicePhrases, 'choice')

assert.equal(
  resolvePendingChoice('book anyway', {
    kind: 'schedule',
    payload: {
      options: [
        { title: 'meeting', start: '2026-04-22T23:00:00.000Z' },
        { title: 'meeting', start: '2026-04-23T00:00:00.000Z' },
      ],
    },
  }),
  1,
)

assert.deepEqual(parseInviteesFromText('meeting with Stacey tomorrow at 2').names, ['Stacey'])
assert.deepEqual(parseInviteesFromText('call with Mike and Sarah Friday').names, ['Mike', 'Sarah'])
assert.deepEqual(parseInviteesFromText('invite Priya to meeting Tuesday').names, ['Priya'])
assert.deepEqual(parseInviteesFromText('meeting with Stacey stacey@example.com tomorrow').directInvitees, [
  { displayName: 'Stacey', email: 'stacey@example.com' },
])
assert.deepEqual(resolveInviteeFollowUp('yes, justin@metongamedia.com', ['Justin']).resolved, [
  { displayName: 'Justin', email: 'justin@metongamedia.com' },
])
assert.deepEqual(resolveInviteeFollowUp('Stacey is sw312@mac.com', ['Stacey']).resolved, [
  { displayName: 'Stacey', email: 'sw312@mac.com' },
])

assert.deepEqual(parseExistingEventInviteRequest('add Stacey to Mokums birthday party'), {
  eventQuery: 'Mokums birthday party',
  names: ['Stacey'],
  directInvitees: [],
})
assert.deepEqual(parseExistingEventInviteRequest('Can you add Stacey to it?'), {
  eventQuery: 'that',
  names: ['Stacey'],
  directInvitees: [],
})
assert.deepEqual(parseExistingEventInviteRequest('invite Sam sam@example.com to lunch Friday'), {
  eventQuery: 'lunch Friday',
  names: [],
  directInvitees: [{ displayName: 'Sam', email: 'sam@example.com' }],
})

console.log(`Human phrase checks passed (${[
  schedulePhrases.length,
  agendaPhrases.length,
  lookupPhrases.length,
  cancelPhrases.length,
  reschedulePhrases.length,
  choicePhrases.length,
].reduce((sum, count) => sum + count, 0)} phrases plus invite/contact assertions).`)
