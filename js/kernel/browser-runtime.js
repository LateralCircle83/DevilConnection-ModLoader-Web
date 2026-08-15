;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var Path = DCWeb.ResourcePath
  var Rewriter = DCWeb.ResourceRewriter
  var makeResolver = Rewriter.makeResolver
  var rewriteCssValue = Rewriter.rewriteCssValue
  var rewriteMarkup = Rewriter.rewriteMarkup
  var rewriteSrcset = Rewriter.rewriteSrcset

  var URL_ATTRIBUTES = {
    AUDIO: ['src'],
    EMBED: ['src'],
    FEIMAGE: ['href', 'xlink:href'],
    IFRAME: ['src'],
    IMAGE: ['href', 'xlink:href'],
    IMG: ['src'],
    INPUT: ['src'],
    LINK: ['href'],
    OBJECT: ['data'],
    SCRIPT: ['src'],
    SOURCE: ['src'],
    TRACK: ['src'],
    USE: ['href', 'xlink:href'],
    VIDEO: ['src', 'poster'],
  }

  var SRCSET_TAGS = {
    IMG: true,
    SOURCE: true,
  }

  function attributeName(value) {
    return String(value || '').toLowerCase()
  }

  function tagName(element) {
    return String(element && element.tagName || '').toUpperCase()
  }

  function isResourceAttribute(element, name) {
    var lowerName = attributeName(name)
    var allowed = URL_ATTRIBUTES[tagName(element)] || []
    return allowed.indexOf(lowerName) !== -1 || (lowerName === 'srcset' && SRCSET_TAGS[tagName(element)])
  }

  function isRestorableAttribute(element, name) {
    return attributeName(name) === 'style' || isResourceAttribute(element, name)
  }

  function parseRange(header, size) {
    if (!header) return null
    var match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
    if (!match) return null

    var start
    var end
    if (!match[1]) {
      var suffix = Number(match[2])
      if (!Number.isFinite(suffix) || suffix <= 0) return null
      start = Math.max(0, size - suffix)
      end = size - 1
    } else {
      start = Number(match[1])
      end = match[2] ? Number(match[2]) : size - 1
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size) {
      return null
    }
    end = Math.min(end, size - 1)
    if (end < start) return null
    return { start: start, end: end }
  }

  function requestHeader(input, init, name) {
    var headers = init && init.headers
    if (headers) {
      if (typeof headers.get === 'function') return headers.get(name)
      var keys = Object.keys(headers)
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].toLowerCase() === name.toLowerCase()) return headers[keys[i]]
      }
    }
    if (input && input.headers && typeof input.headers.get === 'function') {
      return input.headers.get(name)
    }
    return null
  }

  function copyArrayBufferToRealm(target, value) {
    var source = new Uint8Array(value)
    var copy = new target.Uint8Array(source.byteLength)
    copy.set(source)
    return copy.buffer
  }

  function readArrayBufferInRealm(target, blob) {
    var sourceBlob = blob
    if (typeof target.Blob === 'function') {
      try {
        sourceBlob = blob instanceof target.Blob
          ? blob
          : new target.Blob([blob], { type: blob.type || '' })
      } catch (error) {}
    }
    return sourceBlob.arrayBuffer().then(function (value) {
      if (typeof target.ArrayBuffer === 'function') {
        try {
          if (value instanceof target.ArrayBuffer) return value
        } catch (error) {}
      }
      return copyArrayBufferToRealm(target, value)
    })
  }

  function logicalResponseUrl(target, vfs, input) {
    var path = typeof vfs.findPath === 'function' ? vfs.findPath(input) : ''
    if (!path) return String(input || '')
    var encoded = Path.encode(path)
    var baseUrl = target.document && target.document.baseURI
    if (!baseUrl && target.location) baseUrl = target.location.href
    if (target.URL && baseUrl) {
      try { return new target.URL(encoded, baseUrl).href } catch (error) {}
    }
    return encoded
  }

  function installFetch(target, vfs) {
    var nativeFetch = target.fetch ? target.fetch.bind(target) : null
    if (!nativeFetch || nativeFetch.__dcVfsPatched) return

    function vfsFetch(input, init) {
      var requestedUrl = typeof input === 'string' ? input : input && input.url
      if (!requestedUrl || !vfs.has(requestedUrl)) return nativeFetch(input, init)

      try {
        var source = vfs.getBlob(requestedUrl)
        var headers = new target.Headers({
          'Accept-Ranges': 'bytes',
          'Content-Length': String(source.size),
          'Content-Type': source.type || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
        })
        var range = parseRange(requestHeader(input, init, 'Range'), source.size)
        if (range) {
          var part = source.slice(range.start, range.end + 1, source.type)
          headers.set('Content-Length', String(part.size))
          headers.set('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + source.size)
          return Promise.resolve(new target.Response(part, { status: 206, headers: headers }))
        }
        return Promise.resolve(new target.Response(source, { status: 200, headers: headers }))
      } catch (error) {
        return Promise.reject(error)
      }
    }

    vfsFetch.__dcVfsPatched = true
    vfsFetch.nativeFetch = nativeFetch
    target.fetch = vfsFetch
  }

  function installXMLHttpRequest(target, vfs) {
    var NativeXHR = target.XMLHttpRequest
    if (!NativeXHR || NativeXHR.__dcVfsPatched) return

    var debug = { pending: 0, completed: 0, failed: 0 }

    function publishDebug(lastUrl, error) {
      var root = target.document && target.document.documentElement
      if (!root) return
      root.setAttribute('data-dc-xhr-pending', String(debug.pending))
      root.setAttribute('data-dc-xhr-completed', String(debug.completed))
      root.setAttribute('data-dc-xhr-failed', String(debug.failed))
      if (lastUrl) root.setAttribute('data-dc-xhr-last', String(lastUrl).slice(-240))
      if (error) {
        root.setAttribute('data-dc-xhr-error', String(error.message || error).slice(0, 500))
        root.setAttribute('data-dc-xhr-stack', String(error.stack || '').slice(0, 2000))
      }
    }

    publishDebug('', null)

    var eventNames = [
      'abort',
      'error',
      'load',
      'loadend',
      'loadstart',
      'progress',
      'readystatechange',
      'timeout',
    ]

    function VfsXMLHttpRequest() {
      this.readyState = 0
      this.response = null
      this.responseText = ''
      this.responseType = ''
      this.responseURL = ''
      this.responseXML = null
      this.status = 0
      this.statusText = ''
      this.timeout = 0
      this.withCredentials = false
      this.upload = {}
      this._listeners = {}
      this._headers = {}
      this._responseHeaders = {}
      this._native = null
      this._local = false
      this._aborted = false
      this.getResponseHeader = this.getResponseHeader.bind(this)
      this.getAllResponseHeaders = this.getAllResponseHeaders.bind(this)
    }

    VfsXMLHttpRequest.prototype._emit = function (type, event) {
      event = event || new target.Event(type)
      var handler = this['on' + type]
      if (typeof handler === 'function') handler.call(this, event)
      var listeners = (this._listeners[type] || []).slice()
      for (var i = 0; i < listeners.length; i++) listeners[i].call(this, event)
    }

    VfsXMLHttpRequest.prototype._changeReadyState = function (state) {
      this.readyState = state
      this._emit('readystatechange')
    }

    VfsXMLHttpRequest.prototype.addEventListener = function (type, listener) {
      if (!this._listeners[type]) this._listeners[type] = []
      this._listeners[type].push(listener)
    }

    VfsXMLHttpRequest.prototype.removeEventListener = function (type, listener) {
      var list = this._listeners[type] || []
      var index = list.indexOf(listener)
      if (index !== -1) list.splice(index, 1)
    }

    VfsXMLHttpRequest.prototype.dispatchEvent = function (event) {
      this._emit(event.type, event)
      return true
    }

    VfsXMLHttpRequest.prototype.open = function (method, url, async, user, password) {
      this._method = String(method || 'GET').toUpperCase()
      this._url = String(url)
      this._async = async !== false
      this._local = (this._method === 'GET' || this._method === 'HEAD') && vfs.has(this._url)

      if (!this._local) {
        this._native = new NativeXHR()
        this._bindNative()
        this._native.open(method, url, async === undefined ? true : async, user, password)
      }
      this._changeReadyState(1)
    }

    VfsXMLHttpRequest.prototype._bindNative = function () {
      var wrapper = this
      eventNames.forEach(function (name) {
        wrapper._native.addEventListener(name, function (event) {
          wrapper.readyState = wrapper._native.readyState
          if (wrapper.readyState === 4) {
            wrapper.status = wrapper._native.status
            wrapper.statusText = wrapper._native.statusText
            wrapper.response = wrapper._native.response
            wrapper.responseURL = wrapper._native.responseURL
            wrapper.responseXML = wrapper._native.responseXML
            try { wrapper.responseText = wrapper._native.responseText } catch (error) {}
          }
          wrapper._emit(name, event)
        })
      })
    }

    VfsXMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      if (this._native) this._native.setRequestHeader(name, value)
      else this._headers[String(name).toLowerCase()] = String(value)
    }

    VfsXMLHttpRequest.prototype.getResponseHeader = function (name) {
      if (this._native) return this._native.getResponseHeader(name)
      return this._responseHeaders[String(name).toLowerCase()] || null
    }

    VfsXMLHttpRequest.prototype.getAllResponseHeaders = function () {
      if (this._native) return this._native.getAllResponseHeaders()
      var responseHeaders = this._responseHeaders
      return Object.keys(responseHeaders)
        .map(function (name) { return name + ': ' + responseHeaders[name] })
        .join('\r\n')
    }

    VfsXMLHttpRequest.prototype.overrideMimeType = function (type) {
      this._mimeType = type
      if (this._native) this._native.overrideMimeType(type)
    }

    VfsXMLHttpRequest.prototype.abort = function () {
      this._aborted = true
      if (this._native) this._native.abort()
      else {
        this.status = 0
        this._changeReadyState(4)
        this._emit('abort')
        this._emit('loadend')
      }
    }

    VfsXMLHttpRequest.prototype.send = function (body) {
      if (this._native) {
        this._native.responseType = this.responseType
        this._native.timeout = this.timeout
        this._native.withCredentials = this.withCredentials
        this._native.send(body)
        return
      }
      if (!this._async) throw new Error('Synchronous ASAR XMLHttpRequest is not supported')

      var xhr = this
      debug.pending += 1
      publishDebug(xhr._url, null)
      this._emit('loadstart')
      Promise.resolve()
        .then(function () {
          if (xhr._aborted) return null
          var blob = vfs.getBlob(xhr._url)
          xhr.status = 200
          xhr.statusText = 'OK'
          xhr.responseURL = logicalResponseUrl(target, vfs, xhr._url)
          xhr._responseHeaders = {
            'content-length': String(blob.size),
            'content-type': xhr._mimeType || blob.type || 'application/octet-stream',
          }
          xhr._changeReadyState(2)
          xhr._changeReadyState(3)
          if (xhr._method === 'HEAD') return { blob: blob, value: null, text: '' }
          if (xhr.responseType === 'arraybuffer') {
            return readArrayBufferInRealm(target, blob).then(function (value) {
              return { blob: blob, value: value, text: '' }
            })
          }
          if (xhr.responseType === 'blob') {
            return { blob: blob, value: new target.Blob([blob], { type: blob.type }), text: '' }
          }
          return blob.text().then(function (text) {
            var value = text
            if (xhr.responseType === 'json') value = JSON.parse(text)
            if (xhr.responseType === 'document') {
              value = new target.DOMParser().parseFromString(text, 'text/html')
            }
            return { blob: blob, value: value, text: text }
          })
        })
        .then(function (result) {
          if (!result || xhr._aborted) return
          xhr.response = result.value
          if (!xhr.responseType || xhr.responseType === 'text') xhr.responseText = result.text
          if (xhr.responseType === 'document') xhr.responseXML = result.value
          xhr._changeReadyState(4)
          var progress
          try {
            progress = new target.ProgressEvent('progress', {
              lengthComputable: true,
              loaded: result.blob.size,
              total: result.blob.size,
            })
          } catch (error) {
            progress = new target.Event('progress')
          }
          xhr._emit('progress', progress)
          xhr._emit('load')
          xhr._emit('loadend')
          debug.pending -= 1
          debug.completed += 1
          publishDebug(xhr._url, null)
        })
        .catch(function (error) {
          if (xhr._aborted) return
          xhr.status = 0
          xhr.statusText = error.message
          xhr._changeReadyState(4)
          xhr._emit('error')
          xhr._emit('loadend')
          debug.pending -= 1
          debug.failed += 1
          publishDebug(xhr._url, error)
        })
    }

    VfsXMLHttpRequest.UNSENT = 0
    VfsXMLHttpRequest.OPENED = 1
    VfsXMLHttpRequest.HEADERS_RECEIVED = 2
    VfsXMLHttpRequest.LOADING = 3
    VfsXMLHttpRequest.DONE = 4
    VfsXMLHttpRequest.prototype.UNSENT = 0
    VfsXMLHttpRequest.prototype.OPENED = 1
    VfsXMLHttpRequest.prototype.HEADERS_RECEIVED = 2
    VfsXMLHttpRequest.prototype.LOADING = 3
    VfsXMLHttpRequest.prototype.DONE = 4
    VfsXMLHttpRequest.__dcVfsPatched = true
    target.XMLHttpRequest = VfsXMLHttpRequest
  }

  function installWorker(target, vfs) {
    var NativeWorker = target.Worker
    if (!NativeWorker || NativeWorker.__dcVfsPatched) return

    function VfsWorker(url, options) {
      var requested = String(url)
      var resolved = vfs.has(requested) ? vfs.getObjectUrl(requested) : requested
      var worker = options === undefined
        ? new NativeWorker(resolved)
        : new NativeWorker(resolved, options)
      var root = target.document && target.document.documentElement
      if (root) {
        root.setAttribute('data-dc-worker-last', requested.slice(-240))
        worker.addEventListener('error', function (event) {
          root.setAttribute('data-dc-worker-error', String(event.message || 'Worker failed').slice(0, 1000))
        })
      }
      return worker
    }

    VfsWorker.prototype = NativeWorker.prototype
    Object.setPrototypeOf(VfsWorker, NativeWorker)
    VfsWorker.__dcVfsPatched = true
    target.Worker = VfsWorker
  }

  function installDomUrlRewriting(target, vfs) {
    var resolve = makeResolver(vfs)
    var restore = typeof vfs.restoreObjectUrls === 'function'
      ? function (value) { return typeof value === 'string' ? vfs.restoreObjectUrls(value) : value }
      : function (value) { return value }
    var readiness = DCWeb.ResourceReadiness ? DCWeb.ResourceReadiness.forTarget(target) : null
    var videoFallbacks = new WeakMap()
    var logicalStyleDeclarations = new WeakSet()
    var nativeTextContentDescriptor = null

    function markStyle(element) {
      if (element && element.style) logicalStyleDeclarations.add(element.style)
    }
    var ElementPrototype = target.Element && target.Element.prototype
    if (!ElementPrototype || ElementPrototype.__dcVfsPatched) return

    var nativeSetAttribute = ElementPrototype.setAttribute
    var nativeGetAttribute = ElementPrototype.getAttribute

    function publishVideoFallback(state, source, detail) {
      var root = target.document && target.document.documentElement
      if (!root || !root.setAttribute) return
      root.setAttribute('data-dc-media-fallback-state', state)
      root.setAttribute('data-dc-media-fallback-source', String(source || '').slice(-240))
      root.setAttribute('data-dc-media-fallback-detail', String(detail || '').slice(0, 500))
    }

    function releaseVideoFallback(video) {
      var state = videoFallbacks.get(video)
      if (!state) return
      state.token++
      if (video.removeEventListener) {
        video.removeEventListener('error', state.onError)
        video.removeEventListener('loadedmetadata', state.onRecovered)
      }
      if (state.handle) state.handle.release()
      videoFallbacks.delete(video)
    }

    function fallbackIsCurrent(video, state, token) {
      return videoFallbacks.get(video) === state && token === state.token
    }

    function releaseFallbackHandle(state) {
      if (state.handle) state.handle.release()
      state.handle = null
      state.handleKind = ''
    }

    function visualFallbackDetail(handle, reason) {
      return [
        handle && handle.videoCodec,
        handle && handle.audioCodec,
        handle && handle.sourceLayerId,
        reason,
      ].filter(Boolean).join(' / ')
    }

    function warnVisualFallback(state, source, handle, reason) {
      if (state.visualWarned) return
      state.visualWarned = true
      var layer = handle && handle.sourceLayerId || 'unknown-layer'
      var codecs = [handle && handle.videoCodec, handle && handle.audioCodec].filter(Boolean).join(', ')
      var message = '[DC media] Visual-only recovery dropped AAC audio: ' + source +
        ' (layer: ' + layer + (codecs ? ', codecs: ' + codecs : '') + ') after ' + reason
      if (target.console && typeof target.console.warn === 'function') target.console.warn(message)
    }

    function prepareVisualFallback(video, carrier, source, state, token, reason) {
      releaseFallbackHandle(state)
      if (typeof vfs.createVisualOnlyMediaObjectUrl !== 'function' || !DCWeb.Mp4VisualFallback) {
        state.phase = 'failed'
        publishVideoFallback('unavailable', source, 'No eligible MediaSource or visual-only representation')
        return
      }
      state.phase = 'preparing-visual'
      publishVideoFallback('visual-only-preparing', source, reason)
      Promise.resolve(vfs.createVisualOnlyMediaObjectUrl(source)).then(function (handle) {
        if (!fallbackIsCurrent(video, state, token)) {
          if (handle) handle.release()
          return
        }
        if (!handle) {
          state.phase = 'failed'
          publishVideoFallback('unavailable', source, 'Not an eligible progressive H.264/AAC MP4')
          return
        }
        state.handle = handle
        state.handleKind = 'visual-only'
        state.phase = 'retrying-visual'
        warnVisualFallback(state, source, handle, reason)
        nativeSetAttribute.call(carrier, 'src', handle.url)
        publishVideoFallback('visual-only-retrying', source, visualFallbackDetail(handle, reason))
        if (typeof video.load === 'function') video.load()
      }).catch(function (error) {
        if (!fallbackIsCurrent(video, state, token)) return
        state.phase = 'failed'
        publishVideoFallback('failed', source, error && error.message ? error.message : error)
      })
    }

    function prepareMediaSourceFallback(video, carrier, source, state, token, reason) {
      if (typeof vfs.createMediaSourceObjectUrl !== 'function' || !DCWeb.MediaSourceFallback) {
        prepareVisualFallback(video, carrier, source, state, token, reason)
        return
      }
      state.phase = 'preparing-mse'
      publishVideoFallback('mse-preparing', source, reason)
      Promise.resolve(vfs.createMediaSourceObjectUrl(source, DCWeb.MediaSourceFallback.MAX_BYTES)).then(function (handle) {
        if (!fallbackIsCurrent(video, state, token)) {
          if (handle) handle.release()
          return
        }
        if (!handle) {
          prepareVisualFallback(video, carrier, source, state, token, reason)
          return
        }
        state.handle = handle
        state.handleKind = 'mse'
        state.phase = 'retrying-mse'
        nativeSetAttribute.call(carrier, 'src', handle.url)
        publishVideoFallback('mse-retrying', source, handle.mimeType)
        Promise.resolve(handle.ready).then(function (result) {
          if (!fallbackIsCurrent(video, state, token) || state.phase !== 'retrying-mse') return
          if (result && result.ok) {
            publishVideoFallback('mse-buffered', source, handle.mimeType)
            return
          }
          var detail = result && (result.error || result.state) || 'MediaSource append failed'
          prepareVisualFallback(video, carrier, source, state, token, detail)
        }).catch(function (error) {
          if (!fallbackIsCurrent(video, state, token) || state.phase !== 'retrying-mse') return
          prepareVisualFallback(video, carrier, source, state, token, error && error.message ? error.message : error)
        })
        if (typeof video.load === 'function') video.load()
      }).catch(function (error) {
        if (!fallbackIsCurrent(video, state, token)) return
        prepareVisualFallback(video, carrier, source, state, token, error && error.message ? error.message : error)
      })
    }

    function installVideoFallback(video, carrier, source) {
      if (!video || !carrier) return
      if (typeof vfs.createMediaSourceObjectUrl !== 'function' && typeof vfs.createVisualOnlyMediaObjectUrl !== 'function') return
      var extension = Path.extensionOf(source)
      if (extension !== '.mp4' && extension !== '.m4v') return
      var previous = videoFallbacks.get(video)
      if (previous && previous.carrier === carrier && previous.source === source) return
      releaseVideoFallback(video)

      var state = {
        attempted: false,
        carrier: carrier,
        handle: null,
        handleKind: '',
        phase: 'native',
        source: source,
        token: 1,
        visualWarned: false,
      }
      state.onRecovered = function () {
        if (videoFallbacks.get(video) !== state) return
        if (state.phase === 'retrying-mse') {
          state.phase = 'recovered-mse'
          publishVideoFallback('mse-recovered', source, state.handle && state.handle.mimeType)
        } else if (state.phase === 'retrying-visual') {
          state.phase = 'recovered-visual'
          publishVideoFallback('visual-only-recovered', source, visualFallbackDetail(state.handle, 'loadedmetadata'))
        }
      }
      state.onError = function () {
        var mediaError = video.error
        if (!mediaError || Number(mediaError.code) !== 4) return
        var reason = mediaError.message || 'MEDIA_ERR_SRC_NOT_SUPPORTED'
        if (state.phase === 'retrying-mse') {
          prepareVisualFallback(video, carrier, source, state, state.token, reason)
          return
        }
        if (state.phase === 'retrying-visual') {
          state.phase = 'failed'
          publishVideoFallback('visual-only-failed', source, reason)
          releaseFallbackHandle(state)
          return
        }
        if (state.attempted) return
        state.attempted = true
        var token = state.token
        prepareMediaSourceFallback(video, carrier, source, state, token, reason)
      }
      if (video.addEventListener) {
        video.addEventListener('error', state.onError)
        video.addEventListener('loadedmetadata', state.onRecovered)
      }
      videoFallbacks.set(video, state)
    }

    function guardResource(element, name, value) {
      if (!element) return
      var raw = String(value || '')
      var logical = restore(raw)
      var managed = logical !== raw
      var nodeName = tagName(element)
      if (nodeName === 'VIDEO' && name === 'src') {
        if (managed) {
          if (readiness) readiness.observeVideo(element, logical)
          installVideoFallback(element, element, logical)
        } else {
          if (readiness) readiness.clear(element, 'video')
          releaseVideoFallback(element)
        }
        return
      }
      if (nodeName === 'SOURCE' && name === 'src' && tagName(element.parentNode) === 'VIDEO') {
        if (managed) {
          if (readiness) readiness.observeVideo(element.parentNode, logical)
          installVideoFallback(element.parentNode, element, logical)
        } else releaseVideoFallback(element.parentNode)
      }
    }

    ElementPrototype.setAttribute = function (name, value) {
      var lowerName = attributeName(name)
      if (isResourceAttribute(this, lowerName)) value = resolve(String(value))
      if (lowerName === 'srcset' && SRCSET_TAGS[tagName(this)]) value = rewriteSrcset(String(value), resolve)
      if (lowerName === 'style') value = rewriteCssValue(String(value), resolve)
      var result = nativeSetAttribute.call(this, name, value)
      if (lowerName === 'style') markStyle(this)
      guardResource(this, lowerName, value)
      return result
    }
    if (nativeGetAttribute) {
      ElementPrototype.getAttribute = function (name) {
        var value = nativeGetAttribute.call(this, name)
        return value !== null && isRestorableAttribute(this, name) ? restore(value) : value
      }
    }

    var nativeSetAttributeNS = ElementPrototype.setAttributeNS
    var nativeGetAttributeNS = ElementPrototype.getAttributeNS
    if (nativeSetAttributeNS) {
      ElementPrototype.setAttributeNS = function (namespace, name, value) {
        var lowerName = attributeName(name).split(':').pop()
        if (isResourceAttribute(this, lowerName)) value = resolve(String(value))
        if (lowerName === 'srcset' && SRCSET_TAGS[tagName(this)]) value = rewriteSrcset(String(value), resolve)
        if (lowerName === 'style') value = rewriteCssValue(String(value), resolve)
        var result = nativeSetAttributeNS.call(this, namespace, name, value)
        if (lowerName === 'style') markStyle(this)
        guardResource(this, lowerName, value)
        return result
      }
    }
    if (nativeGetAttributeNS) {
      ElementPrototype.getAttributeNS = function (namespace, name) {
        var value = nativeGetAttributeNS.call(this, namespace, name)
        return value !== null && isRestorableAttribute(this, attributeName(name).split(':').pop()) ? restore(value) : value
      }
    }

    function patchProperty(ctor, property, rewrite, guardName) {
      if (!ctor || !ctor.prototype) return
      var descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, property)
      if (!descriptor || !descriptor.set || descriptor.configurable === false) return
      Object.defineProperty(ctor.prototype, property, {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set: function (value) {
          var replacement = rewrite ? rewrite(String(value), resolve) : resolve(String(value))
          descriptor.set.call(this, replacement)
          if (guardName) guardResource(this, guardName, replacement)
        },
      })
    }

    patchProperty(target.HTMLImageElement, 'src')
    patchProperty(target.HTMLMediaElement, 'src', null, 'src')
    patchProperty(target.HTMLSourceElement, 'src', null, 'src')
    patchProperty(target.HTMLScriptElement, 'src')
    patchProperty(target.HTMLInputElement, 'src')
    patchProperty(target.HTMLTrackElement, 'src')
    patchProperty(target.HTMLVideoElement, 'poster')
    patchProperty(target.HTMLImageElement, 'srcset', rewriteSrcset)
    patchProperty(target.HTMLSourceElement, 'srcset', rewriteSrcset, 'srcset')
    patchProperty(target.HTMLLinkElement, 'href')
    patchProperty(target.HTMLIFrameElement, 'src')
    patchProperty(target.HTMLObjectElement, 'data')
    patchProperty(target.HTMLEmbedElement, 'src')

    var stylePrototype = target.CSSStyleDeclaration && target.CSSStyleDeclaration.prototype
    if (stylePrototype && !stylePrototype.__dcVfsPatched) {
      var nativeSetProperty = stylePrototype.setProperty
      stylePrototype.setProperty = function (name, value, priority) {
        logicalStyleDeclarations.add(this)
        return nativeSetProperty.call(this, name, rewriteCssValue(String(value), resolve), priority)
      }
      var nativeGetPropertyValue = stylePrototype.getPropertyValue
      if (nativeGetPropertyValue) {
        stylePrototype.getPropertyValue = function (name) {
          var value = nativeGetPropertyValue.call(this, name)
          return logicalStyleDeclarations.has(this) ? restore(value) : value
        }
      }
      ;[
        ['background', 'background'],
        ['backgroundImage', 'background-image'],
        ['borderImage', 'border-image'],
        ['borderImageSource', 'border-image-source'],
        ['clipPath', 'clip-path'],
        ['content', 'content'],
        ['cssText', ''],
        ['cursor', 'cursor'],
        ['filter', 'filter'],
        ['fill', 'fill'],
        ['listStyle', 'list-style'],
        ['listStyleImage', 'list-style-image'],
        ['marker', 'marker'],
        ['markerEnd', 'marker-end'],
        ['markerMid', 'marker-mid'],
        ['markerStart', 'marker-start'],
        ['mask', 'mask'],
        ['maskImage', 'mask-image'],
        ['offsetPath', 'offset-path'],
        ['shapeOutside', 'shape-outside'],
        ['stroke', 'stroke'],
        ['webkitMask', '-webkit-mask'],
        ['webkitMaskBoxImage', '-webkit-mask-box-image'],
        ['webkitMaskBoxImageSource', '-webkit-mask-box-image-source'],
        ['webkitMaskImage', '-webkit-mask-image'],
      ].forEach(function (entry) {
        var property = entry[0]
        var cssName = entry[1]
        var descriptor = Object.getOwnPropertyDescriptor(stylePrototype, property)
        if ((!descriptor || !descriptor.set) && cssName && nativeGetPropertyValue) {
          descriptor = {
            configurable: true,
            enumerable: true,
            get: function () { return nativeGetPropertyValue.call(this, cssName) },
            set: function (value) { nativeSetProperty.call(this, cssName, value, '') },
          }
        }
        if (!descriptor || !descriptor.set || descriptor.configurable === false) return
        Object.defineProperty(stylePrototype, property, {
          configurable: descriptor.configurable,
          enumerable: descriptor.enumerable,
          get: descriptor.get && function () {
            var value = descriptor.get.call(this)
            return logicalStyleDeclarations.has(this) ? restore(value) : value
          },
          set: function (value) {
            logicalStyleDeclarations.add(this)
            descriptor.set.call(this, rewriteCssValue(String(value), resolve))
          },
        })
      })
      stylePrototype.__dcVfsPatched = true
    }

    function patchMarkupProperty(ctor, property) {
      if (!ctor || !ctor.prototype) return
      var descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, property)
      if (!descriptor || !descriptor.get || !descriptor.set || descriptor.configurable === false) return
      Object.defineProperty(ctor.prototype, property, {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: function () { return restore(descriptor.get.call(this)) },
        set: function (value) { descriptor.set.call(this, rewriteMarkup(String(value), resolve)) },
      })
    }

    patchMarkupProperty(target.Element, 'innerHTML')
    patchMarkupProperty(target.Element, 'outerHTML')
    patchMarkupProperty(target.ShadowRoot, 'innerHTML')

    var sheetPrototype = target.CSSStyleSheet && target.CSSStyleSheet.prototype
    if (sheetPrototype && sheetPrototype.insertRule) {
      var nativeInsertRule = sheetPrototype.insertRule
      sheetPrototype.insertRule = function (rule, index) {
        return nativeInsertRule.call(this, rewriteCssValue(String(rule), resolve), index)
      }
      if (sheetPrototype.replace) {
        var nativeReplace = sheetPrototype.replace
        sheetPrototype.replace = function (text) {
          return nativeReplace.call(this, rewriteCssValue(String(text), resolve))
        }
      }
      if (sheetPrototype.replaceSync) {
        var nativeReplaceSync = sheetPrototype.replaceSync
        sheetPrototype.replaceSync = function (text) {
          return nativeReplaceSync.call(this, rewriteCssValue(String(text), resolve))
        }
      }
    }

    var nativeInsertAdjacentHTML = ElementPrototype.insertAdjacentHTML
    if (nativeInsertAdjacentHTML) {
      ElementPrototype.insertAdjacentHTML = function (position, text) {
        return nativeInsertAdjacentHTML.call(this, position, rewriteMarkup(text, resolve))
      }
    }

    function rewriteElement(node) {
      if (!node || node.nodeType !== 1) return node
      var nodeTagName = tagName(node)
      var attributes = URL_ATTRIBUTES[nodeTagName] || []
      attributes.forEach(function (name) {
        if (node.hasAttribute(name)) {
          var value = nativeGetAttribute.call(node, name)
          var replacement = resolve(value)
          if (replacement !== value) nativeSetAttribute.call(node, name, replacement)
        }
      })
      if (SRCSET_TAGS[nodeTagName] && node.hasAttribute('srcset')) {
        var srcset = nativeGetAttribute.call(node, 'srcset')
        var rewrittenSrcset = rewriteSrcset(srcset, resolve)
        if (rewrittenSrcset !== srcset) nativeSetAttribute.call(node, 'srcset', rewrittenSrcset)
      }
      if (node.hasAttribute('style')) {
        var style = nativeGetAttribute.call(node, 'style')
        var rewrittenStyle = rewriteCssValue(style, resolve)
        if (rewrittenStyle !== style) nativeSetAttribute.call(node, 'style', rewrittenStyle)
        markStyle(node)
      }
      if (nodeTagName === 'STYLE' && node.textContent) {
        var styleText = nativeTextContentDescriptor
          ? nativeTextContentDescriptor.get.call(node)
          : node.textContent
        var css = rewriteCssValue(styleText, resolve)
        if (css !== styleText) {
          if (nativeTextContentDescriptor) nativeTextContentDescriptor.set.call(node, css)
          else node.textContent = css
        }
      }
      if (nodeTagName === 'VIDEO' && node.hasAttribute('src')) {
        guardResource(node, 'src', nativeGetAttribute.call(node, 'src'))
      } else if (nodeTagName === 'SOURCE' && node.hasAttribute('src')) {
        guardResource(node, 'src', nativeGetAttribute.call(node, 'src'))
      }
      return node
    }

    function rewriteNode(node) {
      if (!node || (node.nodeType !== 1 && node.nodeType !== 11)) return node
      rewriteElement(node)
      if (node.querySelectorAll) {
        node.querySelectorAll('[style],[srcset],img,video,audio,source,script,link,input,track,object,embed,iframe,style').forEach(rewriteElement)
      }
      return node
    }

    function releaseNode(node) {
      if (!node || (node.nodeType !== 1 && node.nodeType !== 11)) return
      if (readiness) {
        readiness.clear(node, 'image')
        readiness.clear(node, 'video')
      }
      if (tagName(node) === 'VIDEO') releaseVideoFallback(node)
      if (tagName(node) === 'SOURCE' && tagName(node.parentNode) === 'VIDEO') releaseVideoFallback(node.parentNode)
      if (node.querySelectorAll) {
        node.querySelectorAll('img,video').forEach(function (element) {
          if (readiness) {
            readiness.clear(element, 'image')
            readiness.clear(element, 'video')
          }
          if (tagName(element) === 'VIDEO') releaseVideoFallback(element)
        })
      }
    }

    var NodePrototype = target.Node && target.Node.prototype
    if (NodePrototype) {
      nativeTextContentDescriptor = Object.getOwnPropertyDescriptor(NodePrototype, 'textContent')
      if (nativeTextContentDescriptor && nativeTextContentDescriptor.get && nativeTextContentDescriptor.set && nativeTextContentDescriptor.configurable !== false) {
        Object.defineProperty(NodePrototype, 'textContent', {
          configurable: nativeTextContentDescriptor.configurable,
          enumerable: nativeTextContentDescriptor.enumerable,
          get: function () {
            var value = nativeTextContentDescriptor.get.call(this)
            return tagName(this) === 'STYLE' ? restore(value) : value
          },
          set: function (value) {
            if (tagName(this) === 'STYLE') value = rewriteCssValue(value, resolve)
            nativeTextContentDescriptor.set.call(this, value)
          },
        })
      }

      var nativeAppendChild = NodePrototype.appendChild
      var nativeInsertBefore = NodePrototype.insertBefore
      var nativeReplaceChild = NodePrototype.replaceChild
      NodePrototype.appendChild = function (node) { return nativeAppendChild.call(this, rewriteNode(node)) }
      NodePrototype.insertBefore = function (node, reference) {
        return nativeInsertBefore.call(this, rewriteNode(node), reference)
      }
      if (nativeReplaceChild) {
        NodePrototype.replaceChild = function (node, child) {
          return nativeReplaceChild.call(this, rewriteNode(node), child)
        }
      }
    }

    function patchNodeInsertion(ctor, methods) {
      if (!ctor || !ctor.prototype) return
      methods.forEach(function (method) {
        var nativeMethod = ctor.prototype[method]
        if (!nativeMethod) return
        ctor.prototype[method] = function () {
          var args = Array.prototype.slice.call(arguments).map(function (value) {
            return value && typeof value === 'object' && typeof value.nodeType === 'number'
              ? rewriteNode(value)
              : value
          })
          return nativeMethod.apply(this, args)
        }
      })
    }

    patchNodeInsertion(target.Element, ['append', 'prepend', 'before', 'after', 'replaceWith', 'replaceChildren'])
    patchNodeInsertion(target.Document, ['append', 'prepend', 'replaceChildren'])
    patchNodeInsertion(target.DocumentFragment, ['append', 'prepend', 'replaceChildren'])

    var nativeInsertAdjacentElement = ElementPrototype.insertAdjacentElement
    if (nativeInsertAdjacentElement) {
      ElementPrototype.insertAdjacentElement = function (position, element) {
        return nativeInsertAdjacentElement.call(this, position, rewriteNode(element))
      }
    }

    if (target.MutationObserver && target.document) {
      new target.MutationObserver(function (records) {
        records.forEach(function (record) {
          if (record.type === 'childList') {
            record.addedNodes.forEach(rewriteNode)
            record.removedNodes.forEach(releaseNode)
            if (record.target && tagName(record.target) === 'STYLE') rewriteElement(record.target)
          } else if (record.type === 'attributes') rewriteElement(record.target)
          else if (record.type === 'characterData' && record.target.parentNode && tagName(record.target.parentNode) === 'STYLE') {
            rewriteElement(record.target.parentNode)
          }
        })
      }).observe(target.document, {
        attributeFilter: ['data', 'href', 'poster', 'src', 'srcset', 'style'],
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      })
    }

    if (target.document && target.document.documentElement) rewriteNode(target.document.documentElement)

    ElementPrototype.__dcVfsPatched = true
  }

  function installJQuery(target, vfs) {
    var $ = target.jQuery
    if (!$ || !vfs || $.__dcVfsPatched) return
    var resolve = makeResolver(vfs)
    var restore = typeof vfs.restoreObjectUrls === 'function'
      ? function (value) { return typeof value === 'string' ? vfs.restoreObjectUrls(value) : value }
      : function (value) { return value }
    var nativeCss = $.fn.css
    $.fn.css = function (name, value) {
      if (typeof name === 'object' && name) {
        var copy = {}
        Object.keys(name).forEach(function (key) { copy[key] = rewriteCssValue(name[key], resolve) })
        return nativeCss.call(this, copy)
      }
      if (arguments.length === 1) return nativeCss.call(this, name)
      if (arguments.length > 1) value = rewriteCssValue(value, resolve)
      return nativeCss.call(this, name, value)
    }

    var nativeAttr = $.fn.attr
    if (nativeAttr) {
      $.fn.attr = function (name) {
        var value = nativeAttr.apply(this, arguments)
        return arguments.length === 1 && typeof name === 'string' && isRestorableAttribute(this[0], name)
          ? restore(value)
          : value
      }
    }

    ;['html', 'append', 'prepend', 'before', 'after'].forEach(function (method) {
      var nativeMethod = $.fn[method]
      if (!nativeMethod) return
      $.fn[method] = function () {
        var args = Array.prototype.slice.call(arguments).map(function (argument) {
          return rewriteMarkup(argument, resolve)
        })
        return nativeMethod.apply(this, args)
      }
    })

    $.__dcVfsPatched = true
  }

  function install(target, vfs) {
    if (!target || !vfs || target.__dcVfsRuntimeInstalled) return
    installFetch(target, vfs)
    installXMLHttpRequest(target, vfs)
    installWorker(target, vfs)
    installDomUrlRewriting(target, vfs)
    target.__dcVfsRuntimeInstalled = true
  }

  DCWeb.Runtime = {
    copyArrayBufferToRealm: copyArrayBufferToRealm,
    install: install,
    installJQuery: installJQuery,
    readArrayBufferInRealm: readArrayBufferInRealm,
    rewriteCssValue: rewriteCssValue,
    rewriteMarkup: rewriteMarkup,
    rewriteSrcset: rewriteSrcset,
  }
})(window)
