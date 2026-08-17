'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')
require('../js/kernel/resource-readiness.js')

window.DCWeb.Runtime = { installJQuery() {} }
window.DCWeb.TyranoSaveAdapter = { install() {} }
require('../js/kernel/tyrano-preload-scheduler.js')
require('../js/kernel/tyrano-jump-guard.js')
require('../js/kernel/tyrano-adapter.js')

function createDocument() {
  const elements = new Map()
  const attributes = new Map()
  const styles = []
  const root = {
    appendChild(element) {
      element.parentNode = root
      if (element.textContent) styles.push(element)
      if (element.id) elements.set(element.id, element)
    },
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
    styles,
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
  const imageStarts = []
  const sequence = []
  let resolveModRuntime
  let resolveStorage
  const document = createDocument()
  function jquery() { return { each() {} } }
  jquery.extend = function (_, target) { return target }

  const imageTag = {
    start(pm) { imageStarts.push(pm.storage) },
  }
  const jumpTag = {
    start() { sequence.push('jump') },
  }
  const kag = {
    dc: {},
    ftag: {
      master_tag: { image: imageTag, jump: jumpTag },
      nextOrderWithLabel() {},
    },
    preload(storage, callback) {
      preloadStarts.push(storage)
      preloadCompletions.set(storage, callback)
    },
    preloadAll() { throw new Error('Original preloadAll should be replaced') },
    registerPreloadCompleteCallback() {},
    readyAudio() { sequence.push('audio') },
    stat: { is_strong_stop: false },
    tag: { image: imageTag, jump: jumpTag },
    tmp: {},
  }
  const target = {
    TYRANO: {
      init() { sequence.push('init') },
      kag,
    },
    api: { storage: { ready: new Promise((resolve) => { resolveStorage = resolve }) } },
    addEventListener(type, listener) {
      const values = pageListeners.get(type) || []
      values.push(listener)
      pageListeners.set(type, values)
    },
    __dcModRuntimeReady: new Promise((resolve) => { resolveModRuntime = resolve }),
    console,
    document,
    jQuery: jquery,
    navigator: { userActivation: { hasBeenActive: true, isActive: true } },
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
  assert.equal(document.documentElement.getAttribute('data-dc-jump-guard'), 'installed')
  assert.equal(document.documentElement.getAttribute('data-dc-smart-buttons'), 'hidden')
  assert.equal(kag.ftag.master_tag.jump.start.__dcJumpGuard, true)
  const smartButtonStyle = document.styles.map((style) => style.textContent).join('\n')
  assert.match(smartButtonStyle, /div:has\(\.area_save_list\) \.button_smart/)
  assert.match(smartButtonStyle, /display:\s*none\s*!important/)
  kag.ftag.master_tag.image.start.call({ kag }, { folder: 'chara', layer: '0', storage: 'hero.webp' })
  assert.deepEqual(preloadStarts, ['./data/chara/hero.webp'])
  assert.deepEqual(imageStarts, [])
  preloadCompletions.get('./data/chara/hero.webp')({
    decode() { return Promise.resolve() },
    naturalHeight: 960,
    naturalWidth: 1280,
    tagName: 'IMG',
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(imageStarts, ['hero.webp'])
  preloadStarts.length = 0
  let preloadsComplete = 0
  let schedulerIdle = 0
  kag.preloadAll(['one.mp4', 'two.mp4'], function () { preloadsComplete++ })
  kag.registerPreloadCompleteCallback(function () { schedulerIdle++ })
  assert.deepEqual(preloadStarts, ['one.mp4'])
  preloadCompletions.get('one.mp4')()
  await Promise.resolve()
  assert.deepEqual(preloadStarts, ['one.mp4', 'two.mp4'])
  assert.equal(preloadsComplete, 0)
  assert.equal(schedulerIdle, 0)
  preloadCompletions.get('two.mp4')()
  await Promise.resolve()
  assert.equal(preloadsComplete, 1)
  assert.equal(schedulerIdle, 1)
  assert.equal(document.documentElement.getAttribute('data-dc-preload-state'), 'idle')
  const ready = target.TYRANO.init()
  assert.deepEqual(sequence, [])
  assert.equal(document.documentElement.getAttribute('data-dc-start-gate'), null)
  assert.deepEqual(messages, [])

  resolveModRuntime()
  await Promise.resolve()
  assert.deepEqual(messages, [])
  resolveStorage()
  await ready
  assert.equal(document.documentElement.getAttribute('data-dc-start-gate'), 'ready')
  assert.deepEqual(messages, [{ type: 'dc-player-ready', launchId: 42, launchToken: 'launch-token' }])

  const hookJumpStart = function () { sequence.push('hook-jump') }
  kag.ftag.master_tag.jump.start = hookJumpStart
  const started = target.__dcStartGame()
  assert.notEqual(kag.ftag.master_tag.jump.start, hookJumpStart)
  assert.equal(kag.ftag.master_tag.jump.start.__dcJumpGuard, true)
  assert.deepEqual(sequence, ['audio', 'init'])
  assert.deepEqual(messages[1], { type: 'dc-player-started', launchId: 42, launchToken: 'launch-token' })
  await started
  assert.deepEqual(sequence, ['audio', 'init'])
  assert.equal(document.documentElement.getAttribute('data-dc-start-gate'), 'started')
  assert.equal(document.documentElement.getAttribute('data-dc-start-path'), 'host-bridge')
  assert.equal(document.documentElement.getAttribute('data-dc-start-user-active'), 'true')
  pageListeners.get('pagehide').forEach(function (listener) { listener() })
  assert.equal(document.documentElement.getAttribute('data-dc-preload-state'), 'canceled')
  console.log('Start gate tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
