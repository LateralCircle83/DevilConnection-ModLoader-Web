'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/shell/player-runtime-controls.js')

const events = []
class RealmKeyboardEvent {
  constructor(type, options) {
    this.type = type
    Object.assign(this, options)
  }
}

let cleared = 0
const activeElement = { dispatchEvent(event) { events.push(event); return true } }
const frame = {
  contentWindow: {
    KeyboardEvent: RealmKeyboardEvent,
    api: {
      __dcDiagnostics: {
        clear() { cleared++ },
        snapshot() {
          return {
            entries: [
              { level: 'warn', message: 'warning', sequence: 1, source: 'console', time: 10 },
              { level: 'unknown', message: 'failure', sequence: 2, source: 'window', time: 20 },
            ],
            limit: 160,
          }
        },
      },
    },
    document: { activeElement },
  },
}

const controls = new window.DCWeb.PlayerRuntimeControls(frame)
const layoutIds = window.DCWeb.PlayerRuntimeControls.keyboardLayout().flat().filter((item) => !item.spacer).map((item) => item.id)
assert.ok(layoutIds.length > 80)
assert.ok(layoutIds.includes('f1'))
assert.ok(layoutIds.includes('f12'))
assert.ok(layoutIds.includes('keya'))
assert.ok(layoutIds.includes('arrowright'))

assert.equal(controls.keyDown('controlleft'), true)
assert.equal(controls.keyDown('controlleft'), false)
assert.equal(events[0].type, 'keydown')
assert.equal(events[0].key, 'Control')
assert.equal(events[0].code, 'ControlLeft')
assert.equal(events[0].keyCode, 17)
assert.equal(events[0].which, 17)
assert.equal(controls.keyUp('controlleft'), true)
assert.equal(events[1].type, 'keyup')

assert.equal(controls.tapKey('enter'), true)
assert.deepEqual(events.slice(2).map((event) => event.type), ['keydown', 'keyup'])
assert.equal(events[2].keyCode, 13)
assert.equal(controls.tapKey('unsupported'), false)

controls.keyDown('controlleft')
controls.keyDown('shiftleft')
controls.tapKey('keya')
const shiftedKeyDown = events.findLast((event) => event.type === 'keydown' && event.code === 'KeyA')
assert.equal(shiftedKeyDown.key, 'A')
assert.equal(shiftedKeyDown.ctrlKey, true)
assert.equal(shiftedKeyDown.shiftKey, true)
controls.releaseAll()

controls.tapKey('f12')
const functionKeyDown = events.findLast((event) => event.type === 'keydown' && event.code === 'F12')
assert.equal(functionKeyDown.keyCode, 123)

controls.keyDown('arrowleft')
controls.keyDown('space')
controls.releaseAll()
assert.deepEqual(Object.keys(controls.pressed), [])
assert.deepEqual(events.slice(-2).map((event) => event.type), ['keyup', 'keyup'])

let diagnostics = controls.readDiagnostics()
assert.equal(diagnostics.available, true)
assert.deepEqual(diagnostics.counts, { error: 1, warn: 1 })
assert.deepEqual(diagnostics.entries.map((entry) => entry.level), ['warn', 'error'])
diagnostics = controls.clearDiagnostics()
assert.equal(cleared, 1)
assert.equal(diagnostics.available, true)

console.log('Player runtime controls tests passed')
