;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var TAG_KEYS = ['movie', 'movie_with_bg']
  var GESTURE_TYPES = ['pointerdown', 'touchend', 'keydown']
  var pendingByDocument = new WeakMap()

  function isAutoplayBlocked(error) {
    return Boolean(error && error.name === 'NotAllowedError')
  }

  function wrapStart(kag, tag) {
    if (!tag || typeof tag.start !== 'function') return false
    if (tag.start.__dcVideoUnlockStart) return true

    var originalStart = tag.start
    function guardedStart(pm) {
      var result = originalStart.apply(this, arguments)
      armLayerVideos(this && this.kag ? this.kag : kag)
      return result
    }
    guardedStart.__dcVideoUnlockStart = true
    tag.start = guardedStart
    return true
  }

  function armLayerVideos(kag) {
    if (!kag || !kag.layer || typeof kag.layer.getLayer !== 'function') return
    var videos = []
    try {
      var fix = kag.layer.getLayer('fix')
      var found = fix && typeof fix.find === 'function' ? fix.find('video') : []
      for (var i = 0; i < (found && found.length || 0); i++) videos.push(found[i])
    } catch (error) {}
    for (var j = 0; j < videos.length; j++) wrapVideo(videos[j])
  }

  function wrapVideo(video) {
    if (!video || typeof video.play !== 'function' || video.__dcVideoUnlockPlay) return

    var originalPlay = video.play
    function guardedPlay() {
      var result = originalPlay.call(video)
      if (result && typeof result.catch === 'function') {
        result.catch(function (error) {
          if (isAutoplayBlocked(error)) onAutoplayBlocked(video, originalPlay)
        })
      }
      return result
    }
    video.__dcVideoUnlockPlay = true
    video.play = guardedPlay
  }

  function publish(doc) {
    var root = doc && doc.documentElement
    if (!root || typeof root.setAttribute !== 'function') return
    var pending = pendingByDocument.get(doc)
    root.setAttribute('data-dc-video-unlock-pending', String(pending ? pending.entries.length : 0))
  }

  function onAutoplayBlocked(video, originalPlay) {
    var doc = video.ownerDocument
    if (!doc) return

    var intendedMuted = Boolean(video.muted)
    video.muted = true
    try {
      var silentResult = originalPlay.call(video)
      if (silentResult && typeof silentResult.catch === 'function') silentResult.catch(function () {})
    } catch (error) {}

    var pending = pendingByDocument.get(doc)
    if (!pending) {
      pending = { entries: [], listeners: [], pagehide: null }
      pendingByDocument.set(doc, pending)
      GESTURE_TYPES.forEach(function (type) {
        var listener = function () { unlockPending(doc) }
        pending.listeners.push(listener)
        doc.addEventListener(type, listener, { once: false, passive: true })
      })
      var win = doc.defaultView
      if (win && typeof win.addEventListener === 'function') {
        pending.pagehide = function () { disposePending(doc) }
        win.addEventListener('pagehide', pending.pagehide, { once: true })
      }
    }
    if (pending.entries.indexOf(video) === -1) {
      pending.entries.push({ video: video, originalPlay: originalPlay, intendedMuted: intendedMuted })
    }
    publish(doc)
  }

  function unlockPending(doc) {
    var pending = pendingByDocument.get(doc)
    if (!pending) return
    disposePending(doc)

    pending.entries.forEach(function (entry) {
      var video = entry.video
      if (!video || !video.ownerDocument) return
      if (typeof video.muted === 'boolean') video.muted = entry.intendedMuted
      var connected = typeof video.isConnected === 'boolean' ? video.isConnected : Boolean(doc.contains && doc.contains(video))
      if (video.ended || !connected) return
      try {
        var result = entry.originalPlay.call(video)
        if (result && typeof result.catch === 'function') result.catch(function () {})
      } catch (error) {}
    })
    pending.entries.length = 0
    publish(doc)
  }

  function disposePending(doc) {
    var pending = pendingByDocument.get(doc)
    if (!pending) return
    pending.listeners.forEach(function (listener) {
      GESTURE_TYPES.forEach(function (type) {
        doc.removeEventListener(type, listener)
      })
    })
    pending.listeners.length = 0
    if (pending.pagehide && doc.defaultView && typeof doc.defaultView.removeEventListener === 'function') {
      doc.defaultView.removeEventListener('pagehide', pending.pagehide)
    }
    pending.pagehide = null
    pendingByDocument.delete(doc)
    publish(doc)
  }

  function trapTag(kag, registry, key) {
    if (!registry || typeof registry !== 'object') return false
    var existing = registry[key]
    wrapStart(kag, existing)
    var stored = existing
    Object.defineProperty(registry, key, {
      configurable: true,
      enumerable: Boolean(existing),
      get: function () { return stored },
      set: function (value) {
        stored = value
        if (value && typeof value.start === 'function' && !value.start.__dcVideoUnlockStart) {
          wrapStart(kag, value)
        }
        Object.defineProperty(registry, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: value,
        })
      },
    })
    return true
  }

  function install(kag) {
    if (
      !kag ||
      !kag.tag ||
      typeof kag.tag !== 'object' ||
      !kag.ftag ||
      !kag.ftag.master_tag ||
      typeof kag.ftag.master_tag !== 'object'
    ) return false

    var installed = false
    TAG_KEYS.forEach(function (key) {
      if (trapTag(kag, kag.tag, key)) installed = true
      if (trapTag(kag, kag.ftag.master_tag, key)) installed = true
    })
    return installed
  }

  DCWeb.TyranoVideoUnlock = { install: install }
})(typeof window !== 'undefined' ? window : globalThis)
