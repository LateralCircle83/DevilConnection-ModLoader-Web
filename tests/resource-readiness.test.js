'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-readiness.js')

const ResourceReadiness = window.DCWeb.ResourceReadiness

function eventTarget(tagName) {
  const attributes = new Map()
  const listeners = new Map()
  return {
    attributes,
    autoplay: false,
    error: null,
    networkState: 0,
    paused: true,
    readyState: 0,
    style: {},
    tagName,
    videoHeight: 0,
    videoWidth: 0,
    addEventListener(type, listener) {
      const values = listeners.get(type) || []
      values.push(listener)
      listeners.set(type, values)
    },
    emit(type) {
      ;(listeners.get(type) || []).slice().forEach((listener) => listener.call(this, { type }))
    },
    getAttribute(name) { return attributes.get(name) || null },
    removeAttribute(name) { attributes.delete(name) },
    removeEventListener(type, listener) {
      const values = listeners.get(type) || []
      const index = values.indexOf(listener)
      if (index !== -1) values.splice(index, 1)
    },
    setAttribute(name, value) { attributes.set(name, String(value)) },
  }
}

function createTarget() {
  const rootAttributes = new Map()
  const pageListeners = []
  return {
    Promise,
    addEventListener(type, listener) {
      if (type === 'pagehide') pageListeners.push(listener)
    },
    clearTimeout,
    document: {
      documentElement: {
        getAttribute(name) { return rootAttributes.get(name) || null },
        setAttribute(name, value) { rootAttributes.set(name, String(value)) },
      },
    },
    pageListeners,
    rootAttributes,
    setTimeout,
  }
}

async function main() {
  const target = createTarget()
  const readiness = ResourceReadiness.forTarget(target)

  const image = eventTarget('IMG')
  image.naturalHeight = 720
  image.naturalWidth = 1280
  let resolveDecode
  image.decode = function () { return new Promise((resolve) => { resolveDecode = resolve }) }
  const imageReady = readiness.waitForImage(image, 'data/image/title.webp')
  await Promise.resolve()
  assert.deepEqual(image.style, {})
  resolveDecode()
  await imageReady
  assert.equal(image.getAttribute('data-dc-resource-pending'), null)

  const broken = eventTarget('IMG')
  broken.decode = function () { return Promise.reject(new Error('decode failed')) }
  await readiness.waitForImage(broken, 'data/image/broken.webp')
  assert.equal(broken.getAttribute('data-dc-resource-pending'), null)

  const video = eventTarget('VIDEO')
  const videoReady = readiness.waitForVideo(video, 'data/video/title_intro.mp4')
  assert.equal(video.getAttribute('data-dc-resource-pending'), null)
  assert.deepEqual(video.style, {})
  video.readyState = 3
  video.videoHeight = 960
  video.videoWidth = 1280
  video.emit('canplay')
  await videoReady

  const report = readiness.report()
  assert.equal(report.readiness.completed, 2)
  assert.equal(report.readiness.failed, 1)
  assert.equal(report.readiness.peakImageRgbaBytes, 1280 * 720 * 4)
  assert.equal(report.media.assignments, 1)
  assert.equal(report.media.events.canplay, 1)
  assert.equal(report.media.last.videoWidth, 1280)
  assert.equal(target.rootAttributes.get('data-dc-readiness-state'), 'idle')

  target.pageListeners.forEach((listener) => listener())
  assert.equal(target.rootAttributes.get('data-dc-readiness-state'), 'canceled')
  console.log('Resource readiness tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
