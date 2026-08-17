'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/tyrano-jump-guard.js')
require('../tools/input-advance.js')

const Probe = window.DCWeb.InputAdvanceProbe
const root = path.join(__dirname, '..')
const html = fs.readFileSync(path.join(root, 'tools', 'input-advance.html'), 'utf8')
const css = fs.readFileSync(path.join(root, 'tools', 'input-advance.css'), 'utf8')
const source = fs.readFileSync(path.join(root, 'tools', 'input-advance.js'), 'utf8')

function harness() {
  const pending = []
  const cancelled = []
  const traces = []
  const simulation = Probe.createSimulation({
    cancel(handle) { cancelled.push(handle) },
    onTrace(entry) { traces.push(entry) },
    schedule(callback, delay) {
      assert.equal(delay, 1)
      pending.push(callback)
      return pending.length
    },
  })
  return { cancelled, pending, simulation, traces }
}

function testUnguardedBurstFallsThrough() {
  const test = harness()
  test.simulation.reset('unguarded')
  assert.equal(test.simulation.advance('touchend:tap'), true)
  assert.equal(test.simulation.advance('click:trusted'), true)
  let snapshot = test.simulation.snapshot()
  assert.equal(snapshot.requests, 2)
  assert.equal(snapshot.blocked, 0)
  assert.equal(snapshot.fallthroughs, 1)
  assert.equal(snapshot.sex, 2)

  test.pending.shift()()
  snapshot = test.simulation.snapshot()
  assert.equal(snapshot.completedJumps, 1)
  assert.equal(snapshot.stage, 'target')
  assert.equal(snapshot.sex, 2)
}

function testHostGuardBlocksBurstAndPreservesJump() {
  const test = harness()
  const initial = test.simulation.reset('host-guard')
  assert.equal(initial.guardInstalled, true)
  assert.equal(test.simulation.advance('touchend:tap'), true)
  assert.equal(test.simulation.snapshot().strongStop, true)
  assert.equal(test.simulation.advance('click:trusted'), false)
  let snapshot = test.simulation.snapshot()
  assert.equal(snapshot.requests, 2)
  assert.equal(snapshot.accepted, 1)
  assert.equal(snapshot.blocked, 1)
  assert.equal(snapshot.fallthroughs, 0)
  assert.equal(snapshot.sex, 1)

  test.pending.shift()()
  snapshot = test.simulation.snapshot()
  assert.equal(snapshot.strongStop, false)
  assert.equal(snapshot.completedJumps, 1)
  assert.equal(snapshot.stage, 'target')
  assert.equal(snapshot.sex, 1)
}

function testLateSecondAdvanceIsNotMisreportedAsRace() {
  const test = harness()
  test.simulation.reset('unguarded')
  test.simulation.advance('touchend:tap')
  test.pending.shift()()
  test.simulation.advance('click:trusted')
  const snapshot = test.simulation.snapshot()
  assert.equal(snapshot.requests, 2)
  assert.equal(snapshot.fallthroughs, 0)
  assert.equal(snapshot.postTarget, 1)
  assert.equal(snapshot.sex, 1)
}

function testResetInvalidatesPendingJump() {
  const test = harness()
  test.simulation.reset('host-guard')
  test.simulation.advance('touchend:tap')
  const stale = test.pending.shift()
  test.simulation.reset('host-guard')
  stale()
  assert.equal(test.simulation.snapshot().completedJumps, 0)
  assert.ok(test.cancelled.length >= 1)
  assert.throws(() => test.simulation.reset('unknown'), /Unknown input advance mode/)
}

function testToolMarkupAndEventMapping() {
  assert.match(html, /id="input-probe"/)
  assert.match(html, /name="guard-mode" value="unguarded" checked/)
  assert.match(html, /name="guard-mode" value="host-guard"/)
  assert.match(html, /tyrano-jump-guard\.js\?v=/)
  assert.match(html, /id="strong-stop"/)
  assert.match(html, /id="event-log"[\s\S]*?role="log"/)

  const touchHandler = source.match(/function onTouchEnd\(event\) \{[\s\S]*?\n  \}/)
  assert.ok(touchHandler)
  assert.equal((touchHandler[0].match(/simulation\.advance/g) || []).length, 1)
  assert.match(touchHandler[0], /simulation\.advance\('touchend:tap'\)/)
  assert.match(source, /function onClick\(event\)[\s\S]*?simulation\.advance\(event\.isTrusted/)

  const mobileCss = css.slice(css.indexOf('@media (max-width: 680px)'))
  assert.match(mobileCss, /\.tool-header,[\s\S]*?\.probe-heading\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)[\s\S]*?justify-content:\s*stretch/)
  assert.match(mobileCss, /\.mode-switch\s*\{[\s\S]*?width:\s*100%/)
  assert.match(mobileCss, /\.state-details div\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/)
}

testUnguardedBurstFallsThrough()
testHostGuardBlocksBurstAndPreservesJump()
testLateSecondAdvanceIsNotMisreportedAsRace()
testResetInvalidatesPendingJump()
testToolMarkupAndEventMapping()
console.log('Input advance tool tests passed')
