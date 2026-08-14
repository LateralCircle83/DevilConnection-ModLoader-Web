'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')
require('../js/kernel/tyrano-preload-scheduler.js')

const Scheduler = window.DCWeb.TyranoPreloadScheduler

function createTarget() {
  let nextTimerId = 1
  const attributes = new Map()
  const timers = new Map()
  const warnings = []
  return {
    attributes,
    clearTimeout(id) { timers.delete(id) },
    console: {
      error() {},
      warn() { warnings.push(Array.from(arguments)) },
    },
    document: {
      documentElement: {
        getAttribute(name) { return attributes.get(name) || null },
        setAttribute(name, value) { attributes.set(name, String(value)) },
      },
    },
    runNextTimer() {
      const entry = timers.entries().next().value
      if (!entry) throw new Error('No pending timer')
      timers.delete(entry[0])
      entry[1].callback()
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++
      timers.set(id, { callback, delay })
      return id
    },
    timers,
    warnings,
  }
}

function testBoundsAndNoPermanentCache() {
  const target = createTarget()
  const started = []
  const pending = new Map()
  let active = 0
  let maxActive = 0
  const scheduler = new Scheduler(target, function (resource, callback) {
    started.push(resource)
    active++
    maxActive = Math.max(maxActive, active)
    pending.set(resource, function () {
      pending.delete(resource)
      active--
      callback(resource + ':loaded')
    })
  }, { limits: { total: 2, image: 2 } })

  let completedGroups = 0
  scheduler.preload(['a.png', 'b.png', 'c.png'], function () { completedGroups++ })
  assert.deepEqual(started, ['a.png', 'b.png'])
  assert.equal(scheduler.stats().queued, 1)

  pending.get('a.png')()
  assert.deepEqual(started, ['a.png', 'b.png', 'c.png'])
  pending.get('b.png')()
  pending.get('c.png')()

  assert.equal(completedGroups, 1)
  assert.equal(maxActive, 2)
  assert.equal(scheduler.stats().completed, 3)
  assert.equal(scheduler.stats().peakActive, 2)
  assert.equal(target.attributes.get('data-dc-preload-state'), 'idle')
  assert.equal(target.attributes.get('data-dc-preload-limit-total'), '2')
  assert.equal(target.attributes.get('data-dc-preload-timeout-ms'), '30000')

  scheduler.preload('a.png', function () { completedGroups++ })
  assert.equal(started.filter((resource) => resource === 'a.png').length, 2)
  pending.get('a.png')()
  assert.equal(completedGroups, 2)
}

function testInflightDeduplicationRespectsSemanticOptions() {
  const target = createTarget()
  const runs = []
  const completions = []
  const scheduler = new Scheduler(target, function (resource, callback, options) {
    runs.push({ options, resource })
    completions.push(callback)
  })
  const values = []

  scheduler.preload('data/sound/voice.ogg?v=1', function (value) { values.push('first:' + value) }, { name: 'voice' })
  scheduler.preload('data/sound/VOICE.ogg?v=2', function (value) { values.push('second:' + value) }, { name: 'voice' })
  scheduler.preload('data/sound/voice.ogg?v=3', function (value) { values.push('alternate:' + value) }, { name: 'alternate' })

  assert.equal(runs.length, 2)
  assert.equal(scheduler.stats().deduplicated, 1)
  completions[0]('shared')
  completions[1]('other')
  assert.deepEqual(values, ['first:shared', 'second:shared', 'alternate:other'])
  assert.equal(scheduler.stats().completed, 2)

  scheduler.preload('https://one.example/assets/shared.png', function () {})
  scheduler.preload('https://two.example/assets/shared.png', function () {})
  assert.equal(runs.length, 4)
  completions[2]()
  completions[3]()
}

async function testFailureAndTimeoutReleaseCallbacks() {
  const target = createTarget()
  const scheduler = new Scheduler(target, function (resource) {
    if (resource === 'throw.png') throw new Error('sync failure')
    if (resource === 'reject.png') return Promise.reject(new Error('async failure'))
  }, { timeoutMs: 50 })
  const completed = []

  scheduler.preload('throw.png', function () { completed.push('throw') })
  scheduler.preload('reject.png', function () { completed.push('reject') })
  await Promise.resolve()
  await Promise.resolve()
  scheduler.preload('hang.png', function () { completed.push('timeout') })
  target.runNextTimer()

  assert.deepEqual(completed, ['throw', 'reject', 'timeout'])
  assert.equal(scheduler.stats().failed, 2)
  assert.equal(scheduler.stats().timedOut, 1)
  assert.equal(scheduler.stats().active, 0)
  assert.equal(target.warnings.length, 3)
}

function testCategoryFairnessAndCancellation() {
  const target = createTarget()
  const started = []
  const completions = new Map()
  const scheduler = new Scheduler(target, function (resource, callback) {
    started.push(resource)
    completions.set(resource, callback)
  }, { limits: { total: 2, image: 1, video: 1 } })
  let groupCallback = 0
  let idleCallback = 0

  scheduler.preload(['one.mp4', 'two.mp4', 'cover.png'], function () { groupCallback++ })
  scheduler.whenIdle(function () { idleCallback++ })
  assert.deepEqual(started, ['one.mp4', 'cover.png'])
  assert.equal(scheduler.stats().queued, 1)

  scheduler.cancel()
  assert.equal(groupCallback, 0)
  assert.equal(idleCallback, 0)
  assert.equal(scheduler.stats().canceled, 3)
  assert.equal(scheduler.stats().active, 0)
  assert.equal(scheduler.stats().queued, 0)
  assert.equal(target.attributes.get('data-dc-preload-state'), 'canceled')

  completions.get('one.mp4')()
  completions.get('cover.png')()
  assert.equal(groupCallback, 0)
  assert.deepEqual(started, ['one.mp4', 'cover.png'])
}

function testSynchronousCacheHitsDrainWithoutRecursion() {
  const target = createTarget()
  let releaseFirst
  let completedGroups = 0
  let runCount = 0
  const scheduler = new Scheduler(target, function (resource, callback) {
    runCount++
    if (resource === 'hold.png') releaseFirst = callback
    else callback()
  }, { limits: { total: 1, image: 1 } })
  const resources = ['hold.png']
  for (let index = 0; index < 5000; index++) resources.push('cached-' + index + '.png')

  scheduler.preload(resources, function () { completedGroups++ })
  assert.equal(runCount, 1)
  assert.equal(scheduler.stats().queued, 5000)
  releaseFirst()

  assert.equal(completedGroups, 1)
  assert.equal(runCount, resources.length)
  assert.equal(scheduler.stats().completed, resources.length)
  assert.equal(scheduler.stats().active, 0)
  assert.equal(scheduler.stats().queued, 0)
}

async function main() {
  testBoundsAndNoPermanentCache()
  testInflightDeduplicationRespectsSemanticOptions()
  await testFailureAndTimeoutReleaseCallbacks()
  testCategoryFairnessAndCancellation()
  testSynchronousCacheHitsDrainWithoutRecursion()
  console.log('Tyrano preload scheduler tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
