;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var Path = DCWeb.ResourcePath
  var MAX_HEADER_BYTES = 64 * 1024 * 1024
  var decoder = new TextDecoder('utf-8')

  function asSafeInteger(value, name) {
    var number = Number(value)
    if (!Number.isSafeInteger(number) || number < 0) {
      throw new Error('Invalid ASAR ' + name + ': ' + value)
    }
    return number
  }

  function walkHeader(files, prefix, entries) {
    Object.keys(files || {}).forEach(function (name) {
      var node = files[name]
      var path = prefix ? prefix + '/' + name : name
      if (node && node.files) {
        walkHeader(node.files, path, entries)
        return
      }
      if (!node) return
      if (node.link) {
        entries.set(path, { path: path, link: Path.normalize(node.link) })
        return
      }
      if (node.size === undefined || node.offset === undefined) return
      entries.set(path, {
        path: path,
        size: asSafeInteger(node.size, 'size'),
        offset: asSafeInteger(node.offset, 'offset'),
        unpacked: Boolean(node.unpacked),
        integrity: node.integrity || null,
      })
    })
  }

  function AsarArchive(file, header, dataOffset, entries) {
    this.file = file
    this.header = header
    this.dataOffset = dataOffset
    this.entries = entries
    this.lowercasePaths = new Map()
    entries.forEach(function (_, path) {
      var lower = path.toLowerCase()
      if (!this.lowercasePaths.has(lower)) this.lowercasePaths.set(lower, path)
    }, this)
  }

  AsarArchive.open = async function (file) {
    if (!file || typeof file.slice !== 'function') throw new TypeError('A local app.asar file is required')
    if (file.size < 16) throw new Error('The selected file is too small to be an ASAR archive')

    var view = new DataView(await file.slice(0, 16).arrayBuffer())
    var marker = view.getUint32(0, true)
    var headerSize = view.getUint32(4, true)
    var headerPayloadSize = view.getUint32(8, true)
    var jsonSize = view.getUint32(12, true)
    if (marker !== 4 || headerPayloadSize + 4 !== headerSize) {
      throw new Error('The selected file does not have a supported Electron ASAR header')
    }
    if (!jsonSize || jsonSize > MAX_HEADER_BYTES || 16 + jsonSize > file.size) {
      throw new Error('The ASAR header size is invalid')
    }

    var header
    try {
      header = JSON.parse(decoder.decode(await file.slice(16, 16 + jsonSize).arrayBuffer()))
    } catch (error) {
      throw new Error('The ASAR file index is not valid JSON')
    }
    if (!header || !header.files) throw new Error('The ASAR archive has no file index')

    var entries = new Map()
    walkHeader(header.files, '', entries)
    var dataOffset = 8 + headerSize
    if (dataOffset > file.size) throw new Error('The ASAR data offset is outside the file')
    return new AsarArchive(file, header, dataOffset, entries)
  }

  AsarArchive.prototype.findPath = function (input, basePath) {
    var normalized = Path.normalize(input, basePath)
    if (!normalized) return ''
    if (this.entries.has(normalized)) return normalized
    return this.lowercasePaths.get(normalized.toLowerCase()) || ''
  }

  AsarArchive.prototype.getEntryByPath = function (path, seen) {
    var entry = this.entries.get(path)
    if (!entry || !entry.link) return entry || null
    seen = seen || new Set()
    if (seen.has(path)) throw new Error('Circular ASAR link: ' + path)
    seen.add(path)
    var linkedPath = this.entries.has(entry.link) ? entry.link : this.findPath(entry.link)
    return linkedPath ? this.getEntryByPath(linkedPath, seen) : null
  }

  AsarArchive.prototype.getEntry = function (input, basePath) {
    var path = this.findPath(input, basePath)
    return path ? this.getEntryByPath(path) : null
  }

  AsarArchive.prototype.has = function (input, basePath) {
    return Boolean(this.getEntry(input, basePath))
  }

  AsarArchive.prototype.getBlob = function (input, basePath) {
    var path = this.findPath(input, basePath)
    return path ? this.getBlobByPath(path) : null
  }

  AsarArchive.prototype.getBlobByPath = function (path) {
    var entry = this.getEntryByPath(path)
    if (!entry) return null
    if (entry.unpacked) throw new Error('ASAR unpacked entries are not available in browser mode: ' + path)
    var start = this.dataOffset + entry.offset
    var end = start + entry.size
    if (end > this.file.size) throw new Error('ASAR entry exceeds the selected file: ' + path)
    return this.file.slice(start, end, Path.mimeForPath(path))
  }

  AsarArchive.prototype.readText = async function (input, basePath) {
    var blob = this.getBlob(input, basePath)
    if (!blob) throw new Error('File not found in ASAR: ' + input)
    return blob.text()
  }

  AsarArchive.prototype.readTextByPath = async function (path) {
    var blob = this.getBlobByPath(path)
    if (!blob) throw new Error('File not found in ASAR: ' + path)
    return blob.text()
  }

  AsarArchive.prototype.list = function (suffix) {
    var normalizedSuffix = String(suffix || '').toLowerCase()
    return Array.from(this.entries.keys()).filter(function (path) {
      return !normalizedSuffix || path.toLowerCase().endsWith(normalizedSuffix)
    })
  }

  DCWeb.AsarArchive = AsarArchive
  global.DCAsar = {
    AsarArchive: AsarArchive,
    mimeForPath: Path.mimeForPath,
    normalizePath: Path.normalize,
  }
})(window)
