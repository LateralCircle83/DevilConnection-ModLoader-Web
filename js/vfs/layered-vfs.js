;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb

  function validateLayer(layer, index, ids) {
    if (!layer || typeof layer.id !== 'string' || !layer.id.trim()) {
      throw new TypeError('VFS layer ' + index + ' requires a stable id')
    }
    if (ids[layer.id]) throw new Error('Duplicate VFS layer id: ' + layer.id)
    if (!layer.source || typeof layer.source.findPath !== 'function' || typeof layer.source.getBlob !== 'function') {
      throw new TypeError('VFS layer ' + layer.id + ' does not provide an archive source')
    }
    ids[layer.id] = true
    return { id: layer.id, source: layer.source, kind: layer.kind || 'content' }
  }

  function LayeredVfs(layers) {
    this.layers = []
    this.revision = 0
    this.setLayers(layers || [])
  }

  LayeredVfs.prototype.setLayers = function (layers) {
    var ids = Object.create(null)
    this.layers = layers.map(function (layer, index) { return validateLayer(layer, index, ids) })
    this.revision++
    return this
  }

  LayeredVfs.prototype.addLayer = function (layer) {
    return this.setLayers(this.layers.concat([layer]))
  }

  LayeredVfs.prototype.resolve = function (input, basePath) {
    for (var index = this.layers.length - 1; index >= 0; index--) {
      var layer = this.layers[index]
      var path = layer.source.findPath(input, basePath)
      if (path) return { layerId: layer.id, kind: layer.kind, path: path, source: layer.source }
    }
    return null
  }

  LayeredVfs.prototype.findPath = function (input, basePath) {
    var resolved = this.resolve(input, basePath)
    return resolved ? resolved.path : ''
  }

  LayeredVfs.prototype.has = function (input, basePath) {
    return Boolean(this.resolve(input, basePath))
  }

  LayeredVfs.prototype.getBlob = function (input, basePath) {
    var resolved = this.resolve(input, basePath)
    if (!resolved) return null
    return resolved.source.getBlobByPath
      ? resolved.source.getBlobByPath(resolved.path)
      : resolved.source.getBlob(resolved.path)
  }

  LayeredVfs.prototype.readText = async function (input, basePath) {
    var resolved = this.resolve(input, basePath)
    if (!resolved) throw new Error('File not found in VFS: ' + input)
    return resolved.source.readTextByPath
      ? resolved.source.readTextByPath(resolved.path)
      : resolved.source.readText(resolved.path)
  }

  LayeredVfs.prototype.list = function (suffix) {
    var visible = new Map()
    this.layers.forEach(function (layer) {
      layer.source.list(suffix).forEach(function (path) { visible.set(path.toLowerCase(), path) })
    })
    return Array.from(visible.values())
  }

  DCWeb.LayeredVfs = LayeredVfs
})(window)
