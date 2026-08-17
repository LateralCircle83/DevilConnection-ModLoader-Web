;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb || (global.DCWeb = {})

  function installTag(kag, tag) {
    if (!tag || typeof tag.start !== 'function') return false
    if (tag.start.__dcJumpGuard) return true

    var originalStart = tag.start
    function guardedJumpStart(pm) {
      var activeKag = this && this.kag ? this.kag : kag
      if (!activeKag || !activeKag.stat) return originalStart.call(this, pm)

      var previousStrongStop = activeKag.stat.is_strong_stop
      activeKag.stat.is_strong_stop = true
      try {
        return originalStart.call(this, pm)
      } catch (error) {
        activeKag.stat.is_strong_stop = previousStrongStop
        throw error
      }
    }
    guardedJumpStart.__dcJumpGuard = true
    tag.start = guardedJumpStart
    return true
  }

  function install(kag) {
    if (
      !kag ||
      !kag.stat ||
      !kag.ftag ||
      typeof kag.ftag.nextOrderWithLabel !== 'function'
    ) return false

    var installed = false
    var masterTag = kag.ftag.master_tag && kag.ftag.master_tag.jump
    var sourceTag = kag.tag && kag.tag.jump
    if (installTag(kag, masterTag)) installed = true
    if (sourceTag !== masterTag && installTag(kag, sourceTag)) installed = true
    return installed
  }

  DCWeb.TyranoJumpGuard = { install: install }
})(typeof window !== 'undefined' ? window : globalThis)
