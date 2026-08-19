'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/tyrano-video-unlock.js')

const VideoUnlock = window.DCWeb.TyranoVideoUnlock
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

function createDocument() {
  const attributes = {}
  const listeners = []
  const windowListeners = []
  const doc = {
    contains() { return true },
    defaultView: {
      addEventListener(type, listener) { windowListeners.push({ type, listener }) },
      removeEventListener(type, listener) {
        const index = windowListeners.findIndex((entry) => entry.type === type && entry.listener === listener)
        if (index !== -1) windowListeners.splice(index, 1)
      },
    },
    documentElement: {
      setAttribute(name, value) { attributes[name] = value },
    },
    listeners,
    windowListeners,
    addEventListener(type, listener) { listeners.push({ type, listener }) },
    removeEventListener(type, listener) {
      const index = listeners.findIndex((entry) => entry.type === type && entry.listener === listener)
      if (index !== -1) listeners.splice(index, 1)
    },
  }
  return { attributes, doc, listeners, windowListeners }
}

function createVideo(doc, script) {
  const steps = (script || []).slice()
  const video = {
    __calls: 0,
    ended: false,
    isConnected: true,
    muted: false,
    ownerDocument: doc,
    play() {
      video.__calls++
      const step = steps.shift() || { resolve: true }
      return step.reject ? Promise.reject(step.error) : Promise.resolve()
    },
  }
  return video
}

function createKag(doc, initialMovie, initialMovieWithBg) {
  const videos = []
  const kag = {
    ftag: { master_tag: {} },
    layer: {
      getLayer() {
        return {
          find() { return videos },
        }
      },
    },
    tag: {},
  }
  if (initialMovie) kag.tag.movie = initialMovie
  if (initialMovieWithBg) kag.ftag.master_tag.movie_with_bg = initialMovieWithBg

  function movieTagFactory(pm) {
    const tag = {
      kag,
      start(pm) {
        const video = createVideo(doc, pm.script || [])
        video.muted = Boolean(pm.muted)
        videos.push(video)
        return video
      },
    }
    return tag
  }
  return { kag, movieTagFactory, videos }
}

function gestureCount(doc) {
  return doc.listeners.filter((entry) => entry.type === 'pointerdown' || entry.type === 'touchend' || entry.type === 'keydown').length
}

function fireGesture(doc) {
  doc.listeners
    .filter((entry) => entry.type === 'pointerdown' || entry.type === 'touchend' || entry.type === 'keydown')
    .forEach((entry) => entry.listener())
}

async function testAutoplayBlockedVideoReplaysMutedAndRestoresOnGesture() {
  const env = createDocument()
  const harness = createKag(env.doc)
  const tag = harness.movieTagFactory()
  harness.kag.tag.movie = tag

  assert.equal(VideoUnlock.install(harness.kag), true)
  assert.equal(tag.start.__dcVideoUnlockStart, true)

  const video = tag.start({ script: [
    { reject: true, error: { name: 'NotAllowedError' } },
    { resolve: true },
    { resolve: true },
  ] })
  assert.equal(video.__dcVideoUnlockPlay, true)

  await assert.rejects(video.play(), (error) => error && error.name === 'NotAllowedError')
  assert.equal(video.__calls, 2)
  assert.equal(video.muted, true)
  assert.equal(gestureCount(env.doc), 3)
  assert.equal(env.attributes['data-dc-video-unlock-pending'], '1')

  fireGesture(env.doc)
  assert.equal(video.muted, false)
  assert.equal(video.__calls, 3)
  assert.equal(gestureCount(env.doc), 0)
  assert.equal(env.attributes['data-dc-video-unlock-pending'], '0')
}

async function testAllowedAutoplayLeavesVideoUntouched() {
  const env = createDocument()
  const harness = createKag(env.doc)
  const tag = harness.movieTagFactory()
  harness.kag.tag.movie = tag
  VideoUnlock.install(harness.kag)

  const video = tag.start({})
  await video.play()
  assert.equal(video.muted, false)
  assert.equal(video.__calls, 1)
  assert.equal(gestureCount(env.doc), 0)
  assert.equal(env.attributes['data-dc-video-unlock-pending'], undefined)
}

async function testGameRequestedMuteStaysMuted() {
  const env = createDocument()
  const harness = createKag(env.doc)
  const tag = harness.movieTagFactory()
  harness.kag.tag.movie = tag
  VideoUnlock.install(harness.kag)

  const video = tag.start({ muted: true, script: [
    { reject: true, error: { name: 'NotAllowedError' } },
    { resolve: true },
    { resolve: true },
  ] })
  await assert.rejects(video.play(), (error) => error && error.name === 'NotAllowedError')
  assert.equal(video.muted, true)

  fireGesture(env.doc)
  assert.equal(video.muted, true)
  assert.equal(video.__calls, 3)
}

async function testEndedVideoIsNotRestarted() {
  const env = createDocument()
  const harness = createKag(env.doc)
  const tag = harness.movieTagFactory()
  harness.kag.tag.movie = tag
  VideoUnlock.install(harness.kag)

  const video = tag.start({ script: [
    { reject: true, error: { name: 'NotAllowedError' } },
    { resolve: true },
  ] })
  await assert.rejects(video.play(), (error) => error && error.name === 'NotAllowedError')
  video.ended = true

  fireGesture(env.doc)
  assert.equal(video.muted, false)
  assert.equal(video.__calls, 2)
}

async function testRemovedVideoIsNotRestarted() {
  const env = createDocument()
  const harness = createKag(env.doc)
  const tag = harness.movieTagFactory()
  harness.kag.tag.movie = tag
  VideoUnlock.install(harness.kag)

  const video = tag.start({ script: [
    { reject: true, error: { name: 'NotAllowedError' } },
    { resolve: true },
  ] })
  await assert.rejects(video.play(), (error) => error && error.name === 'NotAllowedError')
  video.isConnected = false

  fireGesture(env.doc)
  assert.equal(video.__calls, 2)
}

async function testLateTagRegistrationIsWrapped() {
  const env = createDocument()
  const harness = createKag(env.doc)
  assert.equal(VideoUnlock.install(harness.kag), true)

  const lateMovie = harness.movieTagFactory()
  harness.kag.tag.movie = lateMovie
  assert.equal(lateMovie.start.__dcVideoUnlockStart, true)

  const lateWithBg = harness.movieTagFactory()
  harness.kag.ftag.master_tag.movie_with_bg = lateWithBg
  assert.equal(lateWithBg.start.__dcVideoUnlockStart, true)

  const video = lateWithBg.start({})
  assert.equal(video.__dcVideoUnlockPlay, true)
}

async function testIdempotentInstallAndReplacement() {
  const harness = createKag(createDocument().doc)
  const tag = harness.movieTagFactory()
  harness.kag.tag.movie = tag
  assert.equal(VideoUnlock.install(harness.kag), true)
  const firstWrapper = tag.start
  assert.equal(VideoUnlock.install(harness.kag), true)
  assert.equal(tag.start, firstWrapper)

  const replacement = function () { return null }
  tag.start = replacement
  assert.equal(VideoUnlock.install(harness.kag), true)
  assert.notEqual(tag.start, replacement)
  assert.equal(tag.start.__dcVideoUnlockStart, true)
}

async function testNonAutoplayRejectionIsIgnored() {
  const env = createDocument()
  const harness = createKag(env.doc)
  const tag = harness.movieTagFactory()
  harness.kag.tag.movie = tag
  VideoUnlock.install(harness.kag)

  const video = tag.start({ script: [{ reject: true, error: { name: 'AbortError' } }] })
  await assert.rejects(video.play(), (error) => error && error.name === 'AbortError')
  assert.equal(video.muted, false)
  assert.equal(video.__calls, 1)
  assert.equal(gestureCount(env.doc), 0)
}

function testUnsupportedRuntimeIsUnchanged() {
  assert.equal(VideoUnlock.install(null), false)
  assert.equal(VideoUnlock.install({}), false)
  assert.equal(VideoUnlock.install({ tag: {}, ftag: {} }), false)
}

function testBrowserScriptOrder() {
  const guardIndex = indexHtml.indexOf('js/kernel/tyrano-video-unlock.js')
  const adapterIndex = indexHtml.indexOf('js/kernel/tyrano-adapter.js')
  assert.ok(guardIndex >= 0, 'the video unlock script should be loaded')
  assert.ok(adapterIndex > guardIndex, 'the video unlock must load before TyranoAdapter')
}

async function main() {
  await testAutoplayBlockedVideoReplaysMutedAndRestoresOnGesture()
  await testAllowedAutoplayLeavesVideoUntouched()
  await testGameRequestedMuteStaysMuted()
  await testEndedVideoIsNotRestarted()
  await testRemovedVideoIsNotRestarted()
  await testLateTagRegistrationIsWrapped()
  await testIdempotentInstallAndReplacement()
  await testNonAutoplayRejectionIsIgnored()
  testUnsupportedRuntimeIsUnchanged()
  testBrowserScriptOrder()
  console.log('Tyrano video unlock tests passed')
}

main().catch((error) => { console.error(error); process.exit(1) })
