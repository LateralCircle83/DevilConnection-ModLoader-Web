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
  const tapHandlers = []
  const node = {
    name,
    tapHandlers,
    onTap(fn) { tapHandlers.push(fn) },
    removeAllTap() { tapHandlers.length = 0 },
    fireTap() { tapHandlers.slice().forEach((fn) => fn()) },
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

function testBrowserScriptOrder() {
  const guardIndex = indexHtml.indexOf('js/kernel/tyrano-touch-guard.js')
  const adapterIndex = indexHtml.indexOf('js/kernel/tyrano-adapter.js')
  assert.ok(guardIndex >= 0, 'the touch guard script should be loaded')
  assert.ok(adapterIndex > guardIndex, 'the touch guard must load before TyranoAdapter')
}

testDedupeRemovesCloneAdvanceHandler()
testInstallWrapsInitGameAndDedupes()
testBrowserScriptOrder()
console.log('Tyrano touch guard tests passed')
