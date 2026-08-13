;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
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
    var clean = String(path || '')
    var dot = clean.lastIndexOf('.')
    return dot === -1 ? '' : clean.substring(dot).toLowerCase()
  }

  function mimeForPath(path) {
    return MIME_TYPES[extensionOf(path)] || 'application/octet-stream'
  }

  function safeDecode(value) {
    try { return decodeURIComponent(value) } catch (error) { return value }
  }

  function encodePath(path) {
    return String(path || '').split('/').map(function (segment) {
      return encodeURIComponent(segment).replace(/[!'()*]/g, function (character) {
        return '%' + character.charCodeAt(0).toString(16).toUpperCase()
      })
    }).join('/')
  }

  function fragmentOf(value) {
    var text = String(value || '')
    var hash = text.indexOf('#')
    return hash === -1 ? '' : text.slice(hash)
  }

  function collapseSegments(path) {
    var output = []
    String(path || '').replace(/\\/g, '/').split('/').forEach(function (segment) {
      if (!segment || segment === '.') return
      if (segment === '..') output.pop()
      else output.push(segment)
    })
    return output.join('/')
  }

  function isOpaqueOrExternalUrl(value) {
    return /^(?:blob:|data:|javascript:|mailto:|tel:)/i.test(String(value || ''))
  }

  function normalizePath(input, basePath) {
    if (typeof input !== 'string') return ''
    var raw = input.trim()
    if (!raw || raw.charAt(0) === '#' || isOpaqueOrExternalUrl(raw)) return ''

    if (/^https?:/i.test(raw)) {
      try { raw = new URL(raw).pathname } catch (error) { return '' }
    }

    raw = safeDecode(raw.split('#', 1)[0].split('?', 1)[0])
    raw = raw.replace(/\\/g, '/').replace(/^file:\/\/\/?/i, '')
    var rootRelative = raw.charAt(0) === '/'
    var anchored = raw.match(/(?:^|\/)(data|tyrano)\/(.+)$/i)
    if (anchored) return collapseSegments(anchored[1] + '/' + anchored[2])

    raw = raw.replace(/^[a-z]:\//i, '').replace(/^\/+/, '')
    if (basePath && !rootRelative) {
      var baseDir = collapseSegments(basePath).split('/')
      baseDir.pop()
      raw = baseDir.concat(raw.split('/')).join('/')
    }
    return collapseSegments(raw)
  }

  function resolveCssPath(cssPath, rawPath) {
    var value = String(rawPath || '').trim().replace(/^['"]|['"]$/g, '')
    if (!value || value.charAt(0) === '#' || isOpaqueOrExternalUrl(value) || /^https?:/i.test(value)) return ''
    return normalizePath(value, cssPath)
  }

  DCWeb.ResourcePath = {
    encode: encodePath,
    extensionOf: extensionOf,
    fragmentOf: fragmentOf,
    isOpaqueOrExternalUrl: isOpaqueOrExternalUrl,
    mimeForPath: mimeForPath,
    normalize: normalizePath,
    resolveCss: resolveCssPath,
  }
})(window)
