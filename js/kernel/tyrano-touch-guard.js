;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb || (global.DCWeb = {})
  var MARKER = '__dcEventLayerDedupe'

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

  function install(kag, $) {
    if (!kag || typeof kag.init_game !== 'function') return false
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
  }
})(typeof window !== 'undefined' ? window : globalThis)
