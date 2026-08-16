'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/console-monitor.js')

function createTarget() {
  const listeners = {}
  const calls = []
  return {
    calls,
    listeners,
    console: {
      error() { calls.push(['error'].concat(Array.from(arguments))) },
      warn() { calls.push(['warn'].concat(Array.from(arguments))) },
    },
    addEventListener(type, listener) { listeners[type] = listener },
  }
}

const target = createTarget()
const monitor = window.DCWeb.ConsoleMonitor.install(target)
assert.equal(window.DCWeb.ConsoleMonitor.install(target), monitor)

const circular = { id: 1 }
circular.self = circular
target.console.warn('circular', circular)
target.console.error(new Error('console failure'))
target.listeners.error({ error: new Error('window failure') })
target.listeners.unhandledrejection({ reason: new Error('promise failure') })

let snapshot = monitor.snapshot()
assert.deepEqual(snapshot.counts, { error: 3, warn: 1 })
assert.equal(snapshot.entries.length, 4)
assert.match(snapshot.entries[0].message, /\[Circular\]/)
assert.match(snapshot.entries[1].message, /console failure/)
assert.equal(target.calls.length, 2)

let getterReads = 0
const lazy = {}
Object.defineProperty(lazy, 'secret', {
  enumerable: true,
  get() { getterReads++; return 'must not run' },
})
target.console.warn('lazy', lazy)
snapshot = monitor.snapshot()
assert.equal(getterReads, 0)
assert.match(snapshot.entries.at(-1).message, /secret: \[Accessor\]/)
assert.equal(target.calls.length, 3)
assert.equal(target.calls[2][2], lazy)

for (let index = 0; index < 170; index++) target.console.warn('entry', index)
snapshot = monitor.snapshot()
assert.equal(snapshot.entries.length, 160)
assert.equal(snapshot.limit, 160)
assert.ok(snapshot.entries[0].sequence > 1)

monitor.clear()
snapshot = monitor.snapshot()
assert.equal(snapshot.entries.length, 0)
assert.deepEqual(snapshot.counts, { error: 0, warn: 0 })

console.log('Console monitor tests passed')
