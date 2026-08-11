;(function (global) {
  'use strict'

  var MAX_HEADER_BYTES = 64 * 1024 * 1024
  var decoder = new TextDecoder('utf-8')

  var MIME_TYPES = {
    '.css': 'text/css;charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html;charset=utf-8',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript;charset=utf-8',
    '.json': 'application/json;charset=utf-8',
    '.ks': 'text/plain;charset=utf-8',
    '.m4a': 'audio/mp4',
    '.mjs': 'text/javascript;charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.oga': 'audio/ogg',
    '.ogg': 'audio/ogg',
    '.otf': 'font/otf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.tjs': 'text/plain;charset=utf-8',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain;charset=utf-8',
    '.wav': 'audio/wav',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }

  function extensionOf(path) {
    var clean = String(path || '').split(/[?#]/, 1)[0]
    var dot = clean.lastIndexOf('.')
    return dot === -1 ? '' : clean.substring(dot).toLowerCase()
  }

  function mimeForPath(path) {
    return MIME_TYPES[extensionOf(path)] || 'application/octet-stream'
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value)
    } catch (error) {
      return value
    }
  }

  function collapseSegments(path) {
    var output = []
    String(path || '')
      .replace(/\\/g, '/')
      .split('/')
      .forEach(function (segment) {
        if (!segment || segment === '.') return
        if (segment === '..') {
          output.pop()
          return
        }
        output.push(segment)
      })
    return output.join('/')
  }

  function isOpaqueOrExternalUrl(value) {
    return /^(?:blob:|data:|javascript:|mailto:|tel:)/i.test(value)
  }

  function normalizePath(input, basePath) {
    if (typeof input !== 'string') return ''
    var raw = input.trim()
    if (!raw || raw.charAt(0) === '#' || isOpaqueOrExternalUrl(raw)) return ''

    if (/^https?:/i.test(raw)) {
      try {
        raw = new URL(raw).pathname
      } catch (error) {
        return ''
      }
    }

    raw = safeDecode(raw.split('#', 1)[0].split('?', 1)[0])
    raw = raw.replace(/\\/g, '/')
    raw = raw.replace(/^file:\/\/\/?/i, '')

    var anchored = raw.match(/(?:^|\/)(data|tyrano)\/(.+)$/i)
    if (anchored) {
      return collapseSegments(anchored[1] + '/' + anchored[2])
    }

    raw = raw.replace(/^[a-z]:\//i, '').replace(/^\/+/, '')
    if (basePath) {
      var baseDir = collapseSegments(basePath).split('/')
      baseDir.pop()
      raw = baseDir.concat(raw.split('/')).join('/')
    }
    return collapseSegments(raw)
  }

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
        entries.set(path, { path: path, link: normalizePath(node.link) })
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

  function resolveCssPath(cssPath, rawPath) {
    var value = rawPath.trim().replace(/^['"]|['"]$/g, '')
    if (!value || value.charAt(0) === '#' || isOpaqueOrExternalUrl(value) || /^https?:/i.test(value)) return ''
    return normalizePath(value, cssPath)
  }

  function AsarArchive(file, header, dataOffset, entries) {
    this.file = file
    this.header = header
    this.dataOffset = dataOffset
    this.entries = entries
    this.lowercasePaths = new Map()
    this.objectUrls = new Map()
    this.preparedUrls = new Map()
    this.pathsByObjectUrl = new Map()

    entries.forEach(
      function (_, path) {
        var lower = path.toLowerCase()
        if (!this.lowercasePaths.has(lower)) this.lowercasePaths.set(lower, path)
      }.bind(this),
    )
  }

  AsarArchive.open = async function (file) {
    if (!file || typeof file.slice !== 'function') {
      throw new TypeError('A local app.asar file is required')
    }
    if (file.size < 16) throw new Error('The selected file is too small to be an ASAR archive')

    var prefix = await file.slice(0, 16).arrayBuffer()
    var view = new DataView(prefix)
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

    var headerText = decoder.decode(await file.slice(16, 16 + jsonSize).arrayBuffer())
    var header
    try {
      header = JSON.parse(headerText)
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
    var normalized = normalizePath(input, basePath)
    if (!normalized) return ''
    if (this.entries.has(normalized)) return normalized
    return this.lowercasePaths.get(normalized.toLowerCase()) || ''
  }

  AsarArchive.prototype.getEntry = function (input, basePath, seen) {
    var path = this.findPath(input, basePath)
    if (!path) return null
    var entry = this.entries.get(path)
    if (!entry || !entry.link) return entry || null

    seen = seen || new Set()
    if (seen.has(path)) throw new Error('Circular ASAR link: ' + path)
    seen.add(path)
    return this.getEntry(entry.link, '', seen)
  }

  AsarArchive.prototype.has = function (input, basePath) {
    return Boolean(this.getEntry(input, basePath))
  }

  AsarArchive.prototype.getBlob = function (input, basePath) {
    var path = this.findPath(input, basePath)
    var entry = this.getEntry(path)
    if (!entry) return null
    if (entry.unpacked) {
      throw new Error('ASAR unpacked entries are not available in browser mode: ' + path)
    }

    var start = this.dataOffset + entry.offset
    var end = start + entry.size
    if (end > this.file.size) {
      throw new Error('ASAR entry exceeds the selected file: ' + path)
    }
    return this.file.slice(start, end, mimeForPath(path))
  }

  AsarArchive.prototype.readText = async function (input, basePath) {
    var blob = this.getBlob(input, basePath)
    if (!blob) throw new Error('File not found in ASAR: ' + input)
    return blob.text()
  }

  AsarArchive.prototype.getObjectUrl = function (input, basePath) {
    if (typeof input !== 'string' || isOpaqueOrExternalUrl(input) || input.charAt(0) === '#') {
      return input
    }
    var path = this.findPath(input, basePath)
    if (!path) return input
    if (this.preparedUrls.has(path)) return this.preparedUrls.get(path)
    if (this.objectUrls.has(path)) return this.objectUrls.get(path)

    var blob = this.getBlob(path)
    var url = URL.createObjectURL(blob)
    this.objectUrls.set(path, url)
    this.pathsByObjectUrl.set(url, path)
    return url
  }

  AsarArchive.prototype.restoreObjectUrls = function (value) {
    if (typeof value !== 'string' || value.indexOf('blob:') === -1) return value
    var archive = this
    return value.replace(/blob:[^\s"'()<>;&]+/g, function (url) {
      return archive.pathsByObjectUrl.get(url) || url
    })
  }

  AsarArchive.prototype.rewriteCss = function (cssText, cssPath) {
    var archive = this
    return cssText.replace(/url\(\s*(['"]?)([^)'"\n]+)\1\s*\)/gi, function (match, quote, raw) {
      var resolved = resolveCssPath(cssPath, raw)
      if (!resolved || !archive.has(resolved)) return match
      return 'url("' + archive.getObjectUrl(resolved) + '")'
    })
  }

  AsarArchive.prototype.prepareStyles = async function (onProgress) {
    var archive = this
    var paths = Array.from(this.entries.keys()).filter(function (path) {
      return extensionOf(path) === '.css'
    })

    for (var index = 0; index < paths.length; index++) {
      var path = paths[index]
      var css = await this.readText(path)
      var rewritten = this.rewriteCss(css, path)
      var url = URL.createObjectURL(new Blob([rewritten], { type: mimeForPath(path) }))
      this.preparedUrls.set(path, url)
      this.pathsByObjectUrl.set(url, path)
      if (onProgress) onProgress(index + 1, paths.length, path)
      if ((index + 1) % 4 === 0) await new Promise(function (resolve) { setTimeout(resolve, 0) })
    }
    return archive
  }

  AsarArchive.prototype.prepareBrowserCompat = async function () {
    var apngWorkerPath = 'tyrano/libs/apng.js'
    if (!this.has(apngWorkerPath)) return this

    var source = await this.readText(apngWorkerPath)
    var callbackStart = 'return new APNG().load(blob).then(([frames, iterations]) => {'
    var callbackCount = source.split(callbackStart).length - 1
    if (callbackCount !== 2) {
      throw new Error('The APNG result compatibility patch no longer matches this game version')
    }
    var guardedStart = [
      'return new APNG().load(blob).then(result => {',
      '    if (!result) return { frames: [], images: [], delays: [] }',
      '    const [frames, iterations] = result',
    ].join('\n')
    var patched = source.split(callbackStart).join(guardedStart)

    var byteViewStart = 'const bytes = new Uint8Array(blob.buffer)'
    if (patched.indexOf(byteViewStart) === -1) {
      throw new Error('The APNG binary compatibility patch no longer matches this game version')
    }
    patched = patched.replace(byteViewStart, [
      '// Electron passes a Buffer here; browser mode passes an ArrayBuffer.',
      '      const bytes = ArrayBuffer.isView(blob)',
      '        ? new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength)',
      '        : new Uint8Array(blob)',
    ].join('\n'))

    var playerStart = 'function playAPNG(apng, canvas, x, y, w, h, reversed, onFinish, onTick) {'
    var playerStartIndex = patched.indexOf(playerStart)
    if (playerStartIndex === -1) {
      throw new Error('The APNG playback compatibility patch no longer matches this game version')
    }
    var playerBodyIndex = playerStartIndex + playerStart.length
    patched = patched.slice(0, playerBodyIndex) + [
      '',
      '  if (!apng || !apng.images || apng.images.length === 0) {',
      '    if (onFinish) onFinish()',
      '    return',
      '  }',
    ].join('\n') + patched.slice(playerBodyIndex)

    var url = URL.createObjectURL(new Blob([patched], { type: mimeForPath(apngWorkerPath) }))
    this.preparedUrls.set(apngWorkerPath, url)
    this.pathsByObjectUrl.set(url, apngWorkerPath)
    return this
  }

  AsarArchive.prototype.list = function (suffix) {
    var normalizedSuffix = String(suffix || '').toLowerCase()
    return Array.from(this.entries.keys()).filter(function (path) {
      return !normalizedSuffix || path.toLowerCase().endsWith(normalizedSuffix)
    })
  }

  AsarArchive.prototype.release = function () {
    this.objectUrls.forEach(function (url) { URL.revokeObjectURL(url) })
    this.preparedUrls.forEach(function (url) { URL.revokeObjectURL(url) })
    this.objectUrls.clear()
    this.preparedUrls.clear()
    this.pathsByObjectUrl.clear()
  }

  global.DCAsar = {
    AsarArchive: AsarArchive,
    mimeForPath: mimeForPath,
    normalizePath: normalizePath,
  }
})(window)
