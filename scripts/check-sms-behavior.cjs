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

console.log('SMS behavior checks passed.')
