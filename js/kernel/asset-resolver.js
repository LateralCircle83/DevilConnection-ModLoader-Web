;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var Path = DCWeb.ResourcePath

  function AssetResolver(vfs) {
    if (!vfs) throw new TypeError('AssetResolver requires a VFS')
    this.vfs = vfs
    this.registry = new DCWeb.ObjectUrlRegistry()
    this.preparedAssets = new Map()
    this.styleProcessor = new DCWeb.StyleProcessor(this)
  }

  AssetResolver.prototype.resolve = function (input, basePath) {
    return this.vfs.resolve(input, basePath)
  }

  AssetResolver.prototype.findPath = function (input, basePath) {
    return this.vfs.findPath(input, basePath)
  }

  AssetResolver.prototype.has = function (input, basePath) {
    return this.vfs.has(input, basePath)
  }

  AssetResolver.prototype.getBlob = function (input, basePath) {
    var resolved = this.resolve(input, basePath)
    if (!resolved) return null
    var prepared = this.preparedAssets.get(this.keyFor(resolved))
    return prepared ? prepared.blob : this.vfs.getBlob(input, basePath)
  }

  AssetResolver.prototype.readText = function (input, basePath) {
    var resolved = this.resolve(input, basePath)
    if (!resolved) return this.vfs.readText(input, basePath)
    var prepared = this.preparedAssets.get(this.keyFor(resolved))
    return prepared ? Promise.resolve(prepared.text) : this.vfs.readText(input, basePath)
  }

  AssetResolver.prototype.list = function (suffix) {
    return this.vfs.list(suffix)
  }

  AssetResolver.prototype.keyFor = function (resolved) {
    return this.vfs.revision + ':' + resolved.layerId + ':' + resolved.path
  }

  AssetResolver.prototype.hasPrepared = function (input, basePath) {
    var resolved = this.resolve(input, basePath)
    return Boolean(resolved && this.preparedAssets.has(this.keyFor(resolved)))
  }

  AssetResolver.prototype.prepareText = function (input, text, mimeType, basePath) {
    var resolved = this.resolve(input, basePath)
    if (!resolved) throw new Error('Cannot prepare a missing VFS asset: ' + input)
    var key = this.keyFor(resolved)
    var preparedText = String(text)
    var blob = new Blob([preparedText], { type: mimeType || Path.mimeForPath(resolved.path) })
    this.preparedAssets.set(key, { blob: blob, text: preparedText })
    return this.registry.replace(key, resolved.path, blob)
  }

  AssetResolver.prototype.getObjectUrl = function (input, basePath) {
    if (typeof input !== 'string' || Path.isOpaqueOrExternalUrl(input) || input.charAt(0) === '#') return input
    var resolved = this.resolve(input, basePath)
    if (!resolved) return input
    var key = this.keyFor(resolved)
    var url = this.registry.get(key)
    if (!url) url = this.registry.create(key, resolved.path, this.vfs.getBlob(input, basePath))
    return url + Path.fragmentOf(input)
  }

  AssetResolver.prototype.restoreObjectUrls = function (value) {
    return this.registry.restore(value)
  }

  AssetResolver.prototype.prepareStyles = function (onProgress) {
    return this.styleProcessor.prepareAll(onProgress)
  }

  AssetResolver.prototype.release = function () {
    this.registry.release()
    this.preparedAssets.clear()
  }

  DCWeb.AssetResolver = AssetResolver
})(window)
