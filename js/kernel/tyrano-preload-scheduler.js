;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var Path = DCWeb.ResourcePath
  var DEFAULT_TIMEOUT_MS = 30000
  var CATEGORIES = ['image', 'audio', 'video', 'other']
  var DEFAULT_LIMITS = { total: 4, image: 4, audio: 2, video: 1, other: 2 }

  function sourceOf(resource) {
    if (resource && typeof resource === 'object') {
      return String(resource.storage || resource.src || resource.url || '')
    }
    return String(resource || '')
  }

  function categoryOf(resource) {
    var source = sourceOf(resource).toLowerCase()
    if (source.indexOf('data:audio/') === 0) return 'audio'
    if (source.indexOf('data:video/') === 0) return 'video'
    if (source.indexOf('data:application/json') === 0) return 'other'
    var extension = Path.extensionOf(Path.normalize(source))
    if (/\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav)$/.test(extension)) return 'audio'
    if (/\.(?:m4v|mp4|ogv|webm)$/.test(extension)) return 'video'
    if (extension === '.json') return 'other'
    return 'image'
  }

  function optionKey(options) {
    options = options || {}
    var singleUse = options.single_use
    return String(options.name || '') + ':' + (singleUse === undefined ? '' : typeof singleUse + ':' + String(singleUse))
  }

  function identityOf(resource) {
    var source = sourceOf(resource)
    if (/^https?:/i.test(source)) return source
    var normalized = Path.normalize(source)
    return normalized ? normalized.toLowerCase() : source
  }

  function limitsFrom(input) {
    input = input || {}
    var limits = {}
    Object.keys(DEFAULT_LIMITS).forEach(function (name) {
      var value = Number(input[name])
      limits[name] = Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_LIMITS[name]
    })
    return limits
  }

  function TyranoPreloadScheduler(target, runner, options) {
    if (!target || typeof runner !== 'function') throw new TypeError('TyranoPreloadScheduler requires a target and runner')
    options = options || {}
    this.target = target
    this.runner = runner
    this.limits = limitsFrom(options.limits)
    this.timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS
    this.queue = []
    this.pendingByKey = new Map()
    this.idleCallbacks = []
    this.activeByCategory = { image: 0, audio: 0, video: 0, other: 0 }
    this.activeCount = 0
    this.peakActive = 0
    this.completed = 0
    this.failed = 0
    this.timedOut = 0
    this.deduplicated = 0
    this.canceledCount = 0
    this.canceled = false
    this.draining = false
    this.setTimer = (target.setTimeout || global.setTimeout).bind(target)
    this.clearTimer = (target.clearTimeout || global.clearTimeout).bind(target)
    this.publish()
  }

  TyranoPreloadScheduler.prototype.stats = function () {
    return {
      active: this.activeCount,
      activeByCategory: {
        image: this.activeByCategory.image,
        audio: this.activeByCategory.audio,
        video: this.activeByCategory.video,
        other: this.activeByCategory.other,
      },
      canceled: this.canceledCount,
      completed: this.completed,
      deduplicated: this.deduplicated,
      failed: this.failed,
      peakActive: this.peakActive,
      queued: this.queue.length,
      timedOut: this.timedOut,
    }
  }

  TyranoPreloadScheduler.prototype.publish = function () {
    var root = this.target.document && this.target.document.documentElement
    if (!root) return
    var stats = this.stats()
    var state = this.canceled ? 'canceled' : (stats.active || stats.queued ? 'loading' : 'idle')
    root.setAttribute('data-dc-preload-state', state)
    root.setAttribute('data-dc-preload-active', String(stats.active))
    root.setAttribute('data-dc-preload-queued', String(stats.queued))
    root.setAttribute('data-dc-preload-peak', String(stats.peakActive))
    root.setAttribute('data-dc-preload-completed', String(stats.completed))
    root.setAttribute('data-dc-preload-failed', String(stats.failed))
    root.setAttribute('data-dc-preload-timeouts', String(stats.timedOut))
    root.setAttribute('data-dc-preload-deduplicated', String(stats.deduplicated))
    root.setAttribute('data-dc-preload-canceled', String(stats.canceled))
    root.setAttribute('data-dc-preload-timeout-ms', String(this.timeoutMs))
    root.setAttribute('data-dc-preload-limit-total', String(this.limits.total))
    CATEGORIES.forEach(function (category) {
      root.setAttribute('data-dc-preload-active-' + category, String(stats.activeByCategory[category]))
      root.setAttribute('data-dc-preload-limit-' + category, String(this.limits[category]))
    }, this)
  }

  TyranoPreloadScheduler.prototype.safeCallback = function (callback, args) {
    if (typeof callback !== 'function') return
    var target = this.target
    try {
      callback.apply(null, args || [])
    } catch (error) {
      this.setTimer(function () { throw error }, 0)
      if (target.console && typeof target.console.error === 'function') target.console.error(error)
    }
  }

  TyranoPreloadScheduler.prototype.keyFor = function (resource, options) {
    return categoryOf(resource) + ':' + identityOf(resource) + ':' + optionKey(options)
  }

  TyranoPreloadScheduler.prototype.canStart = function (job) {
    return this.activeCount < this.limits.total &&
      this.activeByCategory[job.category] < this.limits[job.category]
  }

  TyranoPreloadScheduler.prototype.enqueue = function (resource, callback, options) {
    var key = this.keyFor(resource, options)
    var existing = this.pendingByKey.get(key)
    if (existing) {
      if (typeof callback === 'function') existing.callbacks.push(callback)
      this.deduplicated++
      this.publish()
      return
    }

    var job = {
      callbacks: typeof callback === 'function' ? [callback] : [],
      category: categoryOf(resource),
      key: key,
      options: options || {},
      resource: resource,
      settled: false,
      started: false,
      timer: null,
    }
    this.pendingByKey.set(key, job)
    this.queue.push(job)
    this.drain()
  }

  TyranoPreloadScheduler.prototype.preload = function (storage, callback, options) {
    if (this.canceled) {
      this.safeCallback(callback, [])
      return
    }
    var resources = Array.isArray(storage) ? storage.slice() : [storage]
    if (!resources.length) {
      this.safeCallback(callback, [])
      this.notifyIdle()
      return
    }
    if (resources.length === 1) {
      this.enqueue(resources[0], callback, options)
      return
    }

    var scheduler = this
    var remaining = resources.length
    resources.forEach(function (resource) {
      scheduler.enqueue(resource, function () {
        remaining--
        if (remaining === 0) scheduler.safeCallback(callback, [])
      }, options)
    })
  }

  TyranoPreloadScheduler.prototype.start = function (job) {
    var scheduler = this
    job.started = true
    this.activeCount++
    this.activeByCategory[job.category]++
    this.peakActive = Math.max(this.peakActive, this.activeCount)
    job.timer = this.setTimer(function () {
      scheduler.finish(job, 'timed-out', [])
    }, this.timeoutMs)
    this.publish()

    try {
      var result = this.runner(job.resource, function () {
        scheduler.finish(job, 'completed', Array.prototype.slice.call(arguments))
      }, job.options)
      if (result && typeof result.then === 'function') {
        result.then(function (value) {
          scheduler.finish(job, 'completed', [value])
        }, function (error) {
          scheduler.reportFailure(job, error)
        })
      }
    } catch (error) {
      this.reportFailure(job, error)
    }
  }

  TyranoPreloadScheduler.prototype.reportFailure = function (job, error) {
    if (this.target.console && typeof this.target.console.warn === 'function') {
      this.target.console.warn('[DC preload] Failed; continuing without preload: ' + sourceOf(job.resource), error)
    }
    this.finish(job, 'failed', [])
  }

  TyranoPreloadScheduler.prototype.finish = function (job, outcome, args) {
    if (!job || job.settled) return
    job.settled = true
    if (job.timer !== null) this.clearTimer(job.timer)
    if (job.started) {
      this.activeCount--
      this.activeByCategory[job.category]--
    }
    this.pendingByKey.delete(job.key)
    if (outcome === 'completed') this.completed++
    if (outcome === 'failed') this.failed++
    if (outcome === 'timed-out') {
      this.timedOut++
      if (this.target.console && typeof this.target.console.warn === 'function') {
        this.target.console.warn('[DC preload] Timed out; continuing without preload: ' + sourceOf(job.resource))
      }
    }

    var callbacks = job.callbacks.slice()
    job.callbacks.length = 0
    this.drain()
    callbacks.forEach(function (callback) { this.safeCallback(callback, args) }, this)
    this.notifyIdle()
    this.publish()
  }

  TyranoPreloadScheduler.prototype.drain = function () {
    if (this.canceled || this.draining) return
    this.draining = true
    try {
      while (this.activeCount < this.limits.total) {
        var index = -1
        for (var offset = 0; offset < this.queue.length; offset++) {
          if (this.canStart(this.queue[offset])) {
            index = offset
            break
          }
        }
        if (index === -1) break
        var job = this.queue.splice(index, 1)[0]
        this.start(job)
      }
    } finally {
      this.draining = false
    }
    this.publish()
  }

  TyranoPreloadScheduler.prototype.whenIdle = function (callback) {
    if (typeof callback !== 'function') return
    if (this.activeCount === 0 && this.queue.length === 0) {
      this.safeCallback(callback, [])
      return
    }
    this.idleCallbacks.push(callback)
  }

  TyranoPreloadScheduler.prototype.notifyIdle = function () {
    if (this.activeCount !== 0 || this.queue.length !== 0 || !this.idleCallbacks.length) return
    var callbacks = this.idleCallbacks.splice(0)
    callbacks.forEach(function (callback) { this.safeCallback(callback, []) }, this)
  }

  TyranoPreloadScheduler.prototype.cancel = function () {
    if (this.canceled) return
    this.canceled = true
    var scheduler = this
    this.pendingByKey.forEach(function (job) {
      if (job.settled) return
      job.settled = true
      if (job.timer !== null) scheduler.clearTimer(job.timer)
      scheduler.canceledCount++
      job.callbacks.length = 0
    })
    this.queue.length = 0
    this.pendingByKey.clear()
    this.idleCallbacks.length = 0
    this.activeCount = 0
    CATEGORIES.forEach(function (category) { scheduler.activeByCategory[category] = 0 })
    this.publish()
  }

  DCWeb.TyranoPreloadScheduler = TyranoPreloadScheduler
})(window)
