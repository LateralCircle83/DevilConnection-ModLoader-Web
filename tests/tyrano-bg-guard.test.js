'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/tyrano-bg-guard.js')

const BgGuard = window.DCWeb.TyranoBgGuard
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

function makeBgTag(kag, applied) {
  return {
    start(pm) {
      if (String(pm.time) === '0' || Number(pm.time) === 0) pm.wait = 'false'
      const storage = String(pm.storage || '')
      kag.preload('./data/bgimage/' + storage, function () { applied.push(storage) })
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
    kag.pending.push({ storage, callback: BgGuard.guardCallback(kag, storage, callback) })
  }
  kag.tag.bg = makeBgTag(kag, applied)
  kag.tag.bg2 = makeBgTag(kag, applied)
  kag.ftag.master_tag.bg = makeBgTag(kag, applied)
  kag.ftag.master_tag.bg2 = makeBgTag(kag, applied)
  return kag
}

function runTag(kag, name, pm) {
  kag.ftag.master_tag[name].start.call(kag.ftag.master_tag[name], pm)
}

function testInstallWrapsAndStampsRequests() {
  const kag = createKag()
  assert.equal(BgGuard.install(kag), true)
  assert.equal(kag.ftag.master_tag.bg.start.__dcBgLatestWins, true)
  assert.equal(kag.ftag.master_tag.bg2.start.__dcBgLatestWins, true)
  assert.equal(kag.tag.bg.start.__dcBgLatestWins, true)
  runTag(kag, 'bg', { storage: 'kuro.webp', time: '0' })
  runTag(kag, 'bg', { storage: 'haikei2.webp', time: '0' })
  assert.equal(kag.__dcBgSeq, 2)
  assert.equal(kag.__dcBgWaitBySeq[1], 'false')
  assert.equal(kag.__dcBgWaitBySeq[2], 'false')
}

function testInvertedCompletionKeepsNewest() {
  const kag = createKag()
  BgGuard.install(kag)
  runTag(kag, 'bg', { storage: 'kuro.webp', time: '0' })
  runTag(kag, 'bg', { storage: 'haikei2.webp', time: '0' })
  assert.equal(kag.pending.length, 2)
  kag.pending[1].callback()
  assert.deepEqual(kag.applied, ['haikei2.webp'])
  kag.pending[0].callback()
  assert.deepEqual(kag.applied, ['haikei2.webp'])
}

function testNormalOrderUnchanged() {
  const kag = createKag()
  BgGuard.install(kag)
  runTag(kag, 'bg', { storage: 'kuro.webp', time: '0' })
  assert.equal(kag.pending.length, 1)
  kag.pending[0].callback()
  assert.deepEqual(kag.applied, ['kuro.webp'])
  runTag(kag, 'bg', { storage: 'haikei2.webp', time: '0' })
  assert.equal(kag.pending.length, 2)
  kag.pending[1].callback()
  assert.deepEqual(kag.applied, ['kuro.webp', 'haikei2.webp'])
}

function testWaitTrueDeliveredEvenWhenSuperseded() {
  const kag = createKag()
  BgGuard.install(kag)
  runTag(kag, 'bg', { storage: 'A.webp', time: '1000', wait: 'true' })
  runTag(kag, 'bg', { storage: 'B.webp', time: '0' })
  kag.pending[1].callback()
  assert.deepEqual(kag.applied, ['B.webp'])
  kag.pending[0].callback()
  assert.deepEqual(kag.applied, ['B.webp', 'A.webp'])
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function testMovieWithBgLateWriteCorrected() {
  const playListeners = []
  const video = {
    addEventListener(type, listener) {
      if (type === 'play') playListeners.push(listener)
    },
  }
  window.document = {
    getElementById(id) { return id === 'fgmovie' ? video : null },
  }
  const kag = createKag()
  kag.layer = {
    getLayer() {
      return {
        css(property, value) {
          if (property === 'background-image') kag.applied.push(value)
        },
      }
    },
  }
  kag.ftag.master_tag.movie_with_bg = {
    start(pm) {
      const targetVideo = window.document.getElementById('fgmovie')
      targetVideo.addEventListener('play', function () {
        setTimeout(function () {
          kag.layer.getLayer('base', 'fore').css('background-image', 'url(./data/bgimage/' + pm.bg + ')')
        }, 100)
      })
    },
  }
  kag.ftag.master_tag.movie_with_bg.kag = kag
  assert.equal(BgGuard.install(kag), true)
  assert.equal(kag.ftag.master_tag.movie_with_bg.start.__dcBgMovieLatestWins, true)

  kag.ftag.master_tag.movie_with_bg.start.call(kag.ftag.master_tag.movie_with_bg, { bg: 'X.webp' })
  runTag(kag, 'bg', { storage: 'Y.webp', time: '0' })
  kag.pending[0].callback()
  assert.deepEqual(kag.applied, ['Y.webp'])

  playListeners.slice().forEach(function (listener) { listener() })
  await sleep(260)
  assert.deepEqual(kag.applied, ['Y.webp', 'url(./data/bgimage/X.webp)', 'url(./data/bgimage/Y.webp)'])
}

function testNonBackgroundCallbacksUntouched() {
  const kag = createKag()
  const callback = function () {}
  assert.equal(BgGuard.guardCallback(kag, './data/fgimage/chara/1/1.png', callback), callback)
  assert.equal(BgGuard.guardCallback(kag, ['one.mp4', 'two.mp4'], callback), callback)
  assert.equal(BgGuard.guardCallback(kag, 'tyrano/audio/silent.mp3', callback), callback)
  const guarded = BgGuard.guardCallback(kag, './data/bgimage/haikei2.webp', callback)
  assert.notEqual(guarded, callback)
  assert.equal(typeof guarded, 'function')
}

function testInstallIdempotentAndTracksReplacement() {
  const kag = createKag()
  assert.equal(BgGuard.install(kag), true)
  const first = kag.ftag.master_tag.bg.start
  assert.equal(BgGuard.install(kag), true)
  assert.equal(kag.ftag.master_tag.bg.start, first)

  const replacement = function () {}
  kag.ftag.master_tag.bg.start = replacement
  assert.equal(BgGuard.install(kag), true)
  assert.notEqual(kag.ftag.master_tag.bg.start, replacement)
  assert.equal(kag.ftag.master_tag.bg.start.__dcBgLatestWins, true)
}

function testUnsupportedRuntimeIsUnchanged() {
  assert.equal(BgGuard.install(null), false)
  assert.equal(BgGuard.install({ tag: {}, ftag: {} }), false)
  assert.equal(BgGuard.install({ tag: {}, ftag: { master_tag: {} }, preload() {} }), false)
}

function testBrowserScriptOrder() {
  const guardIndex = indexHtml.indexOf('js/kernel/tyrano-bg-guard.js')
  const adapterIndex = indexHtml.indexOf('js/kernel/tyrano-adapter.js')
  assert.ok(guardIndex >= 0, 'the bg guard script should be loaded')
  assert.ok(adapterIndex > guardIndex, 'the bg guard must load before TyranoAdapter')
}

testInstallWrapsAndStampsRequests()
testInvertedCompletionKeepsNewest()
testNormalOrderUnchanged()
testWaitTrueDeliveredEvenWhenSuperseded()
testNonBackgroundCallbacksUntouched()
testInstallIdempotentAndTracksReplacement()
testUnsupportedRuntimeIsUnchanged()
testBrowserScriptOrder()
testMovieWithBgLateWriteCorrected().then(function () {
  console.log('Tyrano bg guard tests passed')
}, function (error) {
  console.error(error)
  process.exitCode = 1
})
