;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb || (global.DCWeb = {})

  function isBackgroundResource(resource) {
    return /\/bgimage\//.test(String(resource && resource.storage || resource || ''))
  }

  function installTag(kag, tag) {
    if (!tag || typeof tag.start !== 'function') return false
    if (tag.start.__dcBgLatestWins) return true

    var originalStart = tag.start
    function guardedStart(pm) {
      kag.__dcBgSeq = (Number(kag.__dcBgSeq) || 0) + 1
      var seq = kag.__dcBgSeq
      if (pm && pm.storage) kag.__dcBgLatestStorage = String(pm.storage)
      var result = originalStart.call(this, pm)
      // The engine normalizes time=0 to wait=false before preloading; record the
      // effective wait so a blocking background is never dropped as stale.
      kag.__dcBgWaitBySeq[seq] = pm && pm.wait
      return result
    }
    guardedStart.__dcBgLatestWins = true
    tag.start = guardedStart
    return true
  }

  function installMovieTag(kag, tag) {
    if (!tag || typeof tag.start !== 'function') return false
    if (tag.start.__dcBgMovieLatestWins) return true

    var originalStart = tag.start
    var setTimer = global.setTimeout || setTimeout
    function guardedStart(pm) {
      kag.__dcBgSeq = (Number(kag.__dcBgSeq) || 0) + 1
      var seq = kag.__dcBgSeq
      if (pm && pm.bg) kag.__dcBgLatestStorage = String(pm.bg)
      var result = originalStart.call(this, pm)
      var doc = global.document
      var video = doc && typeof doc.getElementById === 'function'
        ? doc.getElementById(pm && pm.bgmode === 'true' ? 'bgmovie' : 'fgmovie')
        : null
      if (video && typeof video.addEventListener === 'function') {
        // The game plugin writes pm.bg into the base layer ~100ms after 'play'.
        // If a newer background request arrived, correct that late write back to
        // the newest requested storage instead of letting it win the slot.
        video.addEventListener('play', function () {
          setTimer(function () {
            if (seq !== (Number(kag.__dcBgSeq) || 0)) {
              var storage = kag.__dcBgLatestStorage
              if (storage && kag.layer && typeof kag.layer.getLayer === 'function') {
                try {
                  kag.layer.getLayer('base', 'fore').css(
                    'background-image',
                    'url(./data/bgimage/' + storage + ')'
                  )
                } catch (error) {}
              }
            }
          }, 150)
        })
      }
      return result
    }
    guardedStart.__dcBgMovieLatestWins = true
    tag.start = guardedStart
    return true
  }

  function install(kag) {
    if (
      !kag ||
      !kag.tag ||
      !kag.ftag ||
      !kag.ftag.master_tag ||
      typeof kag.preload !== 'function'
    ) return false

    if (kag.__dcBgSeq === undefined) {
      kag.__dcBgSeq = 0
      kag.__dcBgWaitBySeq = {}
    }

    var installed = false
    var masterTag = kag.ftag.master_tag
    var sourceTag = kag.tag
    ;['bg', 'bg2'].forEach(function (name) {
      if (installTag(kag, masterTag[name])) installed = true
      if (sourceTag[name] !== masterTag[name] && installTag(kag, sourceTag[name])) installed = true
    })
    if (installMovieTag(kag, masterTag.movie_with_bg)) installed = true
    if (sourceTag.movie_with_bg !== masterTag.movie_with_bg && installMovieTag(kag, sourceTag.movie_with_bg)) installed = true
    return installed
  }

  function guardCallback(kag, storage, callback) {
    if (typeof callback !== 'function' || !isBackgroundResource(storage)) return callback
    var seq = Number(kag && kag.__dcBgSeq) || 0
    return function () {
      var latest = Number(kag && kag.__dcBgSeq) || 0
      var wait = kag && kag.__dcBgWaitBySeq ? kag.__dcBgWaitBySeq[seq] : undefined
      if (kag && kag.__dcBgWaitBySeq) delete kag.__dcBgWaitBySeq[seq]
      // A newer background request supersedes this one. Blocking (wait=true)
      // callbacks still carry scenario progression and are never stale in
      // practice, so they are delivered defensively.
      if (seq !== latest && wait !== 'true') return
      return callback.apply(this, arguments)
    }
  }

  DCWeb.TyranoBgGuard = {
    guardCallback: guardCallback,
    install: install,
  }
})(typeof window !== 'undefined' ? window : globalThis)
