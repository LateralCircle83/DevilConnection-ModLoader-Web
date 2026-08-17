'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/tyrano-jump-guard.js')

const JumpGuard = window.DCWeb.TyranoJumpGuard
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

function createRuntime() {
  const timers = []
  const trace = []
  const kag = {
    stat: { is_strong_stop: false },
    tag: {},
    ftag: {
      current_order_index: 0,
      master_tag: {},
      nextOrder() {
        trace.push('nextOrder:requested')
        if (kag.stat.is_strong_stop) {
          trace.push('nextOrder:blocked')
          return false
        }
        this.current_order_index++
        if (this.current_order_index === 1) this.master_tag.jump.start({ target: '*target' })
        if (this.current_order_index === 2) trace.push('fallthrough')
        return true
      },
      nextOrderWithLabel(target) {
        trace.push('jump:complete:' + target)
        kag.stat.is_strong_stop = false
        this.current_order_index = 10
        this.nextOrder()
      },
    },
  }
  const jump = {
    kag,
    start(pm) {
      const tag = this
      timers.push(function () { tag.kag.ftag.nextOrderWithLabel(pm.target, pm.storage) })
      trace.push('jump:scheduled')
    },
  }
  kag.tag.jump = jump
  kag.ftag.master_tag.jump = jump
  return { kag, timers, trace }
}

function testExtraAdvanceIsBlockedUntilJumpCompletes() {
  const runtime = createRuntime()
  assert.equal(JumpGuard.install(runtime.kag), true)

  assert.equal(runtime.kag.ftag.nextOrder(), true)
  assert.equal(runtime.kag.stat.is_strong_stop, true)
  assert.equal(runtime.kag.ftag.nextOrder(), false)
  assert.equal(runtime.kag.ftag.current_order_index, 1)
  assert.equal(runtime.trace.includes('fallthrough'), false)

  runtime.timers.shift()()
  assert.equal(runtime.kag.stat.is_strong_stop, false)
  assert.equal(runtime.kag.ftag.current_order_index, 11)
  assert.equal(runtime.trace.filter((entry) => entry === 'nextOrder:blocked').length, 1)
}

function testUnguardedRuntimeFallsThrough() {
  const runtime = createRuntime()
  runtime.kag.ftag.nextOrder()
  runtime.kag.ftag.nextOrder()
  assert.equal(runtime.kag.ftag.current_order_index, 2)
  assert.equal(runtime.trace.includes('fallthrough'), true)
}

function testInstallIsIdempotentAndTracksReplacement() {
  const runtime = createRuntime()
  assert.equal(JumpGuard.install(runtime.kag), true)
  const firstWrapper = runtime.kag.ftag.master_tag.jump.start
  assert.equal(JumpGuard.install(runtime.kag), true)
  assert.equal(runtime.kag.ftag.master_tag.jump.start, firstWrapper)

  const replacement = function () {}
  runtime.kag.ftag.master_tag.jump.start = replacement
  assert.equal(JumpGuard.install(runtime.kag), true)
  assert.notEqual(runtime.kag.ftag.master_tag.jump.start, replacement)
  assert.equal(runtime.kag.ftag.master_tag.jump.start.__dcJumpGuard, true)
}

function testSynchronousFailureRestoresStrongStop() {
  const runtime = createRuntime()
  runtime.kag.ftag.master_tag.jump = {
    kag: runtime.kag,
    start() { throw new Error('jump failed') },
  }
  runtime.kag.tag.jump = null
  assert.equal(JumpGuard.install(runtime.kag), true)
  assert.throws(() => runtime.kag.ftag.master_tag.jump.start({}), /jump failed/)
  assert.equal(runtime.kag.stat.is_strong_stop, false)
}

function testUnsupportedRuntimeIsUnchanged() {
  assert.equal(JumpGuard.install(null), false)
  assert.equal(JumpGuard.install({ stat: {}, ftag: {} }), false)
}

function testBrowserScriptOrder() {
  const guardIndex = indexHtml.indexOf('js/kernel/tyrano-jump-guard.js')
  const adapterIndex = indexHtml.indexOf('js/kernel/tyrano-adapter.js')
  assert.ok(guardIndex >= 0, 'the jump guard script should be loaded')
  assert.ok(adapterIndex > guardIndex, 'the jump guard must load before TyranoAdapter')
}

testExtraAdvanceIsBlockedUntilJumpCompletes()
testUnguardedRuntimeFallsThrough()
testInstallIsIdempotentAndTracksReplacement()
testSynchronousFailureRestoresStrongStop()
testUnsupportedRuntimeIsUnchanged()
testBrowserScriptOrder()
console.log('Tyrano jump guard tests passed')
