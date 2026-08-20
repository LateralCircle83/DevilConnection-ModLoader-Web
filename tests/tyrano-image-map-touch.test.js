'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/tyrano-image-map-touch.js')

const ImageMapTouch = window.DCWeb.TyranoImageMapTouch
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

function makeArea(name, shape, coords) {
  return {
    name,
    nodeType: 1,
    data: undefined,
    getAttribute(key) {
      if (key === 'shape') return shape
      if (key === 'coords') return coords
      return null
    },
  }
}

function makeImage(usemap, rect) {
  return {
    nodeType: 1,
    getAttribute(key) {
      return key === 'usemap' ? usemap : null
    },
    getBoundingClientRect() {
      return rect
    },
  }
}

function makeMap(areas) {
  return {
    querySelectorAll(selector) {
      return selector === 'area' ? areas.slice() : []
    },
  }
}

function makeDocument() {
  const listeners = []
  const rootAttributes = {}
  const document = {
    listeners,
    map: null,
    mapById: null,
    documentElement: {
      getAttribute(name) {
        return rootAttributes[name] || null
      },
      setAttribute(name, value) {
        rootAttributes[name] = String(value)
      },
    },
    addEventListener(type, listener, options) {
      listeners.push({ type, listener, options })
    },
    getElementById() {
      return document.mapById || null
    },
    getElementsByName() {
      return document.map ? [document.map] : []
    },
  }
  return document
}

function makeJquery(area, tapped) {
  function wrap(items) {
    const obj = {
      length: items.length,
      data(name, value) {
        if (arguments.length === 2) {
          items.forEach(function (element) {
            element.data = element.data || {}
            element.data[name] = value
          })
          return obj
        }
        return items[0] && items[0].data ? items[0].data[name] : undefined
      },
      trigger(type) {
        if (type === 'tap') tapped.count += 1
        return obj
      },
      click(handler) {
        if (handler) tapped.bound = handler
        else obj.trigger('tap')
        return obj
      },
    }
    obj.tap = obj.click
    return obj
  }
  function jquery(input) {
    if (input && input.nodeType) return wrap([input])
    return wrap([])
  }
  jquery.fn = jquery.prototype = {}
  jquery.fn.tap = function () {}
  jquery.fn.click = jquery.fn.tap
  return jquery
}

function touchEvent(target, clientX, clientY, touched) {
  return {
    target,
    clientX,
    clientY,
    changedTouches: touched === false ? undefined : [{ clientX, clientY }],
  }
}

function testPointInShape() {
  assert.equal(ImageMapTouch.pointInShape('rect', [10, 10, 90, 90], 50, 50), true)
  assert.equal(ImageMapTouch.pointInShape('rect', [10, 10, 90, 90], 5, 5), false)
  assert.equal(ImageMapTouch.pointInShape('circle', [50, 50, 10], 55, 50), true)
  assert.equal(ImageMapTouch.pointInShape('circle', [50, 50, 10], 65, 50), false)
  assert.equal(ImageMapTouch.pointInShape('poly', [0, 0, 100, 0, 50, 100], 50, 50), true)
  assert.equal(ImageMapTouch.pointInShape('poly', [0, 0, 100, 0, 50, 100], 150, 50), false)
  assert.equal(ImageMapTouch.pointInShape('poly', [0, 0, 100], 50, 50), false)
  assert.equal(ImageMapTouch.pointInShape('rect', null, 50, 50), false)
}

function testFindArea() {
  const save = makeArea('save', 'poly', '668,496,871,469,945,448,1160,498,1169,827,933,813,766,763,673,703')
  const load = makeArea('load', 'poly', '666,121,677,375,719,461,860,462,1166,395,1174,162,961,80')
  const close = makeArea('close', 'circle', '1238,916,42')
  const rect = makeArea('rect', 'rect', '100,100,200,200')
  const map = makeMap([save, load, close, rect])

  assert.equal(ImageMapTouch.findArea(map, 700, 500), save)
  assert.equal(ImageMapTouch.findArea(map, 700, 300), load)
  assert.equal(ImageMapTouch.findArea(map, 1240, 920), close)
  assert.equal(ImageMapTouch.findArea(map, 150, 150), rect)
  assert.equal(ImageMapTouch.findArea(map, 500, 500), null)
  assert.equal(ImageMapTouch.findArea(map, 10, 10), null)
  assert.equal(ImageMapTouch.findArea(null, 10, 10), null)

  const badCoords = makeArea('bad', 'rect', 'abc,def')
  const badMap = makeMap([badCoords])
  assert.equal(ImageMapTouch.findArea(badMap, 10, 10), null)
}

function testInstallBindsOnceAndIsIdempotent() {
  const document = makeDocument()
  const kag = { config: { scWidth: 1280, scHeight: 960 } }
  const tapped = { count: 0 }
  const jquery = makeJquery(makeArea('save', 'poly', '668,496,1169,827'), tapped)

  assert.equal(ImageMapTouch.install(document, jquery, kag), true)
  assert.equal(ImageMapTouch.install(document, jquery, kag), true, 'install is idempotent')
  assert.equal(document.listeners.length, 1)
  assert.equal(document.listeners[0].type, 'touchend')
  assert.equal(ImageMapTouch.install(null, jquery, kag), false)
  assert.equal(ImageMapTouch.install(document, jquery, null), false)
}

function testMapResolvedByIdOrName() {
  const save = makeArea('save', 'poly', '668,496,871,469,945,448,1160,498,1169,827,933,813,766,763,673,703')
  const map = makeMap([save])
  const img = makeImage('#map', { left: 0, top: 0, width: 1280, height: 960 })
  const kag = { config: { scWidth: 1280, scHeight: 960 } }

  // The game's menu.html declares `<map name="map">` without an id, exactly
  // like the browser's own usemap resolution; the guard must find it by name.
  const documentName = makeDocument()
  documentName.map = map
  const tappedName = { count: 0 }
  assert.equal(ImageMapTouch.install(documentName, makeJquery(save, tappedName), kag), true)
  const nameHandler = documentName.listeners.find((entry) => entry.type === 'touchend').listener
  nameHandler(touchEvent(img, 700, 500))
  assert.equal(tappedName.count, 1, 'a name-only <map> must resolve like the game menu')

  // Maps that do carry an id keep working as well.
  const documentId = makeDocument()
  documentId.mapById = map
  const tappedId = { count: 0 }
  assert.equal(ImageMapTouch.install(documentId, makeJquery(save, tappedId), kag), true)
  const idHandler = documentId.listeners.find((entry) => entry.type === 'touchend').listener
  idHandler(touchEvent(img, 700, 500))
  assert.equal(tappedId.count, 1, 'an id-carrying <map> must resolve too')
}

function testFirefoxPathRetargetsImageMapTouch() {
  const save = makeArea('save', 'poly', '668,496,871,469,945,448,1160,498,1169,827,933,813,766,763,673,703')
  const map = makeMap([save])
  const document = makeDocument()
  document.map = map
  const img = makeImage('#map', { left: 0, top: 0, width: 1280, height: 960 })
  const kag = { config: { scWidth: 1280, scHeight: 960 } }
  const tapped = { count: 0, bound: null }
  const jquery = makeJquery(save, tapped)

  assert.equal(ImageMapTouch.install(document, jquery, kag), true)
  const handler = document.listeners.find((entry) => entry.type === 'touchend').listener
  handler(touchEvent(img, 700, 500))
  assert.equal(tapped.count, 1, 'a touchend on the map image enters the matching area exactly once')
  assert.equal(document.documentElement.getAttribute('data-dc-image-map-touch-seen'), '1')
  assert.equal(document.documentElement.getAttribute('data-dc-image-map-touch-hits'), '1')

  handler(touchEvent(img, 10, 10))
  assert.equal(tapped.count, 1, 'a touchend in the dead zone is ignored')
  assert.equal(document.documentElement.getAttribute('data-dc-image-map-touch-seen'), '2')
  assert.equal(document.documentElement.getAttribute('data-dc-image-map-touch-hits'), '1')
}

function testChromiumPathTargetsAreaAndStaysInert() {
  const save = makeArea('save', 'poly', '668,496,1169,827')
  const map = makeMap([save])
  const document = makeDocument()
  document.map = map
  const img = makeImage('#map', { left: 0, top: 0, width: 1280, height: 960 })
  const kag = { config: { scWidth: 1280, scHeight: 960 } }
  const tapped = { count: 0 }
  const jquery = makeJquery(save, tapped)

  assert.equal(ImageMapTouch.install(document, jquery, kag), true)
  const handler = document.listeners.find((entry) => entry.type === 'touchend').listener

  // Chromium targets the <area>, not the image; the guard must not double-fire.
  handler(touchEvent(save, 700, 500))
  assert.equal(tapped.count, 0)

  // A touchend on the image inside a dead zone stays inert too.
  handler(touchEvent(img, 10, 10))
  assert.equal(tapped.count, 0)
}

function testAreaOwnTouchSessionIsRespected() {
  const save = makeArea('save', 'poly', '668,496,1169,827')
  save.data = { 'event.tap.moved': false }
  const map = makeMap([save])
  const document = makeDocument()
  document.map = map
  const img = makeImage('#map', { left: 0, top: 0, width: 1280, height: 960 })
  const kag = { config: { scWidth: 1280, scHeight: 960 } }
  const tapped = { count: 0 }
  const jquery = makeJquery(save, tapped)

  assert.equal(ImageMapTouch.install(document, jquery, kag), true)
  const handler = document.listeners.find((entry) => entry.type === 'touchend').listener
  handler(touchEvent(img, 700, 500))
  assert.equal(tapped.count, 0, 'the area polyfill that already owns the touch must finish it')
}

function testPcNativeClickSemanticsStayInert() {
  const save = makeArea('save', 'poly', '668,496,1169,827')
  const map = makeMap([save])
  const document = makeDocument()
  document.map = map
  const img = makeImage('#map', { left: 0, top: 0, width: 1280, height: 960 })
  const kag = { config: { scWidth: 1280, scHeight: 960 } }
  const tapped = { count: 0 }
  const jquery = makeJquery(save, tapped)
  jquery.fn.click = function () {}

  assert.equal(ImageMapTouch.install(document, jquery, kag), true)
  const handler = document.listeners.find((entry) => entry.type === 'touchend').listener
  handler(touchEvent(img, 700, 500))
  assert.equal(tapped.count, 0, 'native click semantics keep ownership on PC')
}

function testScaledAndMissingInputs() {
  const save = makeArea('save', 'poly', '668,496,871,469,945,448,1160,498,1169,827,933,813,766,763,673,703')
  const map = makeMap([save])
  const document = makeDocument()
  document.map = map
  const kag = { config: { scWidth: 1280, scHeight: 960 } }
  const tapped = { count: 0 }
  const jquery = makeJquery(save, tapped)

  assert.equal(ImageMapTouch.install(document, jquery, kag), true)
  const handler = document.listeners.find((entry) => entry.type === 'touchend').listener

  // Rendered box may be scaled by the Tyrano base transform; normalized
  // coordinates must still resolve into the authored 1280x960 design space.
  const scaled = makeImage('#map', { left: 100, top: 50, width: 640, height: 480 })
  handler(touchEvent(scaled, 100 + 350, 50 + 250))
  assert.equal(tapped.count, 1)

  handler({ target: scaled, changedTouches: [] })
  assert.equal(tapped.count, 1, 'a touchend without coordinates is ignored')

  const originalWarn = console.warn
  const warns = []
  console.warn = function (message) { warns.push(String(message)) }
  try {
    document.map = null
    handler(touchEvent(makeImage('#missing', { left: 0, top: 0, width: 1280, height: 960 }), 700, 500))
    handler(touchEvent(makeImage('#missing', { left: 0, top: 0, width: 1280, height: 960 }), 700, 500))
  } finally {
    console.warn = originalWarn
  }
  assert.equal(tapped.count, 1, 'a missing map is ignored')
  assert.equal(warns.length, 1, 'the map-missing diagnostic warns exactly once per install')

  document.map = map
  const noConfigKag = { config: {} }
  const handler2 = ImageMapTouch.retarget(document, jquery, noConfigKag, touchEvent(scaled, 700, 500))
  assert.equal(handler2, false, 'without a design space the guard cannot map coordinates')
}

function testBrowserScriptOrder() {
  const guardIndex = indexHtml.indexOf('js/kernel/tyrano-image-map-touch.js')
  const adapterIndex = indexHtml.indexOf('js/kernel/tyrano-adapter.js')
  assert.ok(guardIndex >= 0, 'the image-map touch guard script should be loaded')
  assert.ok(adapterIndex > guardIndex, 'the image-map touch guard must load before TyranoAdapter')
}

testPointInShape()
testFindArea()
testInstallBindsOnceAndIsIdempotent()
testFirefoxPathRetargetsImageMapTouch()
testChromiumPathTargetsAreaAndStaysInert()
testAreaOwnTouchSessionIsRespected()
testPcNativeClickSemanticsStayInert()
testScaledAndMissingInputs()
testBrowserScriptOrder()
console.log('Tyrano image-map touch guard tests passed')
