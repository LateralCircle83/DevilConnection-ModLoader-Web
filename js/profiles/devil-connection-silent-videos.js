;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var MAX_BYTES = 1024 * 1024

  function typeAt(bytes, offset) {
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
  }

  function readUint32(view, offset) {
    return view.getUint32(offset, false)
  }

  function readUint64(view, offset) {
    var value = readUint32(view, offset) * 0x100000000 + readUint32(view, offset + 4)
    if (!Number.isSafeInteger(value)) throw new Error('MP4 box size exceeds the safe integer range')
    return value
  }

  function boxesIn(bytes, start, end) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    var boxes = []
    var cursor = start
    while (cursor < end) {
      if (cursor + 8 > end) throw new Error('Truncated MP4 box header')
      var size = readUint32(view, cursor)
      var headerSize = 8
      if (size === 1) {
        if (cursor + 16 > end) throw new Error('Truncated extended MP4 box header')
        size = readUint64(view, cursor + 8)
        headerSize = 16
      } else if (size === 0) size = end - cursor
      if (size < headerSize || cursor + size > end) throw new Error('Invalid MP4 box size')
      boxes.push({ end: cursor + size, headerSize: headerSize, size: size, start: cursor, type: typeAt(bytes, cursor + 4) })
      cursor += size
    }
    return boxes
  }

  function oneBox(boxes, type, owner) {
    var matches = boxes.filter(function (box) { return box.type === type })
    if (matches.length !== 1) throw new Error(owner + ' requires exactly one ' + type + ' box')
    return matches[0]
  }

  function handlerType(bytes, track) {
    var media = oneBox(boxesIn(bytes, track.start + track.headerSize, track.end), 'mdia', 'trak')
    var handler = oneBox(boxesIn(bytes, media.start + media.headerSize, media.end), 'hdlr', 'mdia')
    var offset = handler.start + handler.headerSize + 8
    if (offset + 4 > handler.end) throw new Error('Truncated MP4 handler box')
    return typeAt(bytes, offset)
  }

  function transform(buffer) {
    var source = buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    var output = new Uint8Array(source)
    var topLevel = boxesIn(output, 0, output.byteLength)
    oneBox(topLevel, 'ftyp', 'MP4')
    oneBox(topLevel, 'mdat', 'MP4')
    var movie = oneBox(topLevel, 'moov', 'MP4')
    var tracks = boxesIn(output, movie.start + movie.headerSize, movie.end).filter(function (box) { return box.type === 'trak' })
    var audioTracks = []
    var videoTracks = []
    tracks.forEach(function (track) {
      var type = handlerType(output, track)
      if (type === 'soun') audioTracks.push(track)
      if (type === 'vide') videoTracks.push(track)
    })
    if (audioTracks.length !== 1 || videoTracks.length !== 1 || tracks.length !== 2) {
      throw new Error('Expected one audio track and one video track')
    }

    // Preserve every byte position so the video track's absolute chunk offsets stay valid.
    output.set([0x66, 0x72, 0x65, 0x65], audioTracks[0].start + 4)
    return output.buffer
  }

  function createPatch(options) {
    return {
      description: options.description,
      failure: 'abort-session',
      format: 'binary',
      id: options.id,
      maxBytes: MAX_BYTES,
      name: options.name,
      required: true,
      signatures: [
        { name: options.signatureName + '大小', size: options.size },
        { name: options.signatureName + '版本', sha256: options.sha256 },
      ],
      target: options.target,
      transform: transform,
      unsupportedMod: 'delegate-to-runtime',
    }
  }

  DCWeb.DevilConnectionKiriVideoPatch = createPatch({
    description: '移除迷雾转场视频中全静音且 Android Chromium 无法解封装的 AAC 轨。',
    id: 'devil-connection-kiri-video-android-compat',
    name: '迷雾视频 Android 兼容',
    signatureName: '迷雾视频',
    size: 346767,
    sha256: 'ffde567fc3088cc63a72461fe7ba82a4091c22f1bd2f29b4aa5332d6ef85b11f',
    target: 'data/video/kiri2.mp4',
  })

  DCWeb.DevilConnectionEffectVideoPatch = createPatch({
    description: '移除 effect.mp4 中全静音且 Android Chromium 无法解封装的 AAC 轨。',
    id: 'devil-connection-effect-video-android-compat',
    name: 'Effect 视频 Android 兼容',
    signatureName: 'Effect 视频',
    size: 963462,
    sha256: '0151e07fec302ed5de5998dda6202b5120d7c0c2cc612e90c98640f04055c9bd',
    target: 'data/video/effect.mp4',
  })
})(window)
