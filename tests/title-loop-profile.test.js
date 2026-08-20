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

function box(type, payload) {
  const size = Buffer.alloc(4)
  size.writeUInt32BE(payload.length + 8)
  return Buffer.concat([size, Buffer.from(type, 'ascii'), payload])
}

function miniFragmentedVideo(firstCts, timescale) {
  // 最小 fragmented MP4：moov(trak(tkhd, mdia(mdhd))) + moof(traf(tfhd, tfdt, trun))
  const tkhd = Buffer.alloc(20)
  tkhd.writeUInt32BE(1, 12) // version 0，track id 位于 +12
  const mdhd = Buffer.alloc(16)
  mdhd.writeUInt32BE(timescale, 12) // version 0，timescale 位于 +12
  const trak = box('trak', Buffer.concat([box('tkhd', tkhd), box('mdia', box('mdhd', mdhd))]))
  const moov = box('moov', trak)
  const tfhd = Buffer.from([0, 0, 0, 0x38, 0, 0, 0, 1]) // flags 0x38，track id 1
  const tfdt = Buffer.alloc(8)
  tfdt.writeUInt32BE(0, 4) // version 0，baseMediaDecodeTime = 0
  const trun = Buffer.alloc(12)
  trun.writeUInt32BE(0x0800, 0) // version 0，flags 0x800（含 composition offset）
  trun.writeUInt32BE(1, 4) // 1 个样本
  trun.writeInt32BE(firstCts, 8)
  const traf = box('traf', Buffer.concat([box('tfhd', tfhd), box('tfdt', tfdt), box('trun', trun)]))
  const moof = box('moof', traf)
  return Buffer.concat([box('ftyp', Buffer.from('isom', 'ascii')), moov, moof])
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
    this._mode = 'segments'
    this.modeAssignments = []
    this.updating = false
    this.timestampOffset = 0
    this.appendWindowStart = 0
    this.appendWindowEnd = Infinity
    this.appendCalls = []
    this.appendStates = []
    this.abortCalls = 0
    this.bufferEnd = 0
    this.pendingBuffer = null
    this.pendingRemove = null
    this.removeCalls = undefined
    const buffered = {
      end: () => this.bufferEnd,
    }
    Object.defineProperty(buffered, 'length', {
      get: () => this.bufferEnd > 0 ? 1 : 0,
    })
    this.buffered = buffered
  }

  get mode() {
    return this._mode
  }

  set mode(value) {
    this.modeAssignments.push(value)
    this._mode = value
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
    if (this.environment.throwQuotaOnNextAppend) {
      this.environment.throwQuotaOnNextAppend = false
      const error = new Error('The quota has been exceeded.')
      error.name = 'QuotaExceededError'
      throw error
    }
    this.updating = true
    this.pendingBuffer = buffer
    this.appendCalls.push(buffer.id)
    this.appendStates.push({
      appendWindowEnd: this.appendWindowEnd,
      appendWindowStart: this.appendWindowStart,
      id: buffer.id,
      timestampOffset: this.timestampOffset,
    })
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

  remove(start, end) {
    if (this.updating) {
      this.environment.concurrentAppendAttempts += 1
      const error = new Error('SourceBuffer is updating')
      error.name = 'InvalidStateError'
      throw error
    }
    if (!this.removeCalls) this.removeCalls = []
    this.removeCalls.push([start, end])
    this.pendingRemove = { start, end }
    this.updating = true
  }

  finishRemove() {
    assert.equal(this.updating, true)
    this.pendingRemove = null
    this.updating = false
    this.emit('updateend')
  }

  abort() {
    this.abortCalls += 1
    this.pendingBuffer = null
    this.pendingRemove = null
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
    if (type === 'audio/mpeg' && this.environment.throwOnAudioSourceBuffer) {
      const error = new Error('audio/mpeg SourceBuffer is not supported')
      error.name = 'NotSupportedError'
      throw error
    }
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
    audioElement: null,
    concurrentAppendAttempts: 0,
    audioMseSupported: true,
    blobs: [],
    mediaSources: [],
    nextUrl: 0,
    nextTimer: 0,
    now: 0,
    objectUrls: [],
    revokedUrls: [],
    throwOnNextAppend: false,
    throwQuotaOnNextAppend: false,
    throwOnAudioSourceBuffer: false,
    timers: new Map(),
    warnings: [],
  }
  const audioElement = {
    endedHandlers: [],
    environment: environment,
    loop: false,
    parentNode: null,
    pauseCalls: 0,
    playCalls: 0,
    src: '',
    volume: 1,
    addEventListener(type, handler) {
      if (type === 'ended') this.endedHandlers.push(handler)
    },
    pause() {
      this.pauseCalls += 1
    },
    play() {
      this.playCalls += 1
      return Promise.resolve()
    },
    fireEnded() {
      this.endedHandlers.slice().forEach((handler) => handler({ target: this }))
    },
  }
  environment.audioElement = audioElement
  const dc = {
    getLoopBuffers() {
      return [buffers.primaryVideo, buffers.primaryAudio, buffers.secondaryVideo, buffers.secondaryAudio]
    },
    loadLoopBuffers() {
      return Promise.resolve()
    },
    loopTimers: {},
    mediaSources: {},
  }
  const target = {
    Blob: function (parts, options) {
      const record = { options: options || {}, parts: parts }
      environment.blobs.push(record)
      return record
    },
    MediaSource: function () { return new MediaSourceMock(environment) },
    Promise,
    TYRANO: { kag: { dc } },
    URL: {
      createObjectURL() {
        const url = 'blob:mock-' + (++environment.nextUrl)
        environment.objectUrls.push(url)
        return url
      },
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
    document: {
      body: {
        appendChild(node) { node.parentNode = this },
        removeChild(node) { node.parentNode = null },
      },
      createElement(tag) {
        return tag === 'audio' ? audioElement : {}
      },
      documentElement: { appendChild() {} },
    },
  }
  target.MediaSource.isTypeSupported = function (type) {
    return environment.audioMseSupported !== false
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
  const video = new EventTargetMock()
  video.currentTime = 0
  video.currentSrc = ''
  video.loadCalls = 0
  video.pauseCalls = 0
  video.paused = true
  video.playCalls = 0
  video.removedAttrs = []
  video.src = url || ''
  video.volume = 1
  video.load = function () {
    this.loadCalls += 1
  }
  video.pause = function () {
    this.pauseCalls += 1
    this.paused = true
  }
  video.play = function () {
    this.playCalls += 1
    this.paused = false
    return Promise.resolve()
  }
  video.removeAttribute = function (name) {
    this.removedAttrs.push(name)
  }
  return video
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
  // WebKit Bug 157539: 视频必须保持 segments 模式（片内时间戳 + timestampOffset
  // 串接），只有无时间戳的 MP3 音频才使用 sequence 模式。
  assert.equal(videoBuffer.mode, 'segments')
  assert.equal(audioBuffer.mode, 'sequence')
  assert.deepEqual(videoBuffer.modeAssignments, ['segments'])
  assert.deepEqual(audioBuffer.modeAssignments, ['sequence'])
  assert.deepEqual(videoBuffer.appendCalls, ['video-primary'])
  assert.deepEqual(audioBuffer.appendCalls, ['audio-primary'])
  // 默认首帧偏移为 0：主段从 0 开始，循环段直接接在 bufferedEnd 之后
  assert.equal(videoBuffer.appendStates[0].timestampOffset, 0)
  assert.equal(audioBuffer.appendStates[0].timestampOffset, -0.1)
  assert.equal(audioBuffer.appendStates[0].appendWindowStart, 0)
  assert.equal(audioBuffer.appendStates[0].appendWindowEnd, 4)

  videoBuffer.finishAppend()
  audioBuffer.finishAppend()
  await drainMicrotasks()
  assert.deepEqual(videoBuffer.appendCalls, ['video-primary', 'video-loop'])
  assert.deepEqual(audioBuffer.appendCalls, ['audio-primary', 'audio-loop'])
  assert.equal(videoBuffer.appendStates[1].timestampOffset, 5)
  assert.equal(audioBuffer.appendStates[1].timestampOffset, 3.95)
  assert.equal(audioBuffer.appendStates[1].appendWindowStart, 4)
  assert.equal(audioBuffer.appendStates[1].appendWindowEnd, 6)

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
  assert.ok(video.pauseCalls >= 1)
  assert.deepEqual(video.removedAttrs, ['src'])
  assert.ok(video.loadCalls >= 1)
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

async function testAudioMseUnsupportedDegradesToVideoOnly() {
  const environment = createEnvironment()
  environment.audioMseSupported = false
  const video = createVideo('blob:title-video-only')
  const mediaSource = environment.dc.setUpMediaSourceForLoop(video, 'title')
  mediaSource.open()
  await drainMicrotasks()

  assert.equal(mediaSource.sourceBuffers.length, 1)
  assert.equal(mediaSource.sourceBuffers[0].type, 'video/mp4; codecs="avc1.640028"')
  assert.equal(environment.warnings.length, 1)
  assert.match(environment.warnings[0], /audio\/mpeg MSE is not supported/)

  const videoBuffer = mediaSource.sourceBuffers[0]
  assert.deepEqual(videoBuffer.appendCalls, ['video-primary'])
  videoBuffer.finishAppend()
  await drainMicrotasks()
  assert.deepEqual(videoBuffer.appendCalls, ['video-primary', 'video-loop'])
  videoBuffer.finishAppend()
  await drainMicrotasks()
  assert.equal(video.playCalls, 1)
  assert.ok(environment.dc.loopTimers.title_v)
  assert.equal(environment.dc.loopTimers.title_a, undefined)

  // 降级警告不应占用真实失败告警通道
  environment.throwOnNextAppend = true
  environment.runTimer(environment.dc.loopTimers.title_v)
  await drainMicrotasks()
  assert.equal(environment.warnings.length, 2)
  assert.match(environment.warnings[1], /Forced append failure/)
  assert.equal(environment.dc.mediaSources.title, undefined)
  assert.equal(environment.timers.size, 0)
  assert.deepEqual(environment.revokedUrls, ['blob:title-video-only', 'blob:mock-1', 'blob:mock-2'])
}

async function testAudioMseProbeMissingDegradesToVideoOnly() {
  const environment = createEnvironment()
  environment.target.MediaSource.isTypeSupported = undefined
  const video = createVideo('blob:title-no-probe')
  const mediaSource = environment.dc.setUpMediaSourceForLoop(video, 'title')
  mediaSource.open()
  await drainMicrotasks()

  assert.equal(mediaSource.sourceBuffers.length, 1)
  assert.equal(environment.warnings.length, 1)
  assert.match(environment.warnings[0], /audio\/mpeg MSE is not supported/)
  assert.equal(environment.dc.loopTimers.title_a, undefined)
  assert.equal(environment.dc.tearDownMediaSourceForLoop('title'), true)
}

async function testAudioSourceBufferThrowDegradesToVideoOnly() {
  const environment = createEnvironment()
  environment.throwOnAudioSourceBuffer = true
  const video = createVideo('blob:title-audio-throw')
  const mediaSource = environment.dc.setUpMediaSourceForLoop(video, 'title')
  mediaSource.open()
  await drainMicrotasks()

  assert.equal(mediaSource.sourceBuffers.length, 1)
  assert.equal(environment.warnings.length, 1)
  assert.match(environment.warnings[0], /SourceBuffer is not supported/)

  const videoBuffer = mediaSource.sourceBuffers[0]
  videoBuffer.finishAppend()
  await drainMicrotasks()
  videoBuffer.finishAppend()
  await drainMicrotasks()
  assert.equal(video.playCalls, 1)
  assert.ok(environment.dc.loopTimers.title_v)
  assert.equal(environment.dc.loopTimers.title_a, undefined)
}

async function testAudioMseUnsupportedFallsBackToPlainAudio() {
  const environment = createEnvironment()
  environment.audioMseSupported = false
  const video = createVideo('blob:title-audio-fallback')
  const mediaSource = environment.dc.setUpMediaSourceForLoop(video, 'title')
  mediaSource.open()
  await drainMicrotasks()

  assert.equal(mediaSource.sourceBuffers.length, 1)
  assert.equal(environment.warnings.length, 1)
  assert.match(environment.warnings[0], /audio\/mpeg MSE is not supported/)

  const videoBuffer = mediaSource.sourceBuffers[0]
  videoBuffer.finishAppend()
  await drainMicrotasks()
  videoBuffer.finishAppend()
  await drainMicrotasks()
  assert.equal(video.playCalls, 1)

  const audio = environment.audioElement
  assert.ok(audio, 'plain audio fallback should exist')
  assert.ok(audio.playCalls >= 1, 'fallback audio should start with the video')
  assert.equal(audio.src, 'blob:mock-1')
  assert.equal(audio.loop, false)
  assert.equal(audio.volume, 1)
  assert.ok(environment.dc.loopTimers.title_v)
  assert.equal(environment.dc.loopTimers.title_a, undefined)

  const states = environment.dc.__dcTitleLoopQueuePatch.states
  assert.ok(states.title.volumeSyncTimer, 'fallback audio should run a volume sync timer')
  video.volume = 0.4
  environment.runTimer(states.title.volumeSyncTimer)
  await drainMicrotasks()
  assert.equal(audio.volume, 0.4, 'fallback audio should mirror the title video volume')

  video.volume = 1.5
  environment.runTimer(states.title.volumeSyncTimer)
  await drainMicrotasks()
  assert.equal(audio.volume, 1, 'fallback audio volume should stay clamped')

  audio.fireEnded()
  assert.equal(audio.src, 'blob:mock-2')
  assert.equal(audio.loop, true)
  assert.ok(audio.playCalls >= 2)

  assert.equal(environment.dc.tearDownMediaSourceForLoop('title'), true)
  await drainMicrotasks()
  assert.equal(audio.parentNode, null)
  assert.ok(audio.pauseCalls >= 1)
  assert.deepEqual(environment.revokedUrls, ['blob:title-audio-fallback', 'blob:mock-1', 'blob:mock-2'])
  assert.equal(environment.timers.size, 0)
}

async function testLoopAppendEvictsPlayedHeadAfterAppend() {
  const environment = createEnvironment()
  const video = createVideo('blob:title-evict')
  video.currentTime = 100
  const { audioBuffer, mediaSource, videoBuffer } = await prepareInitialLoops(environment, video)
  assert.equal(videoBuffer.removeCalls, undefined)

  const firstVideoTimer = environment.dc.loopTimers.title_v
  environment.runTimer(firstVideoTimer)
  await drainMicrotasks()
  assert.deepEqual(videoBuffer.appendCalls, ['video-primary', 'video-loop', 'video-loop'])
  assert.equal(videoBuffer.updating, true)
  videoBuffer.finishAppend()
  await drainMicrotasks()

  // 循环追加完成后回收 [0, currentTime-1] 的头部缓冲（缓冲终点 9s）
  assert.deepEqual(videoBuffer.removeCalls, [[0, 9]])
  assert.equal(videoBuffer.updating, true)
  videoBuffer.finishRemove()
  await drainMicrotasks()
  const nextVideoTimer = environment.dc.loopTimers.title_v
  assert.ok(nextVideoTimer)

  const firstAudioTimer = environment.dc.loopTimers.title_a
  environment.runTimer(firstAudioTimer)
  await drainMicrotasks()
  assert.equal(audioBuffer.updating, true)
  audioBuffer.finishAppend()
  await drainMicrotasks()
  assert.deepEqual(audioBuffer.removeCalls, [[0, 8]])
  audioBuffer.finishRemove()
  await drainMicrotasks()

  assert.equal(environment.dc.tearDownMediaSourceForLoop('title'), true)
  await drainMicrotasks()
  assert.equal(environment.timers.size, 0)
  assert.equal(environment.concurrentAppendAttempts, 0)
}

async function testFirstFrameTimelineAlignment() {
  const environment = createEnvironment()
  // timescale 1000、首样本 composition offset 500 -> 首帧 PTS = 0.5s
  const mp4 = miniFragmentedVideo(500, 1000)
  const primaryAb = mp4.buffer.slice(mp4.byteOffset, mp4.byteOffset + mp4.byteLength)
  primaryAb.duration = 5
  primaryAb.id = 'video-primary-050'
  const loopAb = mp4.buffer.slice(mp4.byteOffset, mp4.byteOffset + mp4.byteLength)
  loopAb.duration = 2
  loopAb.id = 'video-loop-050'
  environment.buffers.primaryVideo = primaryAb
  environment.buffers.secondaryVideo = loopAb
  const video = createVideo('blob:title-align')
  const mediaSource = environment.dc.setUpMediaSourceForLoop(video, 'title')
  mediaSource.open()
  const videoBuffer = mediaSource.sourceBuffers[0]
  const audioBuffer = mediaSource.sourceBuffers[1]
  await drainMicrotasks()
  // WebKit Bug 156316: 主段首帧 PTS 0.5s -> timestampOffset = -0.5，缓冲从 0 开始
  assert.equal(videoBuffer.appendStates[0].timestampOffset, -0.5)
  videoBuffer.finishAppend()
  audioBuffer.finishAppend()
  await drainMicrotasks()
  // 循环段首帧落点 = 4.5 - 0.5 = 4.0，终点 6.0；循环时长 = 1.5s
  assert.equal(videoBuffer.appendStates[1].timestampOffset, 4.0)
  videoBuffer.finishAppend()
  audioBuffer.finishAppend()
  await drainMicrotasks()
  assert.equal(video.playCalls, 1)
  const firstTimer = environment.dc.loopTimers.title_v
  assert.equal(environment.timers.get(firstTimer).delay, 1500)

  environment.runTimer(firstTimer)
  await drainMicrotasks()
  assert.equal(videoBuffer.appendStates[2].timestampOffset, 5.5)
  videoBuffer.finishAppend()
  await drainMicrotasks()

  assert.equal(environment.dc.tearDownMediaSourceForLoop('title'), true)
  await drainMicrotasks()
  assert.equal(environment.timers.size, 0)
  assert.equal(environment.concurrentAppendAttempts, 0)
}

async function testRealFragmentedMp4AlignsFirstFrame() {
  const environment = createEnvironment()
  // 本体标题视频的真实参数：timescale 12288、首帧 PTS 1024/12288
  const mp4 = miniFragmentedVideo(1024, 12288)
  const primaryAb = mp4.buffer.slice(mp4.byteOffset, mp4.byteOffset + mp4.byteLength)
  primaryAb.duration = 5
  primaryAb.id = 'video-primary-real'
  const loopAb = mp4.buffer.slice(mp4.byteOffset, mp4.byteOffset + mp4.byteLength)
  loopAb.duration = 2
  loopAb.id = 'video-loop-real'
  environment.buffers.primaryVideo = primaryAb
  environment.buffers.secondaryVideo = loopAb

  const video = createVideo('blob:title-real')
  const mediaSource = environment.dc.setUpMediaSourceForLoop(video, 'title')
  mediaSource.open()
  const videoBuffer = mediaSource.sourceBuffers[0]
  const audioBuffer = mediaSource.sourceBuffers[1]
  await drainMicrotasks()
  const firstPts = 1024 / 12288
  assert.equal(videoBuffer.appendStates[0].id, 'video-primary-real')
  assert.ok(Math.abs(videoBuffer.appendStates[0].timestampOffset - -firstPts) < 1e-9)

  videoBuffer.finishAppend()
  audioBuffer.finishAppend()
  await drainMicrotasks()
  const primaryEnd = 5 - firstPts
  assert.ok(Math.abs(videoBuffer.appendStates[1].timestampOffset - (primaryEnd - firstPts)) < 1e-9)
  videoBuffer.finishAppend()
  audioBuffer.finishAppend()
  await drainMicrotasks()
  assert.equal(video.playCalls, 1)

  assert.equal(environment.dc.tearDownMediaSourceForLoop('title'), true)
  await drainMicrotasks()
  assert.equal(environment.timers.size, 0)
}

async function testVideoQuotaFallsBackToProgressivePlayback() {
  const environment = createEnvironment()
  environment.throwQuotaOnNextAppend = true
  const video = createVideo('blob:title-quota')
  const mediaSource = environment.dc.setUpMediaSourceForLoop(video, 'title')
  mediaSource.open()
  await drainMicrotasks()

  // MSE 状态已释放，视频元素切换为渐进式主段播放，音频走 plain-audio 降级
  assert.equal(environment.dc.mediaSources.title, undefined)
  assert.equal(environment.dc.__dcTitleLoopQueuePatch.states.title, undefined)
  assert.equal(video.src, 'blob:mock-1')
  assert.equal(video.loop, false)
  assert.ok(video.playCalls >= 1)
  const audio = environment.audioElement
  assert.ok(audio, 'plain audio fallback should exist')
  assert.equal(audio.src, 'blob:mock-3')
  assert.ok(audio.playCalls >= 1)
  assert.equal(environment.warnings.length, 2)
  assert.match(environment.warnings[0], /quota has been exceeded/i)
  assert.match(environment.warnings[1], /渐进式播放/)
  assert.ok(environment.revokedUrls.includes('blob:title-quota'))

  // 主段结束 -> 切循环段并 loop，主段 URL 回收
  video.emit('ended')
  assert.equal(video.src, 'blob:mock-2')
  assert.equal(video.loop, true)
  assert.ok(video.playCalls >= 2)
  assert.ok(environment.revokedUrls.includes('blob:mock-1'))

  // 退出清理剩余降级 URL（循环视频 + 音频主段/循环段），并移除降级音频
  environment.dc.tearDownMediaSourceForLoop('title')
  for (const url of ['blob:mock-2', 'blob:mock-3', 'blob:mock-4']) {
    assert.ok(environment.revokedUrls.includes(url), url + ' should be revoked on teardown')
  }
  // 读档/退出路径只调 tearDown 不摘除元素时，降级视频也要被暂停并断开 src
  assert.ok(video.pauseCalls >= 1)
  assert.ok(video.loadCalls >= 1)
  assert.deepEqual(video.removedAttrs, ['src'])
  assert.equal(audio.parentNode, null)
  assert.ok(audio.pauseCalls >= 1)
}

async function testVideoQuotaFallbackPrefersVfsPath() {
  const environment = createEnvironment()
  environment.dc.loadLoopBuffers('title',
    './data/video/title_main.mp4',
    './data/bgm/title_main.mp3',
    './data/video/title_loop.mp4',
    './data/bgm/title_loop.mp3')
  const captured = environment.dc.__dcTitleLoopPaths.title
  assert.equal(captured.primaryVideo, './data/video/title_main.mp4')
  assert.equal(captured.secondaryVideo, './data/video/title_loop.mp4')
  environment.throwQuotaOnNextAppend = true
  const video = createVideo('blob:title-quota-path')
  const mediaSource = environment.dc.setUpMediaSourceForLoop(video, 'title')
  mediaSource.open()
  await drainMicrotasks()

  // 降级优先走 VFS 逻辑路径（真机由 Host kernel 的 src 补丁转成受管 URL），
  // 不创建裸 Blob；音频仍走 plain-audio 降级
  assert.equal(video.src, './data/video/title_main.mp4')
  assert.equal(video.loop, false)
  assert.ok(video.playCalls >= 1)
  const audio = environment.audioElement
  assert.ok(audio)
  assert.equal(audio.src, 'blob:mock-1')

  video.emit('ended')
  assert.equal(video.src, './data/video/title_loop.mp4')
  assert.equal(video.loop, true)
  assert.ok(video.playCalls >= 2)

  environment.dc.tearDownMediaSourceForLoop('title')
  assert.ok(environment.revokedUrls.includes('blob:mock-1'))
  assert.ok(environment.revokedUrls.includes('blob:mock-2'))
}

async function testEvictionSkipsWhenRemoveUnavailable() {
  const environment = createEnvironment()
  const video = createVideo('blob:title-no-remove')
  video.currentTime = 100
  const { videoBuffer } = await prepareInitialLoops(environment, video)
  videoBuffer.remove = undefined
  const firstVideoTimer = environment.dc.loopTimers.title_v
  environment.runTimer(firstVideoTimer)
  await drainMicrotasks()
  assert.equal(videoBuffer.updating, true)
  videoBuffer.finishAppend()
  await drainMicrotasks()
  // remove 不可用：跳过回收，队列不卡死，下一轮定时器照常排上
  assert.equal(videoBuffer.removeCalls, undefined)
  assert.ok(environment.dc.loopTimers.title_v)
  assert.equal(environment.dc.tearDownMediaSourceForLoop('title'), true)
  await drainMicrotasks()
  assert.equal(environment.timers.size, 0)
  assert.equal(environment.concurrentAppendAttempts, 0)
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
  await testAudioMseUnsupportedDegradesToVideoOnly()
  await testAudioMseProbeMissingDegradesToVideoOnly()
  await testAudioSourceBufferThrowDegradesToVideoOnly()
  await testAudioMseUnsupportedFallsBackToPlainAudio()
  await testLoopAppendEvictsPlayedHeadAfterAppend()
  await testFirstFrameTimelineAlignment()
  await testRealFragmentedMp4AlignsFirstFrame()
  await testVideoQuotaFallsBackToProgressivePlayback()
  await testVideoQuotaFallbackPrefersVfsPath()
  await testEvictionSkipsWhenRemoveUnavailable()
  await testStrictProfileTransform()
  console.log('Title loop profile tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
