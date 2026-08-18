;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb || (global.DCWeb = {})

  function installTag(kag, kind, tag) {
    if (!tag || typeof tag.start !== 'function') return false
    if (tag.start.__dcCharaLatestWins) return true

    var originalStart = tag.start
    function guardedStart(pm) {
      var name = pm && pm.name
      if (!name) return originalStart.call(this, pm)

      var seqMap = kag.__dcCharaSeq[kind]
      var seq = (seqMap[name] = (seqMap[name] || 0) + 1)
      if (!kag.__dcCharaWait[kind][name]) kag.__dcCharaWait[kind][name] = {}

      var previousContext = kag.__dcCharaContext
      kag.__dcCharaContext = { kind: kind, name: name, seq: seq }
      try {
        return originalStart.call(this, pm)
      } finally {
        kag.__dcCharaWait[kind][name][seq] = pm && pm.wait
        kag.__dcCharaContext = previousContext
      }
    }
    guardedStart.__dcCharaLatestWins = true
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

    if (!kag.__dcCharaSeq) {
      kag.__dcCharaSeq = { show: {}, mod: {} }
      kag.__dcCharaWait = { show: {}, mod: {} }
    }

    var installed = false
    var masterTag = kag.ftag.master_tag
    var sourceTag = kag.tag
    ;['show', 'mod'].forEach(function (kind) {
      var tagName = 'chara_' + kind
      if (installTag(kag, kind, masterTag[tagName])) installed = true
      if (sourceTag[tagName] !== masterTag[tagName] && installTag(kag, kind, sourceTag[tagName])) installed = true
    })
    return installed
  }

  function guardCallback(kag, storage, callback) {
    if (typeof callback !== 'function') return callback
    var context = kag && kag.__dcCharaContext
    if (!context || !context.name || !kag.__dcCharaSeq || !kag.__dcCharaSeq[context.kind]) return callback

    var kind = context.kind
    var name = context.name
    var seq = context.seq
    return function () {
      var latest = kag.__dcCharaSeq[kind][name] || 0
      var wait = kag.__dcCharaWait[kind][name] ? kag.__dcCharaWait[kind][name][seq] : undefined
      if (kag.__dcCharaWait[kind][name]) delete kag.__dcCharaWait[kind][name][seq]
      // Only the newest request of the same operation kind wins. A newer mod
      // must not drop a pending show: the show creates the character element and
      // reads the latest recorded storage, so it still has to land.
      if (seq !== latest && wait !== 'true') return
      return callback.apply(this, arguments)
    }
  }

  DCWeb.TyranoCharaGuard = {
    guardCallback: guardCallback,
    install: install,
  }
})(typeof window !== 'undefined' ? window : globalThis)
