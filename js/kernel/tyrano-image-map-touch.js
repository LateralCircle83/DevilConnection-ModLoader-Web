;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb || (global.DCWeb = {})
  var consoleRef = typeof console !== 'undefined' ? console : null

  // Gecko deliberately does not retarget raw touch events to the `<area>`
  // elements behind an `img[usemap]` (area elements have no layout box; only
  // compatibility mouse/pointer events are retargeted there). The game binds
  // its mobile tap handlers on the `<area>` itself, so Android Firefox shows
  // only the mouseover "selected" feedback and never the entry. Chromium and
  // WebKit target the area directly and never reach this path. This guard
  // installs one document-level delegated touchend listener that resolves the
  // matching area under a touch whose target is the image element and then
  // drives the game's own tap semantics; it stays inert otherwise.
  function findMapElement(document, name) {
    if (!document) return null
    if (typeof document.getElementById === 'function') {
      var byId = document.getElementById(name)
      if (byId) return byId
    }
    if (typeof document.getElementsByName === 'function') {
      var byName = document.getElementsByName(name)
      if (byName && byName.length) return byName[0]
    }
    return null
  }

  function parseCoords(value) {
    if (!value) return null
    var parts = String(value).split(',')
    var coords = []
    for (var i = 0; i < parts.length; i++) {
      var number = Number(parts[i])
      if (!isFinite(number)) return null
      coords.push(number)
    }
    return coords
  }

  function pointInShape(shape, coords, x, y) {
    if (!coords) return false
    if (shape === 'circle') {
      if (coords.length < 3) return false
      var dx = x - coords[0]
      var dy = y - coords[1]
      return dx * dx + dy * dy <= coords[2] * coords[2]
    }
    if (shape === 'poly') {
      if (coords.length < 6 || coords.length % 2 !== 0) return false
      var inside = false
      for (var i = 0, j = coords.length - 2; i < coords.length; i += 2) {
        var xi = coords[i]
        var yi = coords[i + 1]
        var xj = coords[j]
        var yj = coords[j + 1]
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
        j = i
      }
      return inside
    }
    return coords.length >= 4 && x >= coords[0] && x <= coords[2] && y >= coords[1] && y <= coords[3]
  }

  function findArea(map, x, y) {
    if (!map || typeof map.querySelectorAll !== 'function') return null
    var areas = map.querySelectorAll('area')
    for (var i = 0; i < areas.length; i++) {
      var area = areas[i]
      if (!area || typeof area.getAttribute !== 'function') continue
      var shape = area.getAttribute('shape')
      var coords = parseCoords(area.getAttribute('coords'))
      if (coords && pointInShape(shape ? String(shape).toLowerCase() : 'rect', coords, x, y)) return area
    }
    return null
  }

  // The game's mobile tap path replaces `$.fn.click` with `$.fn.tap` so a
  // no-argument `.click()` fires the custom 'tap' handlers. On PC the native
  // click semantics own the menu and synthesizing clicks would double-fire, so
  // the guard must stay inert unless the tap override is active.
  function tapPathActive($) {
    return Boolean(
      $ &&
      typeof $ === 'function' &&
      $.fn &&
      typeof $.fn.click === 'function' &&
      typeof $.fn.tap === 'function' &&
      $.fn.click === $.fn.tap
    )
  }

  function bumpCounter(root, name) {
    if (!root || typeof root.getAttribute !== 'function' || typeof root.setAttribute !== 'function') return
    var current = parseInt(root.getAttribute(name) || '0', 10) || 0
    root.setAttribute(name, String(current + 1))
  }

  function retarget(document, $, kag, event, report) {
    var target = event && event.target
    if (!target || target.nodeType !== 1 || typeof target.getAttribute !== 'function') return false
    var usemap = target.getAttribute('usemap')
    if (!usemap || usemap.charAt(0) !== '#') return false
    if (!tapPathActive($)) return false
    bumpCounter(document && document.documentElement, 'data-dc-image-map-touch-seen')
    // `usemap` resolves through the map element's `name` (the game's menu.html
    // only sets `name="map"`), so fall back from `getElementById` to
    // `getElementsByName` exactly like the browser's own image-map lookup.
    var map = findMapElement(document, usemap.slice(1))
    if (!map) {
      if (typeof report === 'function') report('map-missing')
      return false
    }
    var rect = typeof target.getBoundingClientRect === 'function' ? target.getBoundingClientRect() : null
    if (!rect || !rect.width || !rect.height) return false
    var touch = event.changedTouches && event.changedTouches[0]
    var clientX = touch ? touch.clientX : event.clientX
    var clientY = touch ? touch.clientY : event.clientY
    if (typeof clientX !== 'number' || typeof clientY !== 'number') return false
    // Area coords are authored in the Tyrano design space (scWidth x scHeight),
    // while the rendered image box is scaled by the browser transform.
    var config = kag && kag.config
    var designWidth = Number(config && config.scWidth) || 0
    var designHeight = Number(config && config.scHeight) || 0
    if (!designWidth || !designHeight) return false
    var x = ((clientX - rect.left) / rect.width) * designWidth
    var y = ((clientY - rect.top) / rect.height) * designHeight
    var area = findArea(map, x, y)
    if (!area) return false
    var $area = $(area)
    // The game's own polyfill stamps `event.tap.moved` on touchstart; if the
    // area already received this touch, let its own touchend handler finish.
    if (typeof $area.data === 'function' && $area.data('event.tap.moved') !== undefined) return false
    if (typeof $area.trigger !== 'function') return false
    $area.trigger('click').click()
    bumpCounter(document && document.documentElement, 'data-dc-image-map-touch-hits')
    return true
  }

  function install(document, $, kag) {
    if (!document || typeof document.addEventListener !== 'function') return false
    if (!kag) return false
    if (document.__dcImageMapTouchInstalled) return true
    var mapWarningIssued = false
    document.addEventListener('touchend', function (event) {
      retarget(document, $, kag, event, function (issue) {
        if (issue === 'map-missing' && !mapWarningIssued) {
          mapWarningIssued = true
          if (consoleRef && typeof consoleRef.warn === 'function') {
            consoleRef.warn('Tyrano image-map touch guard: touched an <img usemap> whose <map> could not be resolved; image-map menu taps are not retargeted')
          }
        }
      })
    }, false)
    document.__dcImageMapTouchInstalled = true
    return true
  }

  DCWeb.TyranoImageMapTouch = {
    install: install,
    retarget: retarget,
    findArea: findArea,
    pointInShape: pointInShape,
  }
})(typeof window !== 'undefined' ? window : globalThis)
