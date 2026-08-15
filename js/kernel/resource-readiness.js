;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var DEFAULT_TIMEOUT_MS = 15000
  var VIDEO_FRAME_FALLBACK_MS = 750
  var MEDIA_EVENTS = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'waiting', 'stalled', 'error']
  var controllers = new WeakMap()

  function ResourceReadiness(target, options) {
    options = options || {}
    this.target = target
    this.timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS
    this.states = new WeakMap()
    this.active = new Set()
    this.stats = { active: 0, canceled: 0, completed: 0, failed: 0, timedOut: 0, peakActive: 0, peakImageRgbaBytes: 0 }
    this.media = { assignments: 0, observed: 0, events: Object.create(null), last: null }
    this.mediaSources = new WeakMap()
    this.observedVideos = new WeakSet()
    this.canceled = false
    this.setTimer = (target.setTimeout || global.setTimeout || setTimeout).bind(target)
    this.clearTimer = (target.clearTimeout || global.clearTimeout || clearTimeout).bind(target)
    MEDIA_EVENTS.forEach(function (type) { this.media.events[type] = 0 }, this)
    this.publish()
    if (typeof target.addEventListener === 'function') {
      var readiness = this
      target.addEventListener('pagehide', function () { readiness.cancel() }, { once: true })
    }
  }

  ResourceReadiness.prototype.publish = function (source) {
    var root = this.target.document && this.target.document.documentElement
    if (!root || !root.setAttribute) return
    var stats = this.stats
    root.setAttribute('data-dc-readiness-state', this.canceled ? 'canceled' : (stats.active ? 'waiting' : 'idle'))
    root.setAttribute('data-dc-readiness-active', String(stats.active))
    root.setAttribute('data-dc-readiness-canceled', String(stats.canceled))
    root.setAttribute('data-dc-readiness-completed', String(stats.completed))
    root.setAttribute('data-dc-readiness-failed', String(stats.failed))
    root.setAttribute('data-dc-readiness-timeouts', String(stats.timedOut))
    root.setAttribute('data-dc-readiness-peak', String(stats.peakActive))
    root.setAttribute('data-dc-readiness-peak-image-rgba-bytes', String(stats.peakImageRgbaBytes))
    if (source) root.setAttribute('data-dc-readiness-last', String(source).slice(-240))
  }

  ResourceReadiness.prototype.publishMedia = function (element, event) {
    var root = this.target.document && this.target.document.documentElement
    if (!root || !root.setAttribute) return
    var error = element && element.error
    this.media.last = {
      errorCode: Number(error && error.code) || 0,
      errorMessage: String(error && error.message || ''),
      event: String(event || ''),
      networkState: Number(element && element.networkState) || 0,
      readyState: Number(element && element.readyState) || 0,
      source: String(this.mediaSources.get(element) || ''),
      videoHeight: Number(element && element.videoHeight) || 0,
      videoWidth: Number(element && element.videoWidth) || 0,
    }
    root.setAttribute('data-dc-media-assignments', String(this.media.assignments))
    root.setAttribute('data-dc-media-last-event', this.media.last.event)
    root.setAttribute('data-dc-media-last-source', this.media.last.source.slice(-240))
    root.setAttribute('data-dc-media-error-code', String(this.media.last.errorCode))
    root.setAttribute('data-dc-media-last-error', this.media.last.errorMessage.slice(0, 500))
    root.setAttribute('data-dc-media-ready-state', String(this.media.last.readyState))
    root.setAttribute('data-dc-media-network-state', String(this.media.last.networkState))
    root.setAttribute('data-dc-media-video-width', String(this.media.last.videoWidth))
    root.setAttribute('data-dc-media-video-height', String(this.media.last.videoHeight))
  }

  ResourceReadiness.prototype.observeVideo = function (element, source) {
    if (!element) return
    var normalizedSource = String(source || '')
    if (normalizedSource && this.mediaSources.get(element) !== normalizedSource) {
      this.mediaSources.set(element, normalizedSource)
      this.media.assignments++
    }
    if (!this.observedVideos.has(element) && typeof element.addEventListener === 'function') {
      this.observedVideos.add(element)
      this.media.observed++
      var readiness = this
      MEDIA_EVENTS.forEach(function (type) {
        element.addEventListener(type, function () {
          readiness.media.events[type]++
          readiness.publishMedia(element, type)
        })
      })
    }
    this.publishMedia(element, 'source-assigned')
  }

  ResourceReadiness.prototype.slotFor = function (element) {
    var slot = this.states.get(element)
    if (!slot) {
      slot = Object.create(null)
      this.states.set(element, slot)
    }
    return slot
  }

  ResourceReadiness.prototype.finish = function (state, outcome) {
    if (!state || state.settled) return
    state.settled = true
    state.cleanups.splice(0).forEach(function (cleanup) {
      try { cleanup() } catch (error) {}
    })
    this.active.delete(state)
    this.stats.active--
    var slot = this.states.get(state.element)
    if (slot && slot[state.kind] === state) delete slot[state.kind]
    if (outcome === 'completed') {
      this.stats.completed++
      if (state.kind === 'image') {
        var pixels = (Number(state.element.naturalWidth) || 0) * (Number(state.element.naturalHeight) || 0)
        this.stats.peakImageRgbaBytes = Math.max(this.stats.peakImageRgbaBytes, pixels * 4)
      }
    } else if (outcome === 'canceled') this.stats.canceled++
    else if (outcome === 'timed-out') this.stats.timedOut++
    else this.stats.failed++
    this.publish(state.source)
    state.resolve(state.element)
  }

  ResourceReadiness.prototype.begin = function (element, kind, source, setup) {
    var PromiseCtor = this.target.Promise || global.Promise || Promise
    if (!element || this.canceled) return PromiseCtor.resolve(element)
    var slot = this.slotFor(element)
    var existing = slot[kind]
    if (existing && !existing.settled && existing.source === source) return existing.promise
    if (existing) this.finish(existing, 'canceled')

    var resolvePromise
    var state = {
      cleanups: [],
      element: element,
      kind: kind,
      promise: new PromiseCtor(function (resolve) { resolvePromise = resolve }),
      resolve: function (value) { resolvePromise(value) },
      settled: false,
      source: String(source || ''),
    }
    slot[kind] = state
    this.active.add(state)
    this.stats.active++
    this.stats.peakActive = Math.max(this.stats.peakActive, this.stats.active)
    var readiness = this
    var timeout = this.setTimer(function () { readiness.finish(state, 'timed-out') }, this.timeoutMs)
    state.cleanups.push(function () { readiness.clearTimer(timeout) })
    this.publish(source)

    function complete() {
      if (state.settled) return
      readiness.finish(state, 'completed')
    }
    function fail() { readiness.finish(state, 'failed') }
    function listen(target, type, callback) {
      if (!target || typeof target.addEventListener !== 'function') return false
      target.addEventListener(type, callback)
      state.cleanups.push(function () { target.removeEventListener(type, callback) })
      return true
    }
    try { setup(state, complete, fail, listen) } catch (error) { fail() }
    return state.promise
  }

  ResourceReadiness.prototype.waitForImage = function (element, source) {
    var readiness = this
    return this.begin(element, 'image', source, function (state, complete, fail, listen) {
      function decode() {
        if (state.settled) return
        if (typeof element.decode === 'function') {
          var decoded
          try { decoded = element.decode() } catch (error) { fail(); return }
          ;(readiness.target.Promise || global.Promise || Promise).resolve(decoded).then(complete, fail)
          return
        }
        if (element.complete) {
          if (!('naturalWidth' in element) || Number(element.naturalWidth) > 0) complete()
          else fail()
          return
        }
        if (!listen(element, 'load', complete)) complete()
        listen(element, 'error', fail)
      }
      ;(readiness.target.Promise || global.Promise || Promise).resolve().then(decode)
    })
  }

  ResourceReadiness.prototype.waitForVideo = function (element, source) {
    var readiness = this
    this.observeVideo(element, source)
    return this.begin(element, 'video', source, function (state, complete, fail, listen) {
      var frameRequested = false
      function playable() {
        if (state.settled || Number(element.readyState) < 3) return
        if (frameRequested || typeof element.requestVideoFrameCallback !== 'function' || (element.paused && !element.autoplay)) {
          complete()
          return
        }
        frameRequested = true
        var frameId = element.requestVideoFrameCallback(complete)
        if (typeof element.cancelVideoFrameCallback === 'function') {
          state.cleanups.push(function () { element.cancelVideoFrameCallback(frameId) })
        }
        var fallback = readiness.setTimer(complete, VIDEO_FRAME_FALLBACK_MS)
        state.cleanups.push(function () { readiness.clearTimer(fallback) })
      }
      listen(element, 'loadeddata', playable)
      listen(element, 'canplay', playable)
      listen(element, 'playing', playable)
      listen(element, 'error', fail)
      playable()
    })
  }

  ResourceReadiness.prototype.waitForPreload = function (element, source) {
    var name = String(element && element.tagName || '').toUpperCase()
    if (name === 'IMG') return this.waitForImage(element, source)
    if (name === 'VIDEO') return this.waitForVideo(element, source)
    var PromiseCtor = this.target.Promise || global.Promise || Promise
    return PromiseCtor.resolve(element)
  }

  ResourceReadiness.prototype.clear = function (element, kind) {
    var slot = this.states.get(element)
    if (slot && slot[kind]) this.finish(slot[kind], 'canceled')
  }

  ResourceReadiness.prototype.cancel = function () {
    if (this.canceled) return
    this.canceled = true
    Array.from(this.active).forEach(function (state) { this.finish(state, 'canceled') }, this)
    this.publish()
  }

  ResourceReadiness.prototype.report = function () {
    var events = {}
    Object.keys(this.media.events).forEach(function (type) { events[type] = this.media.events[type] }, this)
    return {
      media: { assignments: this.media.assignments, events: events, last: this.media.last, observed: this.media.observed },
      readiness: Object.assign({}, this.stats),
    }
  }

  function forTarget(target, options) {
    if (!target) throw new TypeError('ResourceReadiness requires a target')
    var readiness = controllers.get(target)
    if (!readiness) {
      readiness = new ResourceReadiness(target, options)
      controllers.set(target, readiness)
    }
    return readiness
  }

  DCWeb.ResourceReadiness = {
    Controller: ResourceReadiness,
    forTarget: forTarget,
    reportFor: function (target) {
      var readiness = controllers.get(target)
      return readiness ? readiness.report() : null
    },
  }
})(window)
