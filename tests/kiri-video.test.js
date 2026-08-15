'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/profiles/devil-connection-kiri-video.js')

const patch = window.DCWeb.DevilConnectionKiriVideoPatch

function box(type, payload) {
  const body = Buffer.from(payload || [])
  const result = Buffer.alloc(8 + body.length)
  result.writeUInt32BE(result.length, 0)
  result.write(type, 4, 4, 'ascii')
  body.copy(result, 8)
  return result
}

function handler(type) {
  const payload = Buffer.alloc(12)
  payload.write(type, 8, 4, 'ascii')
  return box('hdlr', payload)
}

function track(type) {
  return box('trak', box('mdia', handler(type)))
}

function arrayBufferOf(value) {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
}

function childTypes(value, parentType) {
  const parentOffset = value.indexOf(Buffer.from(parentType, 'ascii')) - 4
  const parentSize = value.readUInt32BE(parentOffset)
  const types = []
  let offset = parentOffset + 8
  while (offset < parentOffset + parentSize) {
    const size = value.readUInt32BE(offset)
    types.push(value.toString('ascii', offset + 4, offset + 8))
    offset += size
  }
  return types
}

const source = Buffer.concat([
  box('ftyp', Buffer.from('isom0000', 'ascii')),
  box('moov', Buffer.concat([track('vide'), track('soun')])),
  box('mdat', Buffer.from([1, 2, 3, 4, 5, 6])),
])
const transformed = Buffer.from(patch.transform(arrayBufferOf(source)))

assert.equal(transformed.length, source.length)
assert.deepEqual(childTypes(transformed, 'moov'), ['trak', 'free'])
assert.deepEqual(transformed.subarray(transformed.length - 6), source.subarray(source.length - 6))
assert.equal(patch.format, 'binary')
assert.equal(patch.maxBytes, 1024 * 1024)
assert.throws(
  () => patch.transform(arrayBufferOf(Buffer.concat([box('ftyp'), box('moov', track('vide')), box('mdat')]))),
  /Expected one audio track and one video track/,
)

console.log('Kiri video compatibility tests passed')
