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
    this.transientMedia = new Set()
    this.nextTransientId = 1
    this.released = false
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
    this.styleProcessor.materialize(resolved.path)
    var prepared = this.preparedAssets.get(this.keyFor(resolved))
    return prepared ? prepared.blob : this.vfs.getBlob(input, basePath)
  }

  AssetResolver.prototype.readText = function (input, basePath) {
    var resolved = this.resolve(input, basePath)
    if (!resolved) return this.vfs.readText(input, basePath)
    this.styleProcessor.materialize(resolved.path)
    var prepared = this.preparedAssets.get(this.keyFor(resolved))
    if (!prepared) return this.vfs.readText(input, basePath)
    return typeof prepared.text === 'string' ? Promise.resolve(prepared.text) : prepared.blob.text()
  }

  AssetResolver.prototype.list = function (suffix) {
    return this.vfs.list(suffix)
  }

  AssetResolver.prototype.keyFor = function (resolved) {
    return this.vfs.revision + ':' + resolved.layerId + ':' + resolved.path
  }

  AssetResolver.prototype.hasPrepared = function (input, basePath) {
    var resolved = this.resolve(input, basePath)
    return Boolean(resolved && (
      this.preparedAssets.has(this.keyFor(resolved)) ||
      this.styleProcessor.hasTemplate(resolved.path)
    ))
  }

  AssetResolver.prototype.prepareText = function (input, text, mimeType, basePath) {
    var resolved = this.resolve(input, basePath)
    if (!resolved) throw new Error('Cannot prepare a missing VFS asset: ' + input)
    var key = this.keyFor(resolved)
    if (this.registry.get(key)) throw new Error('Cannot prepare an asset after publishing its object URL: ' + resolved.path)
    var preparedText = String(text)
    var blob = new Blob([preparedText], { type: mimeType || Path.mimeForPath(resolved.path) })
    this.preparedAssets.set(key, { blob: blob, text: preparedText })
  }

  AssetResolver.prototype.prepareBinary = function (input, value, mimeType, basePath) {
    var resolved = this.resolve(input, basePath)
    if (!resolved) throw new Error('Cannot prepare a missing VFS asset: ' + input)
    if (value === undefined || value === null) throw new TypeError('Prepared binary asset requires data')
    var key = this.keyFor(resolved)
    if (this.registry.get(key)) throw new Error('Cannot prepare an asset after publishing its object URL: ' + resolved.path)
    var type = mimeType || Path.mimeForPath(resolved.path)
    var blob = value && typeof value.arrayBuffer === 'function' && Number.isFinite(Number(value.size))
      ? (value.type === type ? value : new Blob([value], { type: type }))
      : new Blob([value], { type: type })
    this.preparedAssets.set(key, { blob: blob, text: null })
  }

  AssetResolver.prototype.getObjectUrl = function (input, basePath) {
    if (typeof input !== 'string' || Path.isOpaqueOrExternalUrl(input) || input.charAt(0) === '#') return input
    var resolved = this.resolve(input, basePath)
    if (!resolved) return input
    this.styleProcessor.materialize(resolved.path)
    var key = this.keyFor(resolved)
    var url = this.registry.get(key)
    if (!url) url = this.registry.create(key, resolved.path, this.getBlob(input, basePath))
    return url + Path.fragmentOf(input)
  }

  AssetResolver.prototype.createMediaSourceObjectUrl = function (input, maxBytes, basePath) {
    var resolver = this
    var resolved = this.resolve(input, basePath)
    var limit = Number(maxBytes)
    if (!resolved || this.released || !Number.isFinite(limit) || limit <= 0 || !DCWeb.MediaSourceFallback) {
      return Promise.resolve(null)
    }
    var blob = this.getBlob(input, basePath)
    if (!blob || blob.size > limit) return Promise.resolve(null)

    return DCWeb.MediaSourceFallback.create(blob).then(function (representation) {
      if (!representation) return null
      if (resolver.released) {
        representation.release()
        return null
      }
      var key = resolver.keyFor(resolved) + ':media-source:' + resolver.nextTransientId++
      var url
      try {
        url = resolver.registry.createSource(key, resolved.path, representation.mediaSource, blob)
      } catch (error) {
        representation.release()
        throw error
      }
      var released = false
      var handle = {
        mimeType: representation.mimeType,
        ready: representation.ready,
        size: blob.size,
        url: url + Path.fragmentOf(input),
        release: function () {
          if (released) return false
          released = true
          resolver.transientMedia.delete(handle)
          representation.release()
          return resolver.registry.revoke(key)
        },
      }
      resolver.transientMedia.add(handle)
      return handle
    })
  }

  AssetResolver.prototype.restoreObjectUrls = function (value) {
    return this.registry.restore(value)
  }

  AssetResolver.prototype.prepareStyles = function (onProgress) {
    return this.styleProcessor.prepareAll(onProgress)
  }

  AssetResolver.prototype.getObjectUrlStats = function () {
    return this.registry.stats()
  }

  AssetResolver.prototype.release = function () {
    this.released = true
    Array.from(this.transientMedia).forEach(function (handle) { handle.release() })
    this.transientMedia.clear()
    this.registry.release()
    this.preparedAssets.clear()
    this.styleProcessor.release()
  }

  DCWeb.AssetResolver = AssetResolver
})(window)
