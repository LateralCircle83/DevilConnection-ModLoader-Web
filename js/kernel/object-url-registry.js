;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var Path = DCWeb.ResourcePath
  var CATEGORY_NAMES = ['style', 'image', 'audio', 'video', 'font', 'text', 'binary']

  function createCategoryStats() {
    var stats = {}
    CATEGORY_NAMES.forEach(function (name) {
      stats[name] = { count: 0, logicalBytes: 0, peakCount: 0, peakLogicalBytes: 0 }
    })
    return stats
  }

  function categoryFor(path, blob) {
    var extension = Path.extensionOf(path)
    var mimeType = String(blob && blob.type || '').split(';')[0].toLowerCase()
    if (extension === '.css' || mimeType === 'text/css') return 'style'
    if (/^image\//.test(mimeType) || /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)$/.test(extension)) return 'image'
    if (/^audio\//.test(mimeType) || /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|weba)$/.test(extension)) return 'audio'
    if (/^video\//.test(mimeType) || /\.(?:m4v|mp4|ogv|webm)$/.test(extension)) return 'video'
    if (/^font\//.test(mimeType) || /\.(?:eot|otf|ttf|woff2?)$/.test(extension)) return 'font'
    if (/^text\//.test(mimeType) || /(?:javascript|json|xml)$/.test(mimeType) || /\.(?:csv|html?|js|json|ks|md|tjs|txt|xml)$/.test(extension)) return 'text'
    return 'binary'
  }

  function replaceLiteral(value, search, replacement) {
    return value.indexOf(search) === -1 ? value : value.split(search).join(replacement)
  }

  function ObjectUrlRegistry() {
    this.urlsByKey = new Map()
    this.pathsByUrl = new Map()
    this.sizesByKey = new Map()
    this.categoriesByKey = new Map()
    this.categoryStats = createCategoryStats()
    this.currentBytes = 0
    this.peakBytes = 0
    this.peakCount = 0
  }

  ObjectUrlRegistry.prototype.updatePeak = function () {
    this.peakCount = Math.max(this.peakCount, this.urlsByKey.size)
    this.peakBytes = Math.max(this.peakBytes, this.currentBytes)
    CATEGORY_NAMES.forEach(function (name) {
      var stats = this.categoryStats[name]
      stats.peakCount = Math.max(stats.peakCount, stats.count)
      stats.peakLogicalBytes = Math.max(stats.peakLogicalBytes, stats.logicalBytes)
    }, this)
  }

  ObjectUrlRegistry.prototype.addSize = function (key, path, blob) {
    var size = Number(blob && blob.size) || 0
    var category = categoryFor(path, blob)
    this.sizesByKey.set(key, size)
    this.categoriesByKey.set(key, category)
    this.currentBytes += size
    this.categoryStats[category].count++
    this.categoryStats[category].logicalBytes += size
  }

  ObjectUrlRegistry.prototype.removeSize = function (key) {
    var size = this.sizesByKey.get(key) || 0
    var category = this.categoriesByKey.get(key)
    this.currentBytes -= size
    if (category) {
      this.categoryStats[category].count--
      this.categoryStats[category].logicalBytes -= size
    }
    this.sizesByKey.delete(key)
    this.categoriesByKey.delete(key)
  }

  ObjectUrlRegistry.prototype.get = function (key) {
    return this.urlsByKey.get(key) || ''
  }

  ObjectUrlRegistry.prototype.createSource = function (key, path, source, trackedBlob) {
    var existing = this.get(key)
    if (existing) return existing
    var url = URL.createObjectURL(source)
    this.urlsByKey.set(key, url)
    this.pathsByUrl.set(url, path)
    this.addSize(key, path, trackedBlob || source)
    this.updatePeak()
    return url
  }

  ObjectUrlRegistry.prototype.create = function (key, path, blob) {
    return this.createSource(key, path, blob, blob)
  }

  ObjectUrlRegistry.prototype.replace = function (key, path, blob) {
    var existing = this.get(key)
    if (existing) {
      URL.revokeObjectURL(existing)
      this.pathsByUrl.delete(existing)
      this.removeSize(key)
    }
    var url = URL.createObjectURL(blob)
    this.urlsByKey.set(key, url)
    this.pathsByUrl.set(url, path)
    this.addSize(key, path, blob)
    this.updatePeak()
    return url
  }

  ObjectUrlRegistry.prototype.revoke = function (key) {
    var url = this.get(key)
    if (!url) return false
    URL.revokeObjectURL(url)
    this.urlsByKey.delete(key)
    this.pathsByUrl.delete(url)
    this.removeSize(key)
    return true
  }

  ObjectUrlRegistry.prototype.stats = function () {
    var categories = {}
    CATEGORY_NAMES.forEach(function (name) {
      var stats = this.categoryStats[name]
      categories[name] = {
        count: stats.count,
        logicalBytes: stats.logicalBytes,
        peakCount: stats.peakCount,
        peakLogicalBytes: stats.peakLogicalBytes,
      }
    }, this)
    return {
      count: this.urlsByKey.size,
      logicalBytes: this.currentBytes,
      peakCount: this.peakCount,
      peakLogicalBytes: this.peakBytes,
      categories: categories,
    }
  }

  ObjectUrlRegistry.prototype.restore = function (value) {
    if (typeof value !== 'string' || !/blob(?::|%3a|%253a)/i.test(value)) return value
    var restored = value
    this.pathsByUrl.forEach(function (path, url) {
      var urlVariant = url
      var pathVariant = Path.encode(path)
      for (var depth = 0; depth < 3; depth++) {
        restored = replaceLiteral(restored, urlVariant, pathVariant)
        urlVariant = encodeURIComponent(urlVariant)
        pathVariant = encodeURIComponent(pathVariant)
      }
    })
    return restored
  }

  ObjectUrlRegistry.prototype.release = function () {
    this.urlsByKey.forEach(function (url) { URL.revokeObjectURL(url) })
    this.urlsByKey.clear()
    this.pathsByUrl.clear()
    this.sizesByKey.clear()
    this.categoriesByKey.clear()
    this.currentBytes = 0
    CATEGORY_NAMES.forEach(function (name) {
      this.categoryStats[name].count = 0
      this.categoryStats[name].logicalBytes = 0
    }, this)
  }

  DCWeb.ObjectUrlRegistry = ObjectUrlRegistry
})(window)
