;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var MAX_MOOV_BYTES = 4 * 1024 * 1024
  var MAX_NESTED_BOXES = 512
  var MAX_TOP_LEVEL_BOXES = 128
  var AAC_OBJECT_TYPES = {
    1: true,
    2: true,
    3: true,
    4: true,
    5: true,
    6: true,
    17: true,
    19: true,
    20: true,
    23: true,
    29: true,
    39: true,
    42: true,
  }

  function typeAt(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.byteLength) return ''
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
  }

  function readUint16(bytes, offset) {
    if (offset < 0 || offset + 2 > bytes.byteLength) return -1
    return bytes[offset] * 0x100 + bytes[offset + 1]
  }

  function readUint32(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.byteLength) return -1
    return bytes[offset] * 0x1000000 +
      bytes[offset + 1] * 0x10000 +
      bytes[offset + 2] * 0x100 +
      bytes[offset + 3]
  }

  function readUint64(bytes, offset) {
    var high = readUint32(bytes, offset)
    var low = readUint32(bytes, offset + 4)
    if (high < 0 || low < 0) return -1
    var value = high * 0x100000000 + low
    return Number.isSafeInteger(value) ? value : -1
  }

  function boxAt(bytes, start, end) {
    if (start < 0 || start + 8 > end) return null
    var size = readUint32(bytes, start)
    var headerSize = 8
    if (size === 1) {
      if (start + 16 > end) return null
      size = readUint64(bytes, start + 8)
      headerSize = 16
    } else if (size === 0) size = end - start
    if (!Number.isSafeInteger(size) || size < headerSize || start + size > end) return null
    return {
      end: start + size,
      headerSize: headerSize,
      size: size,
      start: start,
      type: typeAt(bytes, start + 4),
    }
  }

  function boxesIn(bytes, start, end) {
    var boxes = []
    var cursor = start
    while (cursor < end) {
      if (boxes.length >= MAX_NESTED_BOXES) return null
      var box = boxAt(bytes, cursor, end)
      if (!box) return null
      boxes.push(box)
      cursor = box.end
    }
    return cursor === end ? boxes : null
  }

  function boxesOf(bytes, parent) {
    return boxesIn(bytes, parent.start + parent.headerSize, parent.end)
  }

  function boxesByType(boxes, type) {
    return (boxes || []).filter(function (box) { return box.type === type })
  }

  function oneBox(boxes, type) {
    var matches = boxesByType(boxes, type)
    return matches.length === 1 ? matches[0] : null
  }

  function child(bytes, parent, type) {
    var boxes = boxesOf(bytes, parent)
    return boxes ? oneBox(boxes, type) : null
  }

  function handlerType(bytes, track) {
    var media = child(bytes, track, 'mdia')
    var handler = media && child(bytes, media, 'hdlr')
    var offset = handler && handler.start + handler.headerSize + 8
    return offset && offset + 4 <= handler.end ? typeAt(bytes, offset) : ''
  }

  function sampleEntry(bytes, track) {
    var media = child(bytes, track, 'mdia')
    var mediaInfo = media && child(bytes, media, 'minf')
    var sampleTable = mediaInfo && child(bytes, mediaInfo, 'stbl')
    var descriptions = sampleTable && child(bytes, sampleTable, 'stsd')
    if (!descriptions) return null
    var payload = descriptions.start + descriptions.headerSize
    if (payload + 8 > descriptions.end || readUint32(bytes, payload + 4) !== 1) return null
    var entries = boxesIn(bytes, payload + 8, descriptions.end)
    return entries && entries.length === 1 ? entries[0] : null
  }

  function hexByte(value) {
    return Number(value || 0).toString(16).padStart(2, '0')
  }

  function videoCodecFor(bytes, track) {
    var sample = sampleEntry(bytes, track)
    if (!sample || (sample.type !== 'avc1' && sample.type !== 'avc3')) return ''
    var childStart = sample.start + sample.headerSize + 78
    if (childStart > sample.end) return ''
    var sampleChildren = boxesIn(bytes, childStart, sample.end)
    var config = sampleChildren && oneBox(sampleChildren, 'avcC')
    var payload = config && config.start + config.headerSize
    if (!payload || payload + 4 > config.end || bytes[payload] !== 1) return ''
    return sample.type + '.' + hexByte(bytes[payload + 1]) + hexByte(bytes[payload + 2]) + hexByte(bytes[payload + 3])
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

  function audioCodecFor(bytes, track) {
    var sample = sampleEntry(bytes, track)
    if (!sample || sample.type !== 'mp4a') return ''
    var payload = sample.start + sample.headerSize
    var version = readUint16(bytes, payload + 8)
    var childStart = payload + 28
    if (version === 1) childStart += 16
    else if (version === 2) childStart += 36
    else if (version !== 0) return ''
    if (childStart > sample.end) return ''
    var sampleChildren = boxesIn(bytes, childStart, sample.end)
    var elementaryStream = sampleChildren && oneBox(sampleChildren, 'esds')
    if (!elementaryStream) return ''

    var descriptor = readDescriptor(bytes, elementaryStream.start + elementaryStream.headerSize + 4, elementaryStream.end)
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
    if (!decoder || decoder.tag !== 4 || decoder.start + 13 > decoder.end || bytes[decoder.start] !== 0x40) return ''
    var config = readDescriptor(bytes, decoder.start + 13, decoder.end)
    if (!config || config.tag !== 5 || config.start >= config.end) return ''
    var audioObjectType = bytes[config.start] >> 3
    if (audioObjectType === 31) {
      if (config.start + 1 >= config.end) return ''
      audioObjectType = 32 + ((bytes[config.start] & 7) << 3) + (bytes[config.start + 1] >> 5)
    }
    return AAC_OBJECT_TYPES[audioObjectType] ? 'mp4a.40.' + audioObjectType : ''
  }

  function inspectMoov(buffer) {
    var bytes = new Uint8Array(buffer)
    var movie = boxAt(bytes, 0, bytes.byteLength)
    if (!movie || movie.type !== 'moov' || movie.end !== bytes.byteLength) return null
    var movieChildren = boxesOf(bytes, movie)
    if (!movieChildren || boxesByType(movieChildren, 'mvex').length) return null
    var tracks = boxesByType(movieChildren, 'trak')
    if (tracks.length !== 2) return null

    var audioTrack = null
    var videoTrack = null
    tracks.forEach(function (track) {
      var type = handlerType(bytes, track)
      if (type === 'soun') audioTrack = audioTrack ? null : track
      if (type === 'vide') videoTrack = videoTrack ? null : track
    })
    if (!audioTrack || !videoTrack) return null
    var audioCodec = audioCodecFor(bytes, audioTrack)
    var videoCodec = videoCodecFor(bytes, videoTrack)
    if (!audioCodec || !videoCodec) return null
    return {
      audioCodec: audioCodec,
      audioTrackTypeOffset: audioTrack.start + 4,
      videoCodec: videoCodec,
    }
  }

  function readTopLevelBox(blob, start) {
    var end = Math.min(blob.size, start + 16)
    return blob.slice(start, end).arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer)
      if (bytes.byteLength < 8) return null
      var size = readUint32(bytes, 0)
      var headerSize = 8
      if (size === 1) {
        if (bytes.byteLength < 16) return null
        size = readUint64(bytes, 8)
        headerSize = 16
      } else if (size === 0) size = blob.size - start
      if (!Number.isSafeInteger(size) || size < headerSize || start + size > blob.size) return null
      return {
        end: start + size,
        headerSize: headerSize,
        size: size,
        start: start,
        type: typeAt(bytes, 4),
      }
    })
  }

  function topLevelBoxes(blob) {
    var boxes = []
    var cursor = 0
    function next() {
      if (cursor === blob.size) return boxes
      if (cursor > blob.size || boxes.length >= MAX_TOP_LEVEL_BOXES) return null
      return readTopLevelBox(blob, cursor).then(function (box) {
        if (!box) return null
        boxes.push(box)
        cursor = box.end
        return next()
      })
    }
    return Promise.resolve().then(next)
  }

  function create(blob) {
    if (!blob || typeof blob.slice !== 'function' || !Number.isSafeInteger(Number(blob.size)) || Number(blob.size) < 8) {
      return Promise.resolve(null)
    }
    return topLevelBoxes(blob).then(function (boxes) {
      if (!boxes || oneBox(boxes, 'ftyp') === null || boxesByType(boxes, 'mdat').length < 1 || boxesByType(boxes, 'moof').length) {
        return null
      }
      var movie = oneBox(boxes, 'moov')
      if (!movie || movie.size > MAX_MOOV_BYTES) return null
      return blob.slice(movie.start, movie.end).arrayBuffer().then(function (buffer) {
        var info = inspectMoov(buffer)
        if (!info) return null
        var typeOffset = movie.start + info.audioTrackTypeOffset
        if (typeOffset < movie.start + movie.headerSize || typeOffset + 4 > movie.end) return null
        var visualBlob = new Blob([
          blob.slice(0, typeOffset),
          new Uint8Array([0x66, 0x72, 0x65, 0x65]),
          blob.slice(typeOffset + 4),
        ], { type: 'video/mp4' })
        if (visualBlob.size !== blob.size) return null
        return {
          audioCodec: info.audioCodec,
          audioTrackTypeOffset: typeOffset,
          blob: visualBlob,
          videoCodec: info.videoCodec,
        }
      })
    })
  }

  DCWeb.Mp4VisualFallback = {
    MAX_MOOV_BYTES: MAX_MOOV_BYTES,
    MAX_TOP_LEVEL_BOXES: MAX_TOP_LEVEL_BOXES,
    create: create,
    inspectMoov: inspectMoov,
  }
})(window)
