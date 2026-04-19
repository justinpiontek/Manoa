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
const { applyDemoText, createDemoState } = require('../src/lib/demoSms.ts')
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

const thisWeek = assertScheduleWindow('schedule haircut sometime this week', 'this week')
assert.equal(parts(thisWeek.dateWindow.start).day, parts(startOfDay(0, timeZone)).day)

const may = assertScheduleWindow('I need a dentist appointment in May sometime', 'May')
assert.equal(parts(may.dateWindow.start).month, 5)
assert.equal(parts(may.dateWindow.end).month, 5)

const nextWeekThursday = parseSmsIntent('need a dentist appointment next week Thur', timeZone)
assert.equal(nextWeekThursday.type, 'schedule')
assert.equal(parts(nextWeekThursday.dateWindow.start).weekday, 4)

const tomorrowAfternoon = assertScheduleWindow('lunch tomorrow afternoon', 'tomorrow')
assert.deepEqual(tomorrowAfternoon.exactTime, { hour: 14, minute: 0 })

const tonight = assertScheduleWindow('meeting tonight', 'today')
assert.deepEqual(tonight.exactTime, { hour: 18, minute: 0 })

const nextMondayAgenda = parseSmsIntent("what's next Mondays agenda", timeZone)
assert.equal(nextMondayAgenda.type, 'agenda')
assert.equal(parts(nextMondayAgenda.dateWindow.start).weekday, 1)

assertAgendaWindow("what's coming up", 'coming up')

const lookup = parseSmsIntent("When's Oakleys appointment", timeZone)
assert.equal(lookup.type, 'lookup')
assert.equal(lookup.query, 'Oakleys appointment')

let demoState = createDemoState()
demoState = applyDemoText(demoState, 'schedule haircut this week sometime')
assert.equal(demoState.pendingAction?.kind, 'external_call_prep')
demoState = applyDemoText(demoState, '1')
assert.ok(demoState.events.some((event) => /\(pending\)$/i.test(event.title)))
demoState = applyDemoText(demoState, 'confirmed')
assert.match(demoState.messages.at(-1).lines.join('\n'), /marked .*haircut.* as confirmed/i)
assert.ok(!demoState.events.some((event) => /haircut.*\(pending\)$/i.test(event.title)))

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
