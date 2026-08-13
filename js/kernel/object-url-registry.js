;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var Path = DCWeb.ResourcePath

  function replaceLiteral(value, search, replacement) {
    return value.indexOf(search) === -1 ? value : value.split(search).join(replacement)
  }

  function ObjectUrlRegistry() {
    this.urlsByKey = new Map()
    this.pathsByUrl = new Map()
  }

  ObjectUrlRegistry.prototype.get = function (key) {
    return this.urlsByKey.get(key) || ''
  }

  ObjectUrlRegistry.prototype.create = function (key, path, blob) {
    var existing = this.get(key)
    if (existing) return existing
    var url = URL.createObjectURL(blob)
    this.urlsByKey.set(key, url)
    this.pathsByUrl.set(url, path)
    return url
  }

  ObjectUrlRegistry.prototype.replace = function (key, path, blob) {
    var existing = this.get(key)
    if (existing) {
      URL.revokeObjectURL(existing)
      this.pathsByUrl.delete(existing)
    }
    var url = URL.createObjectURL(blob)
    this.urlsByKey.set(key, url)
    this.pathsByUrl.set(url, path)
    return url
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
  }

  DCWeb.ObjectUrlRegistry = ObjectUrlRegistry
})(window)
