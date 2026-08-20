'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/tyrano-audio-unlock.js')

const AudioUnlock = window.DCWeb.TyranoAudioUnlock
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

function createDocument() {
  const listeners = []
  const windowListeners = []
  const doc = {
    defaultView: {
      addEventListener(type, listener) { windowListeners.push({ type, listener }) },
      removeEventListener(type, listener) {
        const index = windowListeners.findIndex((entry) => entry.type === type && entry.listener === listener)
        if (index !== -1) windowListeners.splice(index, 1)
      },
    },
    documentElement: { setAttribute() {} },
    listeners,
    windowListeners,
    addEventListener(type, listener) { listeners.push({ type, listener }) },
    removeEventListener(type, listener) {
      const index = listeners.findIndex((entry) => entry.type === type && entry.listener === listener)
      if (index !== -1) listeners.splice(index, 1)
    },
  }
  return { doc, listeners, windowListeners }
}

function FakeAudioContext() {
  this.state = 'suspended'
  this.resumeCalls = 0
}
FakeAudioContext.prototype.resume = function () {
  this.resumeCalls += 1
  this.state = 'running'
  return Promise.resolve()
}

function createContextRef(state) {
  return {
    state: state || 'suspended',
    resumeCalls: 0,
    resume() {
      this.resumeCalls += 1
      this.state = 'running'
      return Promise.resolve()
    },
  }
}

function createTarget(options) {
  const { doc, listeners, windowListeners } = createDocument()
  const target = {
    document: doc,
    Howler: { ctx: createContextRef() },
    TYRANO: {
      kag: {
        popopo: { audioContext: createContextRef() },
        tmp: { audio_context: createContextRef() },
      },
    },
  }
  if (options && options.webkitOnly) {
    target.webkitAudioContext = FakeAudioContext
  } else {
    target.AudioContext = FakeAudioContext
  }
  return { doc, listeners, target, windowListeners }
}

function fireGesture(doc, type) {
  const entry = doc.listeners.find((item) => item.type === type)
  assert.ok(entry, 'expected gesture listener ' + type)
  entry.listener()
}

function testConstructorTracking() {
  const { doc, target } = createTarget()
  AudioUnlock.install(target)
  const context = new target.AudioContext()
  assert.ok(context instanceof FakeAudioContext, 'instanceof should survive the wrapper')
  assert.equal(context.state, 'running')
  assert.equal(context.resumeCalls, 1, 'creation-time resume should run once')

  // 已 running 的上下文在手势里不会被重复 resume
  fireGesture(doc, 'pointerdown')
  assert.equal(context.resumeCalls, 1)

  // 手动挂起后，手势应统一续命
  context.state = 'suspended'
  fireGesture(doc, 'touchend')
  assert.equal(context.state, 'running')
  assert.equal(context.resumeCalls, 2)
}

function testKnownReferencesResumed() {
  const { doc, target } = createTarget()
  AudioUnlock.install(target)
  fireGesture(doc, 'keydown')
  assert.equal(target.Howler.ctx.resumeCalls, 1)
  assert.equal(target.TYRANO.kag.tmp.audio_context.resumeCalls, 1)
  assert.equal(target.TYRANO.kag.popopo.audioContext.resumeCalls, 1)
}

function testInstallIdempotent() {
  const { doc, target } = createTarget()
  assert.equal(AudioUnlock.install(target), true)
  assert.equal(AudioUnlock.install(target), true)
  const context = new target.AudioContext()
  assert.equal(context.resumeCalls, 1, 'single wrapper must not double-resume')
  const gestureCount = doc.listeners.filter((entry) => entry.type === 'pointerdown').length
  assert.equal(gestureCount, 1)
}

function testWebkitOnlyPath() {
  const { target } = createTarget({ webkitOnly: true })
  AudioUnlock.install(target)
  const context = new target.webkitAudioContext()
  assert.ok(context instanceof FakeAudioContext)
  assert.equal(context.state, 'running')
}

function testPagehideCleanup() {
  const { doc, listeners, target, windowListeners } = createTarget()
  AudioUnlock.install(target)
  const before = listeners.length
  assert.ok(before >= 3)
  const pagehide = windowListeners.find((entry) => entry.type === 'pagehide')
  assert.ok(pagehide)
  pagehide.listener()
  assert.equal(listeners.length, 0, 'gesture listeners should be removed on pagehide')
}

function testIndexHtmlOrdering() {
  const audioIndex = indexHtml.indexOf('js/kernel/tyrano-audio-unlock.js')
  const adapterIndex = indexHtml.indexOf('js/kernel/tyrano-adapter.js')
  assert.ok(audioIndex !== -1, 'tyrano-audio-unlock.js should be loaded')
  assert.ok(audioIndex < adapterIndex, 'audio unlock should load before the adapter')
}

async function main() {
  testConstructorTracking()
  testKnownReferencesResumed()
  testInstallIdempotent()
  testWebkitOnlyPath()
  testPagehideCleanup()
  testIndexHtmlOrdering()
  console.log('Tyrano audio unlock tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
