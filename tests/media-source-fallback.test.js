'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')
require('../js/kernel/asar-archive.js')
require('../js/kernel/layered-vfs.js')
require('../js/kernel/object-url-registry.js')
require('../js/kernel/style-processor.js')
require('../js/kernel/media-source-fallback.js')
require('../js/kernel/asset-resolver.js')

const { AsarArchive, AssetResolver, LayeredVfs, MediaSourceFallback } = window.DCWeb

function box(type, payload = Buffer.alloc(0)) {
  const size = Buffer.alloc(4)
  size.writeUInt32BE(payload.length + 8)
  return Buffer.concat([size, Buffer.from(type, 'ascii'), payload])
}

function fragmentedMp4() {
  const avcConfig = box('avcC', Buffer.from([1, 0x64, 0, 0x28]))
  const videoSample = box('avc1', avcConfig)
  const esDescriptor = Buffer.from(
    '000000000380808025000200048080801740150000000001f4000001f4000580808005119056e500068080800102',
    'hex',
  )
  const audioSample = box('mp4a', box('esds', esDescriptor))
  return Buffer.concat([
    box('ftyp', Buffer.from('isom')),
    box('moov', Buffer.concat([videoSample, audioSample, box('mvex')])),
    box('moof'),
  ])
}

function exactArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

function EventTargetMock() {
  this.listeners = new Map()
}
EventTargetMock.prototype.addEventListener = function (type, listener) {
  const values = this.listeners.get(type) || []
  values.push(listener)
  this.listeners.set(type, values)
}
EventTargetMock.prototype.removeEventListener = function (type, listener) {
  const values = this.listeners.get(type) || []
  const index = values.indexOf(listener)
  if (index !== -1) values.splice(index, 1)
}
EventTargetMock.prototype.emit = function (type) {
  ;(this.listeners.get(type) || []).slice().forEach((listener) => listener.call(this, { type }))
}

function SourceBufferMock() {
  EventTargetMock.call(this)
  this.appended = null
  this.updating = false
}
SourceBufferMock.prototype = Object.create(EventTargetMock.prototype)
SourceBufferMock.prototype.constructor = SourceBufferMock
SourceBufferMock.prototype.appendBuffer = function (buffer) {
  this.appended = Buffer.from(buffer)
  this.updating = true
  queueMicrotask(() => {
    this.updating = false
    this.emit(MediaSourceMock.failAppend ? 'error' : 'updateend')
  })
}
SourceBufferMock.prototype.abort = function () { this.updating = false }

function MediaSourceMock() {
  EventTargetMock.call(this)
  this.mimeType = ''
  this.readyState = 'closed'
  this.sourceBuffer = null
  MediaSourceMock.instances.push(this)
}
MediaSourceMock.instances = []
MediaSourceMock.failAppend = false
MediaSourceMock.supportedType = 'video/mp4; codecs="avc1.640028, mp4a.40.2"'
MediaSourceMock.isTypeSupported = function (type) { return type === MediaSourceMock.supportedType }
MediaSourceMock.prototype = Object.create(EventTargetMock.prototype)
MediaSourceMock.prototype.constructor = MediaSourceMock
MediaSourceMock.prototype.addSourceBuffer = function (type) {
  this.mimeType = type
  this.sourceBuffer = new SourceBufferMock()
  return this.sourceBuffer
}
MediaSourceMock.prototype.endOfStream = function () { this.readyState = 'ended' }
MediaSourceMock.prototype.open = function () {
  this.readyState = 'open'
  this.emit('sourceopen')
}

async function main() {
  const bytes = fragmentedMp4()
  window.MediaSource = MediaSourceMock
  assert.deepEqual(MediaSourceFallback.inspect(exactArrayBuffer(bytes)), {
    codecs: ['avc1.640028', 'mp4a.40.2'],
    mimeType: MediaSourceMock.supportedType,
  })
  assert.equal(MediaSourceFallback.inspect(exactArrayBuffer(box('ftyp'))), null)
  assert.equal(await MediaSourceFallback.create({
    arrayBuffer() { throw new Error('oversized media must not be read') },
    size: MediaSourceFallback.MAX_BYTES + 1,
  }), null)

  const createdUrls = []
  const revokedUrls = []
  const originalCreateObjectUrl = URL.createObjectURL
  const originalRevokeObjectUrl = URL.revokeObjectURL
  URL.createObjectURL = function (source) {
    assert.ok(source instanceof MediaSourceMock)
    const url = 'blob:test/' + (createdUrls.length + 1)
    createdUrls.push(url)
    return url
  }
  URL.revokeObjectURL = function (url) { revokedUrls.push(url) }

  try {
    const path = 'data/video/title_intro.mp4'
    const archive = new AsarArchive(
      new Blob([bytes], { type: 'video/mp4' }),
      {},
      0,
      new Map([[path, { path, offset: 0, size: bytes.length, unpacked: false }]]),
    )
    const resolver = new AssetResolver(new LayeredVfs([{ id: 'base-game', source: archive }]))

    assert.equal(await resolver.createMediaSourceObjectUrl(path, bytes.length - 1), null)
    const handle = await resolver.createMediaSourceObjectUrl(path, bytes.length)
    assert.ok(handle)
    assert.equal(handle.mimeType, MediaSourceMock.supportedType)
    assert.equal(handle.size, bytes.length)
    assert.equal(resolver.getObjectUrlStats().categories.video.logicalBytes, bytes.length)

    const mediaSource = MediaSourceMock.instances[0]
    mediaSource.open()
    assert.deepEqual(await handle.ready, { error: '', ok: true, state: 'buffered' })
    assert.equal(mediaSource.mimeType, MediaSourceMock.supportedType)
    assert.deepEqual(mediaSource.sourceBuffer.appended, bytes)
    assert.equal(handle.release(), true)
    assert.equal(handle.release(), false)
    assert.deepEqual(revokedUrls, ['blob:test/1'])
    assert.equal(resolver.getObjectUrlStats().count, 0)

    const originalTypeSupport = MediaSourceMock.isTypeSupported
    MediaSourceMock.isTypeSupported = function () { return false }
    assert.equal(await resolver.createMediaSourceObjectUrl(path, bytes.length), null)
    MediaSourceMock.isTypeSupported = originalTypeSupport

    MediaSourceMock.failAppend = true
    const failedHandle = await resolver.createMediaSourceObjectUrl(path, bytes.length)
    MediaSourceMock.instances[1].open()
    assert.deepEqual(await failedHandle.ready, {
      error: 'SourceBuffer rejected the fragmented MP4',
      ok: false,
      state: 'append-failed',
    })
    failedHandle.release()
    MediaSourceMock.failAppend = false

    const sessionHandle = await resolver.createMediaSourceObjectUrl(path, bytes.length)
    assert.ok(sessionHandle)
    resolver.release()
    assert.deepEqual(revokedUrls, ['blob:test/1', 'blob:test/2', 'blob:test/3'])
    assert.deepEqual(await sessionHandle.ready, { error: '', ok: false, state: 'released' })
  } finally {
    URL.createObjectURL = originalCreateObjectUrl
    URL.revokeObjectURL = originalRevokeObjectUrl
  }

  console.log('MediaSource fallback tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
