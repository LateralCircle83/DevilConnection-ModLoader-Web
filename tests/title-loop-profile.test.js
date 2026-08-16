'use strict'

const assert = require('node:assert/strict')
const vm = require('node:vm')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')
require('../js/profiles/profile-runner.js')
require('../js/profiles/devil-connection-title-loop.js')

const patch = window.DCWeb.DevilConnectionTitleLoopPatch

function supportedSource() {
  return [
    'TYRANO.kag.dc = {',
    '  setUpMediaSourceForLoop: function (video, name) {',
    '    mediaSource.addEventListener(\'sourceopen\', function () {',
    '        videoBuffer.appendBuffer(secondaryVideoBuffer)',
    '        audioBuffer.appendBuffer(secondaryAudioBuffer)',
    '        videoBuffer.appendBuffer(secondaryVideoBuffer)',
    '        audioBuffer.appendBuffer(secondaryAudioBuffer)',
    '        TYRANO.kag.dc.loopTimers[`${name}_v`] = setInterval(',
    '          appendVideoLoopBuffer, 1000',
    '        )',
    '          (TYRANO.kag.dc.loopTimers[`${name}_a`] = setInterval(',
    '            appendAudioLoopBuffer, 1000',
    '          ))',
    '    })',
    '  },',
    '  tearDownMediaSourceForLoop: function (name) {',
    '      if (isUpdating) {',
    '        setTimeout(endStream, 10)',
    '      }',
    '  },',
    '}',
    'function removeMovie() {',
    '      URL.revokeObjectURL(url)',
    '}',
  ].join('\n')
}

function runtimeSource() {
  const source = supportedSource()
  return patch.transform(source).slice(source.length)
}

class EventTargetMock {
  constructor() {
    this.listeners = new Map()
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(handler)
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type)
    if (!handlers) return
    handlers.delete(handler)
    if (!handlers.size) this.listeners.delete(type)
  }

  emit(type) {
    const handlers = Array.from(this.listeners.get(type) || [])
    handlers.forEach((handler) => handler({ target: this, type }))
  }

  listenerCount() {
    return Array.from(this.listeners.values()).reduce((total, handlers) => total + handlers.size, 0)
  }
}

class SourceBufferMock extends EventTargetMock {
  constructor(environment, type) {
    super()
    this.environment = environment
    this.type = type
    this.mode = 'segments'
    this.updating = false
    this.timestampOffset = 0
    this.appendWindowStart = 0
    this.appendWindowEnd = Infinity
    this.appendCalls = []
    this.abortCalls = 0
    this.bufferEnd = 0
    this.pendingBuffer = null
    const buffered = {
      end: () => this.bufferEnd,
    }
    Object.defineProperty(buffered, 'length', {
      get: () => this.bufferEnd > 0 ? 1 : 0,
    })
    this.buffered = buffered
  }

  appendBuffer(buffer) {
    if (this.updating) {
      this.environment.concurrentAppendAttempts += 1
      const error = new Error('SourceBuffer is updating')
      error.name = 'InvalidStateError'
      throw error
    }
    if (this.environment.throwOnNextAppend) {
      this.environment.throwOnNextAppend = false
      const error = new Error('Forced append failure')
      error.name = 'InvalidStateError'
      throw error
    }
    this.updating = true
    this.pendingBuffer = buffer
    this.appendCalls.push(buffer.id)
  }

  finishAppend() {
    assert.equal(this.updating, true)
    const buffer = this.pendingBuffer
    const windowEnd = Number(this.appendWindowEnd)
    const nextEnd = Number.isFinite(windowEnd)
      ? windowEnd
      : Number(this.timestampOffset) + Number(buffer.duration)
    this.bufferEnd = Math.max(this.bufferEnd, nextEnd)
    this.pendingBuffer = null
    this.updating = false
    this.emit('updateend')
  }

  abort() {
    this.abortCalls += 1
    this.pendingBuffer = null
    this.updating = false
  }
}

class MediaSourceMock extends EventTargetMock {
  constructor(environment) {
    super()
    this.environment = environment
    this.readyState = 'closed'
    this.sourceBuffers = []
    this.endCalls = 0
    environment.mediaSources.push(this)
  }

  addSourceBuffer(type) {
    const sourceBuffer = new SourceBufferMock(this.environment, type)
    this.sourceBuffers.push(sourceBuffer)
    return sourceBuffer
  }

  removeSourceBuffer(sourceBuffer) {
    const index = this.sourceBuffers.indexOf(sourceBuffer)
    if (index !== -1) this.sourceBuffers.splice(index, 1)
  }

  endOfStream() {
    if (this.sourceBuffers.some((sourceBuffer) => sourceBuffer.updating)) {
      throw new Error('Cannot end while a SourceBuffer is updating')
    }
    this.endCalls += 1
    this.readyState = 'ended'
  }

  open() {
    this.readyState = 'open'
    this.emit('sourceopen')
  }
}

function createEnvironment() {
  const buffers = {
    primaryAudio: { duration: 4, frontPaddingDuration: 0.1, id: 'audio-primary' },
    primaryVideo: { duration: 5, id: 'video-primary' },
    secondaryAudio: { duration: 2, frontPaddingDuration: 0.05, id: 'audio-loop' },
    secondaryVideo: { duration: 2, id: 'video-loop' },
  }
  const environment = {
    concurrentAppendAttempts: 0,
    mediaSources: [],
    nextTimer: 0,
    now: 0,
    revokedUrls: [],
    throwOnNextAppend: false,
    timers: new Map(),
    warnings: [],
  }
  const dc = {
    getLoopBuffers() {
      return [buffers.primaryVideo, buffers.primaryAudio, buffers.secondaryVideo, buffers.secondaryAudio]
    },
    loopTimers: {},
    mediaSources: {},
  }
  const target = {
    MediaSource: function () { return new MediaSourceMock(environment) },
    Promise,
    TYRANO: { kag: { dc } },
    URL: {
      revokeObjectURL(url) { environment.revokedUrls.push(url) },
    },
    clearTimeout(id) { environment.timers.delete(id) },
    console: {
      warn(message) { environment.warnings.push(String(message)) },
    },
    llama: {
      parseGaplessData(buffer) {
        return {
          audioDuration: buffer.duration,
          frontPaddingDuration: buffer.frontPaddingDuration,
        }
      },
    },
    performance: {
      now() { return environment.now },
    },
    setTimeout(handler, delay) {
      const id = ++environment.nextTimer
      environment.timers.set(id, { delay, due: environment.now + delay, handler })
      return id
    },
  }
  target.window = target
  environment.buffers = buffers
  environment.dc = dc
  environment.runTimer = function (id) {
    const timer = environment.timers.get(id)
    assert.ok(timer, 'expected timer ' + id)
    environment.timers.delete(id)
    environment.now = Math.max(environment.now, timer.due)
    timer.handler()
  }
  environment.target = target
  vm.runInNewContext(runtimeSource(), target, { filename: 'devil-connection-title-loop-runtime.js' })
  return environment
}

function createVideo(url) {
  return {
    currentSrc: '',
    playCalls: 0,
    src: url || '',
    play() {
      this.playCalls += 1
      return Promise.resolve()
    },
  }
}

async function drainMicrotasks() {
  for (let index = 0; index < 6; index++) await Promise.resolve()
}

async function prepareInitialLoops(environment, video) {
  const mediaSource = environment.dc.setUpMediaSourceForLoop(video, 'title')
  mediaSource.open()
  const videoBuffer = mediaSource.sourceBuffers[0]
  const audioBuffer = mediaSource.sourceBuffers[1]
  await drainMicrotasks()
  assert.deepEqual(videoBuffer.appendCalls, ['video-primary'])
  assert.deepEqual(audioBuffer.appendCalls, ['audio-primary'])

  videoBuffer.finishAppend()
  audioBuffer.finishAppend()
  await drainMicrotasks()
  assert.deepEqual(videoBuffer.appendCalls, ['video-primary', 'video-loop'])
  assert.deepEqual(audioBuffer.appendCalls, ['audio-primary', 'audio-loop'])

  videoBuffer.finishAppend()
  audioBuffer.finishAppend()
  await drainMicrotasks()
  assert.equal(video.playCalls, 1)
  return { audioBuffer, mediaSource, videoBuffer }
}

async function testSerialAppendAndTeardown() {
  const environment = createEnvironment()
  const video = createVideo('blob:title-one')
  const { audioBuffer, mediaSource, videoBuffer } = await prepareInitialLoops(environment, video)
  const firstVideoTimer = environment.dc.loopTimers.title_v
  const firstAudioTimer = environment.dc.loopTimers.title_a
  assert.ok(firstVideoTimer)
  assert.ok(firstAudioTimer)

  environment.runTimer(firstVideoTimer)
  await drainMicrotasks()
  assert.equal(videoBuffer.updating, true)
  assert.deepEqual(videoBuffer.appendCalls, ['video-primary', 'video-loop', 'video-loop'])
  assert.equal(environment.dc.loopTimers.title_v, undefined)
  environment.now += 250
  videoBuffer.finishAppend()
  await drainMicrotasks()
  const nextVideoTimer = environment.dc.loopTimers.title_v
  assert.ok(nextVideoTimer)
  assert.notEqual(nextVideoTimer, firstVideoTimer)
  assert.equal(environment.timers.get(nextVideoTimer).delay, 1750)

  environment.runTimer(firstAudioTimer)
  await drainMicrotasks()
  assert.equal(audioBuffer.updating, true)
  assert.equal(environment.concurrentAppendAttempts, 0)
  assert.equal(environment.dc.tearDownMediaSourceForLoop('title'), true)
  await drainMicrotasks()

  assert.equal(audioBuffer.abortCalls, 1)
  assert.equal(videoBuffer.listenerCount(), 0)
  assert.equal(audioBuffer.listenerCount(), 0)
  assert.equal(mediaSource.listenerCount(), 0)
  assert.equal(mediaSource.readyState, 'ended')
  assert.equal(mediaSource.sourceBuffers.length, 0)
  assert.equal(environment.timers.size, 0)
  assert.equal(environment.dc.mediaSources.title, undefined)
  assert.equal(environment.dc.__dcTitleLoopQueuePatch.states.title, undefined)
  assert.deepEqual(environment.revokedUrls, ['blob:title-one'])
  assert.equal(environment.concurrentAppendAttempts, 0)
}

async function testDuplicateSetupReleasesPreviousInstance() {
  const environment = createEnvironment()
  const firstVideo = createVideo('blob:title-old')
  const firstMediaSource = environment.dc.setUpMediaSourceForLoop(firstVideo, 'title')
  firstMediaSource.open()
  const oldBuffers = firstMediaSource.sourceBuffers.slice()

  const secondVideo = createVideo('blob:title-new')
  const secondMediaSource = environment.dc.setUpMediaSourceForLoop(secondVideo, 'title')
  await drainMicrotasks()
  assert.equal(oldBuffers[0].abortCalls, 1)
  assert.equal(oldBuffers[1].abortCalls, 0)
  assert.equal(oldBuffers.every((sourceBuffer) => !sourceBuffer.updating && sourceBuffer.listenerCount() === 0), true)
  assert.equal(firstMediaSource.sourceBuffers.length, 0)
  assert.equal(environment.dc.mediaSources.title, secondMediaSource)
  assert.deepEqual(environment.revokedUrls, ['blob:title-old'])

  assert.equal(environment.dc.tearDownMediaSourceForLoop('title'), true)
  assert.equal(environment.dc.tearDownMediaSourceForLoop('title'), false)
  assert.deepEqual(environment.revokedUrls, ['blob:title-old', 'blob:title-new'])
}

async function testAppendFailureCleansUp() {
  const environment = createEnvironment()
  environment.throwOnNextAppend = true
  const video = createVideo('blob:title-failed')
  const mediaSource = environment.dc.setUpMediaSourceForLoop(video, 'title')
  mediaSource.open()
  await drainMicrotasks()

  assert.equal(environment.warnings.length, 1)
  assert.match(environment.warnings[0], /Forced append failure/)
  assert.equal(environment.dc.mediaSources.title, undefined)
  assert.equal(environment.dc.__dcTitleLoopQueuePatch.states.title, undefined)
  assert.equal(environment.timers.size, 0)
  assert.equal(mediaSource.sourceBuffers.length, 0)
  assert.deepEqual(environment.revokedUrls, ['blob:title-failed'])
}

async function testSourceBufferErrorCleansUp() {
  const environment = createEnvironment()
  const video = createVideo('blob:title-buffer-error')
  const mediaSource = environment.dc.setUpMediaSourceForLoop(video, 'title')
  mediaSource.open()
  await drainMicrotasks()
  const videoBuffer = mediaSource.sourceBuffers[0]
  const audioBuffer = mediaSource.sourceBuffers[1]

  audioBuffer.emit('error')
  await drainMicrotasks()
  assert.equal(environment.warnings.length, 1)
  assert.match(environment.warnings[0], /Audio SourceBuffer rejected a segment/)
  assert.equal(videoBuffer.abortCalls, 1)
  assert.equal(audioBuffer.abortCalls, 1)
  assert.equal(videoBuffer.listenerCount(), 0)
  assert.equal(audioBuffer.listenerCount(), 0)
  assert.equal(environment.dc.mediaSources.title, undefined)
  assert.equal(environment.dc.__dcTitleLoopQueuePatch.states.title, undefined)
  assert.equal(environment.timers.size, 0)
  assert.deepEqual(environment.revokedUrls, ['blob:title-buffer-error'])
}

async function testStrictProfileTransform() {
  const source = supportedSource()
  let prepared = null
  const exactMod = await window.DCWeb.ProfileRunner.run({ id: 'title-loop', patches: [patch] }, {
    resolve(path) { return { kind: 'mod', layerId: 'mod:exact-title-loop', path } },
    readText() { return Promise.resolve(source) },
    prepareText(path, text, mime) { prepared = { mime, path, text } },
  })
  assert.equal(exactMod.status, 'ready')
  assert.equal(exactMod.patches[0].status, 'applied')
  assert.equal(exactMod.patches[0].sourceLayerId, 'mod:exact-title-loop')
  assert.equal(prepared.path, patch.target)
  assert.equal(prepared.mime, 'text/javascript;charset=utf-8')
  assert.match(prepared.text, /__dcTitleLoopQueuePatch/)
  assert.doesNotMatch(source, /__dcTitleLoopQueuePatch/)

  const warning = await window.DCWeb.ProfileRunner.run({ id: 'title-loop-unknown', patches: [patch] }, {
    resolve(path) { return { kind: 'mod', layerId: 'mod:unknown-title-loop', path } },
    readText() { return Promise.resolve(source.replace('setTimeout(endStream, 10)', 'setTimeout(endStream, 20)')) },
  })
  assert.equal(warning.status, 'warning')
  assert.equal(warning.launchAllowed, true)
  assert.equal(warning.patches[0].status, 'unverified')
  assert.match(warning.patches[0].message, /预期 1 处，实际 0 处/)
}

async function main() {
  assert.equal(patch.id, 'devil-connection-title-loop-sourcebuffer-queue')
  assert.equal(patch.target, 'data/others/plugin/title_loop/main.js')
  assert.equal(patch.required, true)
  assert.equal(patch.failure, 'warn-and-continue')
  assert.equal(patch.unsupportedMod, undefined)
  await testSerialAppendAndTeardown()
  await testDuplicateSetupReleasesPreviousInstance()
  await testAppendFailureCleansUp()
  await testSourceBufferErrorCleansUp()
  await testStrictProfileTransform()
  console.log('Title loop profile tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
