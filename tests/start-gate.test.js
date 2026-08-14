'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')

window.DCWeb.Runtime = { installJQuery() {} }
window.DCWeb.TyranoSaveAdapter = { install() {} }
require('../js/kernel/tyrano-preload-scheduler.js')
require('../js/kernel/tyrano-adapter.js')

function createDocument() {
  const elements = new Map()
  const attributes = new Map()
  const root = {
    setAttribute(name, value) { attributes.set(name, String(value)) },
    getAttribute(name) { return attributes.get(name) || null },
  }
  const body = {
    appendChild(element) {
      element.parentNode = body
      if (element.id) elements.set(element.id, element)
    },
  }
  return {
    body,
    documentElement: root,
    createElement() {
      const listeners = {}
      return {
        listeners,
        style: {},
        addEventListener(type, listener) { listeners[type] = listener },
        remove() {
          if (this.id) elements.delete(this.id)
          this.parentNode = null
        },
        setAttribute() {},
      }
    },
    getElementById(id) { return elements.get(id) || null },
  }
}

async function main() {
  const messages = []
  const pageListeners = new Map()
  const preloadCompletions = new Map()
  const preloadStarts = []
  const sequence = []
  let resolveModRuntime
  const document = createDocument()
  function jquery() { return { each() {} } }
  jquery.extend = function (_, target) { return target }

  const kag = {
    dc: {},
    ftag: { master_tag: {} },
    preload(storage, callback) {
      preloadStarts.push(storage)
      preloadCompletions.set(storage, callback)
    },
    preloadAll() { throw new Error('Original preloadAll should be replaced') },
    registerPreloadCompleteCallback() {},
    readyAudio() { sequence.push('audio') },
    tag: {},
    tmp: {},
  }
  const target = {
    TYRANO: {
      init() { sequence.push('init') },
      kag,
    },
    api: { storage: { ready: Promise.resolve() } },
    addEventListener(type, listener) { pageListeners.set(type, listener) },
    __dcModRuntimeReady: new Promise((resolve) => { resolveModRuntime = resolve }),
    console,
    document,
    jQuery: jquery,
    parent: { postMessage(message) { messages.push(message) } },
    requestAnimationFrame(callback) { callback() },
    clearTimeout,
    setInterval() { return 1 },
    setTimeout,
    tyrano: { plugin: { kag } },
  }
  const vfs = { has() { return false } }

  window.DCWeb.TyranoAdapter.install(target, vfs, 42, 'launch-token')
  assert.equal(target.TYRANO.resource_concurrency, 4)
  let preloadsComplete = 0
  let schedulerIdle = 0
  kag.preloadAll(['one.mp4', 'two.mp4'], function () { preloadsComplete++ })
  kag.registerPreloadCompleteCallback(function () { schedulerIdle++ })
  assert.deepEqual(preloadStarts, ['one.mp4'])
  preloadCompletions.get('one.mp4')()
  assert.deepEqual(preloadStarts, ['one.mp4', 'two.mp4'])
  assert.equal(preloadsComplete, 0)
  assert.equal(schedulerIdle, 0)
  preloadCompletions.get('two.mp4')()
  assert.equal(preloadsComplete, 1)
  assert.equal(schedulerIdle, 1)
  assert.equal(document.documentElement.getAttribute('data-dc-preload-state'), 'idle')
  const ready = target.TYRANO.init()
  assert.deepEqual(sequence, [])
  assert.equal(document.documentElement.getAttribute('data-dc-start-gate'), null)
  assert.deepEqual(messages, [])

  resolveModRuntime()
  await ready
  assert.equal(document.documentElement.getAttribute('data-dc-start-gate'), 'ready')
  assert.deepEqual(messages, [{ type: 'dc-player-ready', launchId: 42, launchToken: 'launch-token' }])

  target.__dcStartGame()
  assert.deepEqual(sequence, ['audio'])
  assert.deepEqual(messages[1], { type: 'dc-player-started', launchId: 42, launchToken: 'launch-token' })

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(sequence, ['audio', 'init'])
  assert.equal(document.documentElement.getAttribute('data-dc-start-gate'), 'started')
  pageListeners.get('pagehide')()
  assert.equal(document.documentElement.getAttribute('data-dc-preload-state'), 'canceled')
  console.log('Start gate tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
