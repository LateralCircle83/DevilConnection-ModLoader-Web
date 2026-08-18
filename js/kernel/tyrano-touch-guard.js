;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb || (global.DCWeb = {})
  var MARKER = '__dcEventLayerDedupe'
  var TAP_MARKER = '__dcNoStopTap'

  // The engine intentionally binds one advance handler to every
  // `.layer_event_click` element (the in-game layer and the body-level
  // letterbox clone), and the game's tap polyfill triggers the whole jQuery
  // set on one touchend. With a two-element set that fires the advance twice.
  // The intended contract is "taps in either area advance once", so after KAG
  // init we remove the duplicate handler from the body clone only. Letterbox
  // taps still reach the in-game handler through the set trigger.
  function dedupeEventLayerTap($) {
    if (!$ || typeof $ !== 'function') return false
    var clone = $('body > .layer_event_click')
    if (!clone || !clone.length || typeof clone.off !== 'function') return false
    clone.off('tap')
    return true
  }

  // The engine binds the event layer's tap polyfill in key_mouse.init, which
  // runs before the game's tap_effect plugin overrides $.event.tap. The early
  // libs.js polyfill calls preventDefault() and stopPropagation() on
  // touchstart, so touches on the event layer never bubble to body and the
  // game's tap_effect ripple (bound on body) never fires for dialogue taps.
  // The game itself later switches to a version without those calls; install
  // the same semantics up front so the event layer binds the game's final
  // behavior from the start. The later plugin override is identical, so it is
  // harmless. This is not a Web-only rewrite or a click/tap deduplicator: the
  // set trigger still fires exactly once per touchend because the clone's
  // duplicate advance handler was removed by dedupeEventLayerTap.
  function installTapPolyfill($) {
    if (!$ || typeof $ !== 'function' || !$.event) return false
    if ($.event.tap && $.event.tap[TAP_MARKER]) return true

    var patched = function (o) {
      if (!o || typeof o.bind !== 'function') return false
      o.bind('touchstart', function () {
        var onMove = function (event) {
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
        }
        var onEnd = function (event) {
          if (!o.data('event.tap.moved')) {
            o.unbind('touchmove', onMove)
            o.trigger('click').click()
          }
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
        }
        o.data('event.tap.moved', false)
          .one('touchmove', onMove)
          .one('touchend', onEnd)
      })
    }
    patched[TAP_MARKER] = true
    $.event.tap = patched
    return true
  }

  function install(kag, $) {
    var ok = false
    if (installTapPolyfill($)) ok = true
    if (!kag || typeof kag.init_game !== 'function') return ok
    if (kag.init_game[MARKER]) return true
    var originalInitGame = kag.init_game
    kag.init_game = function () {
      var result = originalInitGame.apply(this, arguments)
      dedupeEventLayerTap($)
      return result
    }
    kag.init_game[MARKER] = true
    return true
  }

  DCWeb.TyranoTouchGuard = {
    install: install,
    dedupeEventLayerTap: dedupeEventLayerTap,
    installTapPolyfill: installTapPolyfill,
  }
})(typeof window !== 'undefined' ? window : globalThis)
