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
require('../js/kernel/mp4-visual-fallback.js')
require('../js/kernel/asset-resolver.js')

const { AsarArchive, AssetResolver, LayeredVfs, Mp4VisualFallback } = window.DCWeb

function box(type, payload = Buffer.alloc(0)) {
  const size = Buffer.alloc(4)
  size.writeUInt32BE(payload.length + 8)
  return Buffer.concat([size, Buffer.from(type, 'ascii'), payload])
}

function handler(type) {
  const payload = Buffer.alloc(12)
  payload.write(type, 8, 4, 'ascii')
  return box('hdlr', payload)
}

function sampleDescription(sample) {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(1, 4)
  return box('stsd', Buffer.concat([header, sample]))
}

function track(type, sample) {
  return box('trak', box('mdia', Buffer.concat([
    handler(type),
    box('minf', box('stbl', sampleDescription(sample))),
  ])))
}

function videoSample() {
  const header = Buffer.alloc(78)
  return box('avc1', Buffer.concat([header, box('avcC', Buffer.from([1, 0x64, 0, 0x28]))]))
}

function audioSample(type = 'mp4a') {
  const header = Buffer.alloc(28)
  const descriptor = Buffer.from(
    '000000000380808025000200048080801740150000000001f4000001f4000580808005119056e500068080800102',
    'hex',
  )
  return box(type, Buffer.concat([header, box('esds', descriptor)]))
}

function progressiveMp4(options = {}) {
  const movieChildren = [
    track('vide', videoSample()),
    track('soun', audioSample(options.audioType)),
  ]
  if (options.fragmented) movieChildren.push(box('mvex'))
  return Buffer.concat([
    box('ftyp', Buffer.from('isom')),
    box('moov', Buffer.concat(movieChildren)),
    box('free'),
    box('mdat', Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])),
    ...(options.fragmented ? [box('moof')] : []),
  ])
}

async function main() {
  const source = progressiveMp4()
  const sourceBlob = new Blob([source], { type: 'video/mp4' })
  const slices = []
  const guardedBlob = {
    size: sourceBlob.size,
    type: sourceBlob.type,
    arrayBuffer() { throw new Error('whole-file reads are forbidden') },
    slice(start, end) {
      slices.push({ end, start })
      return sourceBlob.slice(start, end)
    },
  }

  const representation = await Mp4VisualFallback.create(guardedBlob)
  assert.ok(representation)
  assert.equal(representation.audioCodec, 'mp4a.40.2')
  assert.equal(representation.videoCodec, 'avc1.640028')
  assert.equal(representation.blob.size, source.length)
  assert.ok(slices.some((slice) => slice.end - slice.start <= 16))
  assert.ok(slices.every((slice) => slice.end === undefined || slice.end - slice.start <= Mp4VisualFallback.MAX_MOOV_BYTES))

  const visual = Buffer.from(await representation.blob.arrayBuffer())
  const changed = []
  for (let index = 0; index < source.length; index++) {
    if (source[index] !== visual[index]) changed.push(index)
  }
  assert.deepEqual(changed, [
    representation.audioTrackTypeOffset,
    representation.audioTrackTypeOffset + 2,
    representation.audioTrackTypeOffset + 3,
  ])
  assert.equal(visual.toString('ascii', representation.audioTrackTypeOffset, representation.audioTrackTypeOffset + 4), 'free')

  assert.equal(await Mp4VisualFallback.create(new Blob([progressiveMp4({ fragmented: true })])), null)
  assert.equal(await Mp4VisualFallback.create(new Blob([progressiveMp4({ audioType: 'alac' })])), null)
  assert.equal(await Mp4VisualFallback.create(new Blob([box('ftyp')])), null)

  const createdUrls = []
  const revokedUrls = []
  const originalCreateObjectUrl = URL.createObjectURL
  const originalRevokeObjectUrl = URL.revokeObjectURL
  URL.createObjectURL = function (blob) {
    assert.ok(blob instanceof Blob)
    const url = 'blob:visual/' + (createdUrls.length + 1)
    createdUrls.push(url)
    return url
  }
  URL.revokeObjectURL = function (url) { revokedUrls.push(url) }
  try {
    const path = 'data/video/mod-effect.mp4'
    const archive = new AsarArchive(
      sourceBlob,
      {},
      0,
      new Map([[path, { path, offset: 0, size: source.length, unpacked: false }]]),
    )
    const resolver = new AssetResolver(new LayeredVfs([{ id: 'mod:visual', kind: 'mod', source: archive }]))
    const handle = await resolver.createVisualOnlyMediaObjectUrl(path)
    assert.ok(handle)
    assert.equal(handle.audioCodec, 'mp4a.40.2')
    assert.equal(handle.sourceKind, 'mod')
    assert.equal(handle.sourceLayerId, 'mod:visual')
    assert.equal(handle.url, 'blob:visual/1')
    assert.equal(resolver.getObjectUrlStats().categories.video.logicalBytes, source.length)
    assert.equal(handle.release(), true)
    assert.equal(handle.release(), false)
    assert.deepEqual(revokedUrls, ['blob:visual/1'])
    assert.equal(resolver.getObjectUrlStats().count, 0)
    resolver.release()
  } finally {
    URL.createObjectURL = originalCreateObjectUrl
    URL.revokeObjectURL = originalRevokeObjectUrl
  }

  console.log('MP4 visual fallback tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
