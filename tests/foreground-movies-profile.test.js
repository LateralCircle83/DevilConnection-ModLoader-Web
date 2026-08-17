'use strict'

const assert = require('node:assert/strict')
const vm = require('node:vm')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')
require('../js/profiles/profile-runner.js')
require('../js/profiles/devil-connection-foreground-movies.js')

const movieWithBgPatch = window.DCWeb.DevilConnectionMovieWithBgPatch
const moviePatch = window.DCWeb.DevilConnectionMoviePatch

function sampleMovieWithBg() {
  return [
    'TYRANO.kag.ftag.master_tag.movie_with_bg = {',
    '  kag: TYRANO.kag,',
    "  vital: ['storage'],",
    '  pm: {',
    "    storage: '',",
    "    skip: 'false',",
    "    bgmode: 'false',",
    '  },',
    '  start: function (pm) {',
    "    if ('pc' != $.userenv()) {",
    '      this.kag.layer.showEventLayer()',
    '      if ($.isTyranoPlayer()) this.playVideo(pm)',
    '      else {',
    '        this.kag.layer.showEventLayer()',
    '        this.playVideo(pm)',
    "        $('.tyrano_base').unbind('click.movie')",
    '      }',
    '    } else {',
    '      this.playVideo(pm)',
    '    }',
    '  },',
    '  playVideo: function (pm) {',
    '    var that = this,',
    "      url = './data/video/' + pm.storage,",
    "      video = document.createElement('video')",
    "    const videoId = pm.bgmode === 'true' ? 'bgmovie' : 'fgmovie'",
    '    video.id = videoId',
    '    video.src = url',
    "    video.style.display = 'none'",
    "    if ('true' == pm.bgmode) {",
    '      that.kag.tmp.video_playing = !0',
    '    } else {',
    '      video.style.zIndex = 199999',
    "      video.addEventListener('ended', function (e) {",
    "        $('.tyrano_base').find(`#${videoId}`).remove()",
    "        if ('false' == pm.bgmode && 'false' == pm.skip) {",
    "          $('.layer_event_click').css('display', '')",
    '        }',
    '        that.kag.ftag.nextOrder()',
    '      })',
    "      'true' == pm.skip &&",
    "        $(video).on('click touchstart', function (e) {",
    "          $(video).off('click touchstart')",
    "          $('.tyrano_base').find(`#${videoId}`).remove()",
    '          that.kag.ftag.nextOrder()',
    '        })',
    '    }',
    '    video.load()',
    "    video.addEventListener('canplay', function () {",
    "      video.style.display = ''",
    '      video.play()',
    '    })',
    '  },',
    '}',
  ]
}

function sampleMovie() {
  return [
    'tyrano.plugin.kag.tag.movie = {',
    "  vital: ['storage'],",
    '  start: function (pm) {',
    "    if ('pc' != $.userenv()) {",
    '      this.kag.layer.showEventLayer()',
    '      if ($.isTyranoPlayer()) this.playVideo(pm)',
    '      else {',
    '        this.kag.layer.showEventLayer()',
    '        this.playVideo(pm)',
    "        $('.tyrano_base').unbind('click.movie')",
    '      }',
    '    } else {',
    '      this.playVideo(pm)',
    '    }',
    '  },',
    '  playVideo: function (pm) {',
    '    var that = this,',
    "      video = document.createElement('video')",
    "    const videoId = pm.bgmode === 'true' ? 'bgmovie' : 'fgmovie'",
    "    if ('true' == pm.bgmode) {",
    '      that.kag.tmp.video_playing = !0',
    '    } else {',
    '      video.style.zIndex = 199999',
    "      video.addEventListener('ended', function (e) {",
    "        $('.tyrano_base').find(`#${videoId}`).remove()",
    "        if ('false' == pm.bgmode && 'false' == pm.skip) {",
    "          $('.layer_event_click').css('display', '')",
    '        }',
    '        that.kag.ftag.nextOrder()',
    '      })',
    "      'true' == pm.skip &&",
    "        $(video).on('click touchstart', function (e) {",
    "          $(video).off('click touchstart')",
    "          $('.tyrano_base').find(`#${videoId}`).remove()",
    '          that.kag.ftag.nextOrder()',
    '        })',
    '    }',
    '  },',
    '}',
  ]
}

function testPatchDeclarations() {
  assert.equal(movieWithBgPatch.id, 'devil-connection-movie-with-bg-input-lock')
  assert.equal(movieWithBgPatch.target, 'data/others/plugin/movie_with_bg/movie_with_bg.js')
  assert.equal(movieWithBgPatch.required, true)
  assert.equal(movieWithBgPatch.failure, 'warn-and-continue')
  assert.equal(moviePatch.id, 'devil-connection-movie-input-lock')
  assert.equal(moviePatch.target, 'tyrano/plugins/kag/kag.tag_ext.js')
  assert.equal(moviePatch.required, true)
  assert.equal(moviePatch.failure, 'warn-and-continue')
}

function testTransformBothNewlineStyles() {
  const lf = movieWithBgPatch.transform(sampleMovieWithBg().join('\n'))
  const crlf = movieWithBgPatch.transform(sampleMovieWithBg().join('\r\n'))
  ;[lf, crlf].forEach(function (out) {
    assert.match(out, /this\.kag\.layer\.hideEventLayer\(\)/)
    assert.match(out, /if \('true' != pm\.bgmode\) \{/)
    assert.match(out, /var dc_movie_finished = false/)
    assert.match(out, /dc_finish_movie\(\)/)
    assert.equal(out.split('that.kag.ftag.nextOrder()').length - 1, 1)
    assert.equal(out.split('video.addEventListener').length - 1, 2)
  })
  assert.equal(lf.indexOf('\r\n'), -1)
  assert.ok(crlf.indexOf('\r\n') !== -1)

  const movieLf = moviePatch.transform(sampleMovie().join('\n'))
  assert.match(movieLf, /var dc_movie_finished = false/)
  assert.equal(movieLf.split('that.kag.ftag.nextOrder()').length - 1, 1)
}

function testTransformRejectsBrokenBlock() {
  const broken = sampleMovieWithBg()
  const swap = broken.indexOf('      if ($.isTyranoPlayer()) this.playVideo(pm)')
  broken[swap] = '      if ($.isTyranoPlayer()) this.playVideo(pm + 1)'
  assert.throws(function () { movieWithBgPatch.transform(broken.join('\n')) }, /未匹配/)
}

async function runProfile(patches, readText) {
  let prepared = null
  const resolver = {
    resolve(path) { return { kind: 'base', layerId: 'base-game', path } },
    readText: readText,
    prepareText(path, text, mime) { prepared = { mime, path, text } },
  }
  const result = await window.DCWeb.ProfileRunner.run({
    id: 'foreground-movies-test',
    name: 'Foreground movies test',
    patches: patches,
  }, resolver)
  return { prepared, result }
}

async function testProfileRunnerApplied() {
  const { prepared, result } = await runProfile(
    [movieWithBgPatch, moviePatch],
    function (path) {
      if (path === movieWithBgPatch.target) return Promise.resolve(sampleMovieWithBg().join('\n'))
      if (path === moviePatch.target) return Promise.resolve(sampleMovie().join('\n'))
      return Promise.reject(new Error('unexpected target ' + path))
    },
  )
  assert.equal(result.status, 'ready')
  assert.equal(result.launchAllowed, true)
  assert.equal(result.patches[0].status, 'applied')
  assert.equal(result.patches[1].status, 'applied')
  assert.match(prepared.text, /var dc_movie_finished = false/)
}

async function testModIdenticalCopyStillApplies() {
  let prepared = null
  const resolver = {
    resolve(path) { return { kind: 'mod', layerId: 'mod:movie-copy', path } },
    readText() { return Promise.resolve(sampleMovieWithBg().join('\n')) },
    prepareText(path, text, mime) { prepared = { mime, path, text } },
  }
  const result = await window.DCWeb.ProfileRunner.run({
    id: 'mod-identical-test',
    name: 'Mod identical copy test',
    patches: [movieWithBgPatch],
  }, resolver)
  assert.equal(result.status, 'ready')
  assert.equal(result.patches[0].status, 'applied')
  assert.equal(result.patches[0].sourceKind, 'mod')
  assert.equal(result.patches[0].sourceLayerId, 'mod:movie-copy')
  assert.match(prepared.text, /var dc_movie_finished = false/)
}

async function testUnsupportedSourceWarns() {
  const unsupported = sampleMovieWithBg()
  const index = unsupported.indexOf('      this.kag.layer.showEventLayer()')
  unsupported[index] = '      this.kag.layer.hideEventLayer()'
  const { result } = await runProfile(
    [movieWithBgPatch],
    function () { return Promise.resolve(unsupported.join('\n')) },
  )
  assert.equal(result.status, 'warning')
  assert.equal(result.launchAllowed, true)
  assert.equal(result.patches[0].status, 'unverified')
  assert.match(result.patches[0].message, /预期 2 处，实际 1 处/)
}

async function testMarkerRejectsAlreadyTransformedSource() {
  const transformed = movieWithBgPatch.transform(sampleMovieWithBg().join('\n'))
  const { result } = await runProfile(
    [movieWithBgPatch],
    function () { return Promise.resolve(transformed) },
  )
  assert.equal(result.status, 'warning')
  assert.equal(result.patches[0].status, 'unverified')
  assert.match(result.patches[0].message, /不受支持/)
}

function createMovieEnvironment() {
  const events = { clickDisplay: '', nextOrder: 0, play: 0, removed: 0 }
  const layerEvent = { hidden: false }
  const kag = {
    stat: { is_stop: false },
    tmp: { video_playing: false },
    variable: { sf: {} },
    ftag: { master_tag: {}, nextOrder: function () { events.nextOrder++ } },
    layer: {
      showEventLayer: function () { kag.stat.is_stop = false; layerEvent.hidden = false },
      hideEventLayer: function () { kag.stat.is_stop = true; layerEvent.hidden = true },
      getLayer: function () { return { append: function () {}, css: function () {}, find: function () { return { remove: function () {} } } } },
    },
  }
  kag.layer.kag = kag

  const videoListeners = {}
  const video = {
    style: {},
    setAttribute: function () {},
    load: function () {},
    play: function () { events.play++ },
    addEventListener: function (type, fn) { videoListeners[type] = fn },
    removeEventListener: function () {},
  }

  const jquery = function (selector) {
    if (typeof selector === 'string') {
      if (selector === '.tyrano_base') {
        return {
          unbind: function () { return jquery },
          find: function () { return { remove: function () { events.removed++ } } },
        }
      }
      if (selector === '.layer_event_click') {
        return {
          css: function (name, value) {
            if (value !== undefined) events.clickDisplay = value
            return jquery
          },
          find: function () { return { remove: function () { events.removed++ } } },
        }
      }
      return jquery
    }
    return {
      attr: function (name, value) { return value === undefined ? '' : this },
      addClass: function () { return this },
      css: function (name, value) { if (value !== undefined) video.style[name] = value; return this },
      on: function (types, fn) {
        types.split(/\s+/).forEach(function (type) {
          if (type === 'click') videoListeners.click = fn
        })
        return this
      },
      off: function () { delete videoListeners.click; return this },
      stop: function () { return this },
      animate: function (props, options) {
        if (options && typeof options.complete === 'function') options.complete()
        return this
      },
      get: function () { return video },
      remove: function () { events.removed++ },
    }
  }
  jquery.userenv = function () { return 'mobile' }
  jquery.isTyranoPlayer = function () { return false }
  jquery.getBrowser = function () { return 'chrome' }
  jquery.replaceAll = function () { return '' }

  const env = {
    TYRANO: { kag: kag },
    document: { createElement: function () { return video } },
    $: jquery,
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
  }
  env.window = env
  return { env, events, kag, layerEvent, videoListeners }
}

function defaultPm(overrides) {
  return Object.assign({
    storage: 'hazime3.mp4',
    volume: '0',
    skip: 'false',
    mute: 'false',
    bgmode: 'false',
    loop: 'false',
    bg: 'shiro.webp',
  }, overrides || {})
}

function testForegroundLockAndSingleFinish() {
  const { env, events, kag, layerEvent, videoListeners } = createMovieEnvironment()
  vm.runInNewContext(movieWithBgPatch.transform(sampleMovieWithBg().join('\n')), env)
  const tag = env.TYRANO.kag.ftag.master_tag.movie_with_bg
  tag.start(defaultPm())

  assert.equal(kag.stat.is_stop, true, 'video must lock scenario input before canplay')
  assert.equal(layerEvent.hidden, true, 'event layer must stay hidden before canplay')
  assert.equal(events.nextOrder, 0)

  videoListeners.canplay()
  assert.equal(env.TYRANO.kag.ftag.master_tag.movie_with_bg, tag)
  assert.equal(kag.stat.is_stop, true, 'lock must persist while the video plays')
  assert.equal(events.play, 1)

  videoListeners.ended()
  assert.equal(events.nextOrder, 1, 'ended advances exactly once')
  assert.equal(kag.stat.is_stop, false, 'finish must clear the input lock')
  assert.equal(layerEvent.hidden, false, 'finish must restore the event layer')
  assert.equal(events.clickDisplay, '')
  assert.ok(events.removed >= 1)

  videoListeners.ended()
  assert.equal(events.nextOrder, 1, 'late duplicate ended must be ignored')
}

function testSkipDeduplicatesFinish() {
  const { env, events, videoListeners } = createMovieEnvironment()
  vm.runInNewContext(movieWithBgPatch.transform(sampleMovieWithBg().join('\n')), env)
  const tag = env.TYRANO.kag.ftag.master_tag.movie_with_bg
  tag.start(defaultPm({ skip: 'true' }))
  videoListeners.canplay()
  assert.equal(typeof videoListeners.click, 'function')
  videoListeners.click()
  assert.equal(events.nextOrder, 1)
  videoListeners.ended()
  assert.equal(events.nextOrder, 1, 'ended after skip must not advance again')
}

function testBackgroundMovieKeepsOriginalSemantics() {
  const { env, events, kag, layerEvent } = createMovieEnvironment()
  vm.runInNewContext(movieWithBgPatch.transform(sampleMovieWithBg().join('\n')), env)
  const tag = env.TYRANO.kag.ftag.master_tag.movie_with_bg
  tag.start(defaultPm({ bgmode: 'true' }))
  assert.equal(kag.stat.is_stop, false, 'background movies must not lock input')
  assert.equal(layerEvent.hidden, false, 'background movies keep the original event layer behavior')
  assert.equal(events.nextOrder, 0)
}

async function main() {
  testPatchDeclarations()
  testTransformBothNewlineStyles()
  testTransformRejectsBrokenBlock()
  await testProfileRunnerApplied()
  await testModIdenticalCopyStillApplies()
  await testUnsupportedSourceWarns()
  await testMarkerRejectsAlreadyTransformedSource()
  testForegroundLockAndSingleFinish()
  testSkipDeduplicatesFinish()
  testBackgroundMovieKeepsOriginalSemantics()
  console.log('Foreground movies profile tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
