;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var APPEND_TIMEOUT_MS = 15000
  var MAX_BYTES = 16 * 1024 * 1024

  function readUint32(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.length) return 0
    return ((bytes[offset] * 0x1000000) +
      (bytes[offset + 1] << 16) +
      (bytes[offset + 2] << 8) +
      bytes[offset + 3]) >>> 0
  }

  function findBox(bytes, type) {
    var codes = []
    var index
    for (index = 0; index < type.length; index++) codes.push(type.charCodeAt(index))
    for (index = 4; index <= bytes.length - codes.length; index++) {
      var matched = true
      for (var codeIndex = 0; codeIndex < codes.length; codeIndex++) {
        if (bytes[index + codeIndex] !== codes[codeIndex]) {
          matched = false
          break
        }
      }
      if (!matched) continue
      var start = index - 4
      var size = readUint32(bytes, start)
      if (size >= 8 && start + size <= bytes.length) {
        return { end: start + size, start: start, type: type, typeOffset: index }
      }
    }
    return null
  }

  function hexByte(value) {
    return Number(value || 0).toString(16).padStart(2, '0')
  }

  function readDescriptor(bytes, offset, limit) {
    if (offset >= limit) return null
    var tag = bytes[offset]
    var length = 0
    var used = 0
    var current
    do {
      if (offset + 1 + used >= limit || used === 4) return null
      current = bytes[offset + 1 + used]
      length = (length << 7) | (current & 0x7f)
      used++
    } while (current & 0x80)
    var start = offset + 1 + used
    if (start + length > limit) return null
    return { end: start + length, start: start, tag: tag }
  }

  function videoCodecFor(bytes) {
    var sample = findBox(bytes, 'avc1') || findBox(bytes, 'avc3')
    var config = findBox(bytes, 'avcC')
    if (!sample || !config || config.typeOffset + 8 > config.end) return ''
    if (bytes[config.typeOffset + 4] !== 1) return ''
    return sample.type + '.' +
      hexByte(bytes[config.typeOffset + 5]) +
      hexByte(bytes[config.typeOffset + 6]) +
      hexByte(bytes[config.typeOffset + 7])
  }

  function audioCodecFor(bytes) {
    if (!findBox(bytes, 'mp4a')) return ''
    var box = findBox(bytes, 'esds')
    if (!box) return ''
    var descriptor = readDescriptor(bytes, box.typeOffset + 8, box.end)
    if (!descriptor || descriptor.tag !== 3 || descriptor.start + 3 > descriptor.end) return ''

    var cursor = descriptor.start
    var flags = bytes[cursor + 2]
    cursor += 3
    if (flags & 0x80) cursor += 2
    if (flags & 0x40) {
      if (cursor >= descriptor.end) return ''
      cursor += 1 + bytes[cursor]
    }
    if (flags & 0x20) cursor += 2

    var decoder = readDescriptor(bytes, cursor, descriptor.end)
    if (!decoder || decoder.tag !== 4 || decoder.start + 13 > decoder.end) return ''
    var objectType = bytes[decoder.start]
    var config = readDescriptor(bytes, decoder.start + 13, decoder.end)
    if (!config || config.tag !== 5 || config.start >= config.end) return ''
    var audioObjectType = bytes[config.start] >> 3
    if (audioObjectType === 31) {
      if (config.start + 1 >= config.end) return ''
      audioObjectType = 32 + ((bytes[config.start] & 7) << 3) + (bytes[config.start + 1] >> 5)
    }
    return 'mp4a.' + hexByte(objectType) + '.' + audioObjectType
  }

  function inspect(buffer) {
    var bytes = new Uint8Array(buffer)
    if (!findBox(bytes, 'ftyp') || !findBox(bytes, 'moov') ||
      !findBox(bytes, 'mvex') || !findBox(bytes, 'moof')) return null
    var videoCodec = videoCodecFor(bytes)
    if (!videoCodec) return null
    var hasAudio = Boolean(findBox(bytes, 'mp4a'))
    var audioCodec = audioCodecFor(bytes)
    if (hasAudio && !audioCodec) return null
    var codecs = audioCodec ? [videoCodec, audioCodec] : [videoCodec]
    return {
      codecs: codecs,
      mimeType: 'video/mp4; codecs="' + codecs.join(', ') + '"',
    }
  }

  function create(blob) {
    var MediaSourceConstructor = global.MediaSource
    if (!blob || typeof blob.arrayBuffer !== 'function' || !MediaSourceConstructor ||
      typeof MediaSourceConstructor.isTypeSupported !== 'function' ||
      Number(blob.size) > MAX_BYTES) return Promise.resolve(null)

    return blob.arrayBuffer().then(function (initialBuffer) {
      var info = inspect(initialBuffer)
      if (!info || !MediaSourceConstructor.isTypeSupported(info.mimeType)) return null

      var mediaSource = new MediaSourceConstructor()
      var sourceBuffer = null
      var buffer = initialBuffer
      var appendTimer = 0
      var released = false
      var settled = false
      var resolveReady
      var ready = new Promise(function (resolve) { resolveReady = resolve })

      function settle(ok, state, error) {
        if (settled) return
        settled = true
        if (appendTimer) {
          clearTimeout(appendTimer)
          appendTimer = 0
        }
        resolveReady({
          error: error ? String(error.message || error) : '',
          ok: ok,
          state: state,
        })
      }

      function removeBufferListeners() {
        if (!sourceBuffer || !sourceBuffer.removeEventListener) return
        sourceBuffer.removeEventListener('error', onBufferError)
        sourceBuffer.removeEventListener('updateend', onUpdateEnd)
      }

      function fail(error) {
        buffer = null
        removeBufferListeners()
        if (mediaSource.readyState === 'open') {
          try { mediaSource.endOfStream('decode') } catch (endError) {}
        }
        settle(false, 'append-failed', error)
      }

      function onBufferError() {
        fail(new Error('SourceBuffer rejected the fragmented MP4'))
      }

      function onUpdateEnd() {
        if (released || !sourceBuffer || sourceBuffer.updating) return
        buffer = null
        removeBufferListeners()
        try {
          if (mediaSource.readyState === 'open') mediaSource.endOfStream()
        } catch (error) {
          fail(error)
          return
        }
        settle(true, 'buffered')
      }

      function onSourceOpen() {
        if (mediaSource.removeEventListener) mediaSource.removeEventListener('sourceopen', onSourceOpen)
        if (released) return
        try {
          sourceBuffer = mediaSource.addSourceBuffer(info.mimeType)
          sourceBuffer.addEventListener('error', onBufferError)
          sourceBuffer.addEventListener('updateend', onUpdateEnd)
          appendTimer = setTimeout(function () {
            fail(new Error('MediaSource append timed out'))
          }, APPEND_TIMEOUT_MS)
          sourceBuffer.appendBuffer(buffer)
        } catch (error) {
          fail(error)
        }
      }

      function onSourceClose() {
        if (!released && !settled) fail(new Error('MediaSource closed before buffering completed'))
      }

      mediaSource.addEventListener('sourceopen', onSourceOpen)
      mediaSource.addEventListener('sourceclose', onSourceClose)

      return {
        mediaSource: mediaSource,
        mimeType: info.mimeType,
        ready: ready,
        release: function () {
          if (released) return false
          released = true
          buffer = null
          if (mediaSource.removeEventListener) {
            mediaSource.removeEventListener('sourceopen', onSourceOpen)
            mediaSource.removeEventListener('sourceclose', onSourceClose)
          }
          removeBufferListeners()
          if (sourceBuffer && sourceBuffer.updating && typeof sourceBuffer.abort === 'function') {
            try { sourceBuffer.abort() } catch (error) {}
          }
          if (mediaSource.readyState === 'open') {
            try { mediaSource.endOfStream() } catch (error) {}
          }
          settle(false, 'released')
          return true
        },
      }
    })
  }

  DCWeb.MediaSourceFallback = {
    MAX_BYTES: MAX_BYTES,
    create: create,
    inspect: inspect,
  }
})(window)
