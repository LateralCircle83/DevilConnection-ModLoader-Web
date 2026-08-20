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
require('../js/kernel/tyrano-touch-guard.js')
require('../js/kernel/tyrano-bg-guard.js')
require('../js/kernel/tyrano-chara-guard.js')
require('../js/kernel/tyrano-video-unlock.js')
require('../js/kernel/tyrano-audio-unlock.js')
require('../js/kernel/tyrano-adapter.js')

function createDocument() {
  const elements = new Map()
  const attributes = new Map()
  const styles = []
  const listeners = []
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
    listeners,
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
    addEventListener(type, listener, options) {
      listeners.push({ type, listener, options })
    },
    removeEventListener(type, listener) {
      const index = listeners.findIndex((entry) => entry.type === type && entry.listener === listener)
      if (index >= 0) listeners.splice(index, 1)
    },
  }
}

function createMinimalTarget() {
  const document = createDocument()
  const bgTag = { start() {} }
  const charaShowTag = { start() {} }
  const charaModTag = { start() {} }
  const movieTag = { start() {} }
  const kag = {
    dc: {},
    ftag: {
      master_tag: { bg: bgTag, bg2: bgTag, image: { start() {} }, jump: { start() {} }, movie: movieTag },
      nextOrderWithLabel() {},
    },
    init_game() {},
    preload() {},
    preloadAll() {},
    registerPreloadCompleteCallback() {},
    readyAudio() {},
    stat: { is_strong_stop: false },
    tag: {
      bg: bgTag,
      bg2: bgTag,
      chara_mod: charaModTag,
      chara_show: charaShowTag,
      image: { start() {} },
      jump: { start() {} },
      movie: movieTag,
    },
    tmp: {},
  }
  kag.ftag.master_tag.chara_mod = charaModTag
  kag.ftag.master_tag.chara_show = charaShowTag
  function jquery() { return { each() {} } }
  jquery.extend = function (_, target) { return target }
  jquery.event = {}
  return {
    TYRANO: { init() {}, kag },
    api: { storage: { ready: Promise.resolve() } },
    addEventListener() {},
    clearTimeout,
    console,
    document,
    jQuery: jquery,
    navigator: { userActivation: { hasBeenActive: true, isActive: true } },
    parent: { postMessage() {} },
    requestAnimationFrame(callback) { callback() },
    setInterval() { return 1 },
    setTimeout,
    tyrano: { plugin: { kag } },
  }
}

function testTouchGuardWiredByDefault() {
  const target = createMinimalTarget()
  window.DCWeb.TyranoAdapter.install(target, { has() { return false } }, 1, 'token')
  const root = target.document.documentElement
  assert.equal(root.getAttribute('data-dc-jump-guard'), 'installed')
  assert.equal(root.getAttribute('data-dc-touch-guard'), 'installed')
  assert.equal(root.getAttribute('data-dc-bg-guard'), 'installed')
  assert.equal(root.getAttribute('data-dc-chara-guard'), 'installed')
  assert.equal(root.getAttribute('data-dc-video-unlock'), 'installed')
  assert.equal(Boolean(target.tyrano.plugin.kag.ftag.master_tag.jump.start.__dcJumpGuard), true)
  assert.equal(Boolean(target.tyrano.plugin.kag.ftag.master_tag.bg.start.__dcBgLatestWins), true)
  assert.equal(Boolean(target.tyrano.plugin.kag.ftag.master_tag.chara_mod.start.__dcCharaLatestWins), true)
  assert.equal(Boolean(target.tyrano.plugin.kag.ftag.master_tag.movie.start.__dcVideoUnlockStart), true)
  assert.equal(Boolean(target.tyrano.plugin.kag.init_game.__dcEventLayerDedupe), true)
  assert.equal(Boolean(target.jQuery.event.tap && target.jQuery.event.tap.__dcNoStopTap), true)
}

async function main() {
  const messages = []
  const pageListeners = new Map()
  const preloadCompletions = new Map()
  const preloadStarts = []
  const imageStarts = []
  const bgApplied = []
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
  const movieTag = {
    start() { sequence.push('movie') },
  }
  function makeBgTag() {
    return {
      start(pm) {
        if (String(pm.time) === '0' || Number(pm.time) === 0) pm.wait = 'false'
        const path = './data/bgimage/' + pm.storage
        kag.preload(path, function () { bgApplied.push(pm.storage) })
      },
    }
  }
  const bgTag = makeBgTag()
  const charaShowTag = { start() {} }
  const charaModTag = { start() {} }
  const kag = {
    dc: {},
    ftag: {
      master_tag: { bg: bgTag, bg2: bgTag, image: imageTag, jump: jumpTag, movie: movieTag },
      nextOrderWithLabel() {},
    },
    init_game() {},
    preload(storage, callback) {
      preloadStarts.push(storage)
      preloadCompletions.set(storage, callback)
    },
    preloadAll() { throw new Error('Original preloadAll should be replaced') },
    registerPreloadCompleteCallback() {},
    readyAudio() { sequence.push('audio') },
    stat: { is_strong_stop: false },
    tag: {
      bg: bgTag,
      bg2: bgTag,
      chara_mod: charaModTag,
      chara_show: charaShowTag,
      image: imageTag,
      jump: jumpTag,
      movie: movieTag,
    },
    tmp: {},
  }
  kag.ftag.master_tag.chara_mod = charaModTag
  kag.ftag.master_tag.chara_show = charaShowTag
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
  assert.equal(document.documentElement.getAttribute('data-dc-touch-guard'), 'installed')
  assert.equal(document.documentElement.getAttribute('data-dc-bg-guard'), 'installed')
  assert.equal(document.documentElement.getAttribute('data-dc-chara-guard'), 'installed')
  assert.equal(document.documentElement.getAttribute('data-dc-video-unlock'), 'installed')
  assert.equal(document.documentElement.getAttribute('data-dc-smart-buttons'), 'hidden')
  assert.equal(kag.ftag.master_tag.jump.start.__dcJumpGuard, true)
  assert.equal(kag.ftag.master_tag.bg.start.__dcBgLatestWins, true)
  assert.equal(kag.ftag.master_tag.chara_mod.start.__dcCharaLatestWins, true)
  assert.equal(kag.ftag.master_tag.movie.start.__dcVideoUnlockStart, true)
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

  kag.ftag.master_tag.bg.start.call(kag.ftag.master_tag.bg, { storage: 'kuro.webp', time: '0' })
  kag.ftag.master_tag.bg.start.call(kag.ftag.master_tag.bg, { storage: 'haikei2.webp', time: '0' })
  preloadCompletions.get('./data/bgimage/haikei2.webp')()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(bgApplied, ['haikei2.webp'])
  preloadCompletions.get('./data/bgimage/kuro.webp')()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(bgApplied, ['haikei2.webp'])

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
  const hookMovieStart = function () { sequence.push('hook-movie') }
  kag.ftag.master_tag.movie.start = hookMovieStart
  const started = target.__dcStartGame()
  assert.notEqual(kag.ftag.master_tag.jump.start, hookJumpStart)
  assert.equal(kag.ftag.master_tag.jump.start.__dcJumpGuard, true)
  assert.notEqual(kag.ftag.master_tag.movie.start, hookMovieStart)
  assert.equal(kag.ftag.master_tag.movie.start.__dcVideoUnlockStart, true)
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

testTouchGuardWiredByDefault()
main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
