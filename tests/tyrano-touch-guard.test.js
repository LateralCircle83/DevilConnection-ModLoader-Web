'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/tyrano-touch-guard.js')

const TouchGuard = window.DCWeb.TyranoTouchGuard
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

function makeLayerElement(name) {
  const handlers = {}
  const node = {
    name,
    nodeType: 1,
    handlers,
    addEventListener(type, fn) {
      (handlers[type] = handlers[type] || []).push(fn)
    },
    removeEventListener(type, fn) {
      handlers[type] = (handlers[type] || []).filter((handler) => handler !== fn)
    },
    dispatch(type, event) {
      (handlers[type] || []).slice().forEach((fn) => fn(event || { target: node, stopPropagation() {} }))
    },
    onTap(fn) { node.addEventListener('tap', fn) },
    removeAllTap() { handlers.tap = [] },
    fireTap() { node.dispatch('tap') },
  }
  return node
}

function makeSetJquery(inGame, clone) {
  function wrap(elements) {
    return {
      length: elements.length,
      off(type) {
        if (type === 'tap') elements.forEach((element) => element.removeAllTap())
        return this
      },
      trigger(type) {
        if (type === 'tap') elements.forEach((element) => element.fireTap())
        return this
      },
    }
  }
  function jquery(selector) {
    if (selector === 'body > .layer_event_click') return wrap([clone])
    if (selector && selector.nodeType) return wrap([selector])
    if (Array.isArray(selector)) return wrap(selector)
    return wrap([])
  }
  jquery.fn = jquery.prototype = {}
  return { $: jquery, wrap }
}

function makeTapJquery(elements) {
  function wrap(selected) {
    return {
      length: selected.length,
      each(fn) {
        selected.forEach((element, index) => fn.call(element, index, element))
        return this
      },
      data(name, value) {
        if (arguments.length === 2) {
          selected.forEach((element) => {
            element.data = element.data || {}
            element.data[name] = value
          })
          return this
        }
        return selected[0] && selected[0].data ? selected[0].data[name] : undefined
      },
      bind(type, fn) {
        selected.forEach((element) => element.addEventListener(type, fn))
        return this
      },
      one(type, fn) {
        selected.forEach((element) => {
          const wrapped = function (event) {
            element.removeEventListener(type, wrapped)
            fn(event)
          }
          element.addEventListener(type, wrapped)
        })
        return this
      },
      unbind(type, fn) {
        selected.forEach((element) => {
          if (fn) element.removeEventListener(type, fn)
          else element.handlers[type] = []
        })
        return this
      },
      trigger(type, event) {
        selected.forEach((element) => element.dispatch(type, event || { target: element, stopPropagation() {} }))
        return this
      },
      click() {
        return this.trigger('tap')
      },
    }
  }
  function jquery(input) {
    if (Array.isArray(input)) return wrap(input)
    if (input && input.nodeType) return wrap([input])
    return wrap(elements)
  }
  jquery.event = {}
  jquery.fn = jquery.prototype = {}
  return { $: jquery, wrap }
}

function testDedupeRemovesCloneAdvanceHandler() {
  const inGame = makeLayerElement('in-game layer_event_click')
  const clone = makeLayerElement('clone layer_event_click')
  let advances = 0
  inGame.onTap(function () { advances += 1 })
  clone.onTap(function () { advances += 1 })
  const { $, wrap } = makeSetJquery(inGame, clone)

  // the game's polyfill triggers 'tap' on the whole two-element set
  wrap([inGame, clone]).trigger('tap')
  assert.equal(advances, 2, 'before dedupe the set trigger fires twice')

  assert.equal(TouchGuard.dedupeEventLayerTap($), true)
  wrap([inGame, clone]).trigger('tap')
  assert.equal(advances, 3, 'after dedupe only the in-game handler fires')

  assert.equal(TouchGuard.dedupeEventLayerTap($), true, 'dedupe is idempotent')
  assert.equal(TouchGuard.dedupeEventLayerTap(null), false)
  assert.equal(TouchGuard.dedupeEventLayerTap({}), false)
}

function testInstallWrapsInitGameAndDedupes() {
  const inGame = makeLayerElement('in-game layer_event_click')
  const clone = makeLayerElement('clone layer_event_click')
  let advances = 0
  inGame.onTap(function () { advances += 1 })
  clone.onTap(function () { advances += 1 })
  const { $, wrap } = makeSetJquery(inGame, clone)
  const kag = {
    init_game() {},
  }
  assert.equal(TouchGuard.install(kag, $), true)
  assert.equal(TouchGuard.install(kag, $), true, 'install is idempotent')

  kag.init_game()
  wrap([inGame, clone]).trigger('tap')
  assert.equal(advances, 1, 'dedupe runs right after init_game binds the layer')

  assert.equal(TouchGuard.install({}, $), false)
  assert.equal(TouchGuard.install(null, $), false)
}

function testTapPolyfillAllowsBubblingAndAdvancesOnce() {
  const inGame = makeLayerElement('in-game layer_event_click')
  const clone = makeLayerElement('clone layer_event_click')
  let advances = 0
  inGame.onTap(function () { advances += 1 })
  clone.onTap(function () { advances += 1 })
  clone.removeAllTap() // simulate the committed dedupe
  const { $, wrap } = makeTapJquery([inGame, clone])
  assert.equal(TouchGuard.installTapPolyfill($), true)
  assert.equal($.event.tap.__dcNoStopTap, true)
  assert.equal(TouchGuard.installTapPolyfill($), true, 'install is idempotent')
  assert.equal(TouchGuard.installTapPolyfill(null), false)
  assert.equal(TouchGuard.installTapPolyfill({}), false)

  $.event.tap(wrap([inGame, clone]))
  const startEvent = { target: inGame, stopped: false, stopPropagation() { this.stopped = true } }
  inGame.dispatch('touchstart', startEvent)
  assert.equal(startEvent.stopped, false, 'touchstart must bubble so the body tap_effect ripple can fire')

  const endEvent = { target: inGame, stopped: false, stopPropagation() { this.stopped = true } }
  inGame.dispatch('touchend', endEvent)
  assert.equal(advances, 1, 'one touchend advances exactly once with the dedupe in place')
  assert.equal(endEvent.stopped, true, 'touchend keeps the original stopPropagation semantics')
}

function testInstallInstallsPolyfillAndWrapsInitGame() {
  const inGame = makeLayerElement('in-game layer_event_click')
  const clone = makeLayerElement('clone layer_event_click')
  let advances = 0
  inGame.onTap(function () { advances += 1 })
  clone.onTap(function () { advances += 1 })
  const { $ } = makeTapJquery([inGame, clone])
  const kag = { init_game() {} }
  assert.equal(TouchGuard.install(kag, $), true)
  assert.equal($.event.tap.__dcNoStopTap, true, 'install() applies the tap polyfill')
  assert.equal(Boolean(kag.init_game.__dcEventLayerDedupe), true, 'install() wraps init_game')
}

function testBrowserScriptOrder() {
  const guardIndex = indexHtml.indexOf('js/kernel/tyrano-touch-guard.js')
  const adapterIndex = indexHtml.indexOf('js/kernel/tyrano-adapter.js')
  assert.ok(guardIndex >= 0, 'the touch guard script should be loaded')
  assert.ok(adapterIndex > guardIndex, 'the touch guard must load before TyranoAdapter')
}

testDedupeRemovesCloneAdvanceHandler()
testInstallWrapsInitGameAndDedupes()
testTapPolyfillAllowsBubblingAndAdvancesOnce()
testInstallInstallsPolyfillAndWrapsInitGame()
testBrowserScriptOrder()
console.log('Tyrano touch guard tests passed')
