'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/tyrano-chara-guard.js')

const CharaGuard = window.DCWeb.TyranoCharaGuard
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

function makeCharaTag(kag, kind, applied) {
  return {
    start(pm) {
      const storage = String(pm.storage || '')
      if (kind === 'show') {
        kag.preloadAll(['./data/fgimage/' + storage], function () {
          applied.push('show:' + pm.name + ':' + storage)
        })
      } else {
        kag.preload('./data/fgimage/' + storage, function () {
          applied.push('mod:' + pm.name + ':' + storage)
        })
      }
    },
  }
}

function createKag() {
  const applied = []
  const kag = {
    applied,
    pending: [],
    tag: {},
    ftag: { master_tag: {} },
  }
  kag.preload = function (storage, callback) {
    kag.pending.push({ storage, callback: CharaGuard.guardCallback(kag, storage, callback) })
  }
  kag.preloadAll = function (storages, callback) {
    kag.pending.push({ storage: storages, callback: CharaGuard.guardCallback(kag, storages, callback) })
  }
  kag.tag.chara_show = makeCharaTag(kag, 'show', applied)
  kag.tag.chara_mod = makeCharaTag(kag, 'mod', applied)
  kag.ftag.master_tag.chara_show = makeCharaTag(kag, 'show', applied)
  kag.ftag.master_tag.chara_mod = makeCharaTag(kag, 'mod', applied)
  return kag
}

function runTag(kag, name, pm) {
  kag.ftag.master_tag[name].start.call(kag.ftag.master_tag[name], pm)
}

function testInstallWrapsAndStampsPerName() {
  const kag = createKag()
  assert.equal(CharaGuard.install(kag), true)
  assert.equal(kag.ftag.master_tag.chara_show.start.__dcCharaLatestWins, true)
  assert.equal(kag.ftag.master_tag.chara_mod.start.__dcCharaLatestWins, true)
  assert.equal(kag.tag.chara_show.start.__dcCharaLatestWins, true)
  runTag(kag, 'chara_mod', { name: 'でびるん', storage: 'chara/1/1.png', wait: 'false' })
  runTag(kag, 'chara_mod', { name: 'でびるん', storage: 'chara/1/2.png', wait: 'false' })
  runTag(kag, 'chara_mod', { name: 'クピャドエル', storage: 'chara/14/1.png', wait: 'false' })
  assert.equal(kag.__dcCharaSeq.mod['でびるん'], 2)
  assert.equal(kag.__dcCharaSeq.mod['クピャドエル'], 1)
  assert.equal(kag.__dcCharaSeq.show['でびるん'], undefined)
  assert.equal(kag.__dcCharaWait.mod['でびるん'][1], 'false')
  assert.equal(kag.__dcCharaWait.mod['でびるん'][2], 'false')
}

function testModInvertedCompletionKeepsNewest() {
  const kag = createKag()
  CharaGuard.install(kag)
  runTag(kag, 'chara_mod', { name: 'でびるん', storage: 'chara/1/1.png', wait: 'false' })
  runTag(kag, 'chara_mod', { name: 'でびるん', storage: 'chara/1/2.png', wait: 'false' })
  assert.equal(kag.pending.length, 2)
  kag.pending[1].callback()
  assert.deepEqual(kag.applied, ['mod:でびるん:chara/1/2.png'])
  kag.pending[0].callback()
  assert.deepEqual(kag.applied, ['mod:でびるん:chara/1/2.png'])
}

function testModNormalOrderUnchanged() {
  const kag = createKag()
  CharaGuard.install(kag)
  runTag(kag, 'chara_mod', { name: 'でびるん', storage: 'chara/1/1.png', wait: 'false' })
  assert.equal(kag.pending.length, 1)
  kag.pending[0].callback()
  assert.deepEqual(kag.applied, ['mod:でびるん:chara/1/1.png'])
  runTag(kag, 'chara_mod', { name: 'でびるん', storage: 'chara/1/2.png', wait: 'false' })
  kag.pending[1].callback()
  assert.deepEqual(kag.applied, ['mod:でびるん:chara/1/1.png', 'mod:でびるん:chara/1/2.png'])
}

function testShowNotDroppedByNewerMod() {
  const kag = createKag()
  CharaGuard.install(kag)
  runTag(kag, 'chara_show', { name: 'でびるん', storage: 'chara/35/1.png', wait: 'false' })
  runTag(kag, 'chara_mod', { name: 'でびるん', storage: 'chara/35/2.png', wait: 'false' })
  kag.pending[1].callback()
  assert.deepEqual(kag.applied, ['mod:でびるん:chara/35/2.png'])
  kag.pending[0].callback()
  assert.deepEqual(kag.applied, ['mod:でびるん:chara/35/2.png', 'show:でびるん:chara/35/1.png'])
}

function testShowDroppedByNewerShow() {
  const kag = createKag()
  CharaGuard.install(kag)
  runTag(kag, 'chara_show', { name: 'でびるん', storage: 'chara/35/1.png', wait: 'false' })
  runTag(kag, 'chara_show', { name: 'でびるん', storage: 'chara/35/2.png', wait: 'false' })
  kag.pending[1].callback()
  assert.deepEqual(kag.applied, ['show:でびるん:chara/35/2.png'])
  kag.pending[0].callback()
  assert.deepEqual(kag.applied, ['show:でびるん:chara/35/2.png'])
}

function testWaitTrueDeliveredEvenWhenSuperseded() {
  const kag = createKag()
  CharaGuard.install(kag)
  runTag(kag, 'chara_mod', { name: 'でびるん', storage: 'chara/1/1.png', wait: 'true' })
  runTag(kag, 'chara_mod', { name: 'でびるん', storage: 'chara/1/2.png', wait: 'false' })
  kag.pending[1].callback()
  assert.deepEqual(kag.applied, ['mod:でびるん:chara/1/2.png'])
  kag.pending[0].callback()
  assert.deepEqual(kag.applied, ['mod:でびるん:chara/1/2.png', 'mod:でびるん:chara/1/1.png'])
}

function testDifferentNamesAreIndependent() {
  const kag = createKag()
  CharaGuard.install(kag)
  runTag(kag, 'chara_mod', { name: 'でびるん', storage: 'chara/1/1.png', wait: 'false' })
  runTag(kag, 'chara_mod', { name: 'クピャドエル', storage: 'chara/14/1.png', wait: 'false' })
  runTag(kag, 'chara_mod', { name: 'でびるん', storage: 'chara/1/2.png', wait: 'false' })
  kag.pending[2].callback()
  kag.pending[0].callback()
  kag.pending[1].callback()
  assert.deepEqual(kag.applied, ['mod:でびるん:chara/1/2.png', 'mod:クピャドエル:chara/14/1.png'])
}

function testWithoutContextCallbacksUntouched() {
  const kag = createKag()
  const callback = function () {}
  assert.equal(CharaGuard.guardCallback(kag, './data/fgimage/chara/1/1.png', callback), callback)
}

function testInstallIdempotentAndTracksReplacement() {
  const kag = createKag()
  assert.equal(CharaGuard.install(kag), true)
  const first = kag.ftag.master_tag.chara_mod.start
  assert.equal(CharaGuard.install(kag), true)
  assert.equal(kag.ftag.master_tag.chara_mod.start, first)

  const replacement = function () {}
  kag.ftag.master_tag.chara_mod.start = replacement
  assert.equal(CharaGuard.install(kag), true)
  assert.notEqual(kag.ftag.master_tag.chara_mod.start, replacement)
  assert.equal(kag.ftag.master_tag.chara_mod.start.__dcCharaLatestWins, true)
}

function testUnsupportedRuntimeIsUnchanged() {
  assert.equal(CharaGuard.install(null), false)
  assert.equal(CharaGuard.install({ tag: {}, ftag: {} }), false)
}

function testBrowserScriptOrder() {
  const guardIndex = indexHtml.indexOf('js/kernel/tyrano-chara-guard.js')
  const adapterIndex = indexHtml.indexOf('js/kernel/tyrano-adapter.js')
  assert.ok(guardIndex >= 0, 'the chara guard script should be loaded')
  assert.ok(adapterIndex > guardIndex, 'the chara guard must load before TyranoAdapter')
}

testInstallWrapsAndStampsPerName()
testModInvertedCompletionKeepsNewest()
testModNormalOrderUnchanged()
testShowNotDroppedByNewerMod()
testShowDroppedByNewerShow()
testWaitTrueDeliveredEvenWhenSuperseded()
testDifferentNamesAreIndependent()
testWithoutContextCallbacksUntouched()
testInstallIdempotentAndTracksReplacement()
testUnsupportedRuntimeIsUnchanged()
testBrowserScriptOrder()
console.log('Tyrano chara guard tests passed')
