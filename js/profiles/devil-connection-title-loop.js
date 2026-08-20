;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var PATCH_MARKER = '__dcTitleLoopQueuePatch'
  var SETUP_SIGNATURE = '  setUpMediaSourceForLoop: function (video, name) {'
  var VIDEO_APPEND_SIGNATURE = '        videoBuffer.appendBuffer(secondaryVideoBuffer)'
  var AUDIO_APPEND_SIGNATURE = '        audioBuffer.appendBuffer(secondaryAudioBuffer)'
  var VIDEO_TIMER_SIGNATURE = 'TYRANO.kag.dc.loopTimers[`${name}_v`] = setInterval('
  var AUDIO_TIMER_SIGNATURE = 'TYRANO.kag.dc.loopTimers[`${name}_a`] = setInterval('
  var TEARDOWN_SIGNATURE = '  tearDownMediaSourceForLoop: function (name) {'
  var TEARDOWN_POLL_SIGNATURE = '        setTimeout(endStream, 10)'
  var REVOKE_SIGNATURE = '      URL.revokeObjectURL(url)'

  function installTitleLoopQueue(target) {
    'use strict'

    var kag = target.TYRANO && target.TYRANO.kag
    var dc = kag && kag.dc
    if (!dc || dc.__dcTitleLoopQueuePatch) return

    var states = Object.create(null)
    var VIDEO_TYPE = 'video/mp4; codecs="avc1.640028"'
    var AUDIO_TYPE = 'audio/mpeg'
    var KEEP_HEAD_SECONDS = 1
    // WebKit Bug 157539：对默认应使用 segments 的带时间戳媒体（video/mp4、AAC/mp4），
    // 强制 sequence 模式不会按生成时间戳追加，Safari 只缓冲约半秒且把样本放到
    // “文件内部时间戳 + timestampOffset” 的位置，导致标题循环视频黑屏。
    // 标题视频是 fragmented MP4（片段时间戳从 0 连续递增），segments 模式 +
    // timestampOffset 串接才是各引擎一致的正确组合。
    var VIDEO_APPEND_MODE = 'segments'
    // WebKit Bug 156316：MSE 内容不以 0ms 精确开始（例如首帧 PTS 偏移 83ms）时，
    // Safari 拒绝从 0 起播，画面保持黑屏。本体标题视频（title_main*.mp4 /
    // title_loop*.mp4）的首帧 PTS 均为 1024/12288 ≈ 0.0833s，因此必须用
    // timestampOffset 把时间轴对齐到 0，并让循环段首帧精确落在上一段缓冲终点。
    // MP3 没有片段时间戳，sequence 模式是唯一可用语义，Safari 也始终按 sequence
    // 处理 audio/mpeg（同 Bug 157539），配合 appendWindowStart/End 做无间隙拼接。
    var AUDIO_APPEND_MODE = 'sequence'

    dc.loopTimers = dc.loopTimers || {}
    dc.mediaSources = dc.mediaSources || {}
    // 临时兜底（WebKitGTK/WPE 未配置 MSE_MAX_BUFFER_SIZE 时 SourceBuffer 上限
    // 约 15MB，18MB 主段首次追加即 QuotaExceededError；现代 Chrome/FF/Safari
    // 配额远大于此，配合下方回收不会走到这里）。
    dc.__dcTitleLoopFallback = dc.__dcTitleLoopFallback || {}
    dc.__dcTitleLoopPaths = dc.__dcTitleLoopPaths || {}
    if (typeof dc.loadLoopBuffers === 'function' && !dc.__dcTitleLoopPathsHook) {
      dc.__dcTitleLoopPathsHook = true
      var originalLoadLoopBuffers = dc.loadLoopBuffers
      dc.loadLoopBuffers = function (name, primaryVideo, primaryAudio, secondaryVideo, secondaryAudio) {
        dc.__dcTitleLoopPaths[String(name || '')] = {
          primaryAudio: primaryAudio ? String(primaryAudio) : null,
          primaryVideo: primaryVideo ? String(primaryVideo) : null,
          secondaryAudio: secondaryAudio ? String(secondaryAudio) : null,
          secondaryVideo: secondaryVideo ? String(secondaryVideo) : null,
        }
        return originalLoadLoopBuffers.apply(this, arguments)
      }
    }

    function asError(reason, fallback) {
      if (reason instanceof Error) return reason
      return new Error(String(reason || fallback || 'Title loop MediaSource failed'))
    }

    function warn(state, error) {
      if (state.failureWarned) return
      state.failureWarned = true
      if (target.console && typeof target.console.warn === 'function') {
        target.console.warn('[DC title loop] ' + state.name + ': ' + error.message)
      }
    }

    function warnAudioDegrade(state, error) {
      if (!state || state.audioDegradeWarned) return
      state.audioDegradeWarned = true
      if (target.console && typeof target.console.warn === 'function') {
        target.console.warn('[DC title loop] ' + state.name + ': ' + (error && error.message ? error.message : String(error)))
      }
    }

    function createAudioFallback(state) {
      if (state.audioFallback || !state.primaryAudioBuffer) return
      var document = target.document
      if (!document || typeof document.createElement !== 'function' ||
        typeof target.Blob !== 'function' || typeof target.URL.createObjectURL !== 'function') {
        return
      }
      try {
        var audio = document.createElement('audio')
        var primaryUrl = target.URL.createObjectURL(new target.Blob([state.primaryAudioBuffer], { type: 'audio/mpeg' }))
        var loopUrl = state.secondaryAudioBuffer && state.secondaryAudioBuffer !== state.primaryAudioBuffer
          ? target.URL.createObjectURL(new target.Blob([state.secondaryAudioBuffer], { type: 'audio/mpeg' }))
          : primaryUrl
        audio.loop = false
        audio.volume = state.video && Number(state.video.volume) > 0 ? Number(state.video.volume) : 1
        state.audioFallback = audio
        state.audioFallbackUrls = [primaryUrl, loopUrl]
        state.audioFallbackStart = function () {
          if (state.audioFallbackStarted) return
          state.audioFallbackStarted = true
          if (!state.audioFallback || (state.disposed && !state.videoFallbackActive)) return
          syncAudioFallbackVolume(state)
          // 镜像标题视频音量：游戏淡出按 10ms 步进改写 video.volume，
          // 视频循环节拍（约 80s）太慢，需要独立高频采样才能跟随淡出。
          if (!state.volumeSyncTimer) {
            state.volumeSyncTimer = target.setTimeout(function volumeSyncTick() {
              if (state.disposed && !state.videoFallbackActive) {
                state.volumeSyncTimer = 0
                return
              }
              syncAudioFallbackVolume(state)
              state.volumeSyncTimer = target.setTimeout(volumeSyncTick, 50)
            }, 50)
          }
          audio.addEventListener('ended', function () {
            if (state.disposed && !state.videoFallbackActive) return
            if (audio.src === primaryUrl) {
              audio.loop = true
              audio.src = loopUrl
              try { audio.play() } catch (error) {}
            }
          })
          audio.src = primaryUrl
          audio.loop = false
          try { audio.play() } catch (error) {}
        }
        ;(document.body || document.documentElement).appendChild(audio)
      } catch (error) {
        warnAudioDegrade(state, error)
      }
    }

    function syncAudioFallbackVolume(state) {
      var audio = state && state.audioFallback
      var video = state && state.video
      if (!audio || !video) return
      var volume = Number(video.volume)
      if (!isFinite(volume)) return
      audio.volume = Math.max(0, Math.min(1, volume))
    }

    function isQuotaError(error) {
      if (!error) return false
      return error.name === 'QuotaExceededError' || error.code === 22 || /quota/i.test(String(error.message || ''))
    }

    function cleanupFallbackEntry(name) {
      var entry = dc.__dcTitleLoopFallback && dc.__dcTitleLoopFallback[String(name || '')]
      if (!entry) return
      delete dc.__dcTitleLoopFallback[String(name || '')]
      if (entry.state) {
        // 读档等路径只调 tearDown、不摘除 .title_movie 元素，必须在这里
        // 暂停视频、移除降级用 ended 监听并断开 src，避免降级视频残留。
        if (entry.state.videoFallbackEnded && entry.state.video &&
          typeof entry.state.video.removeEventListener === 'function') {
          try { entry.state.video.removeEventListener('ended', entry.state.videoFallbackEnded) } catch (error) {}
        }
        detachVideo(entry.state)
        if (entry.state.volumeSyncTimer) {
          try { target.clearTimeout(entry.state.volumeSyncTimer) } catch (error) {}
          entry.state.volumeSyncTimer = 0
        }
        if (entry.state.audioFallback) {
          try { entry.state.audioFallback.pause() } catch (error) {}
          try {
            if (entry.state.audioFallback.parentNode && typeof entry.state.audioFallback.parentNode.removeChild === 'function') {
              entry.state.audioFallback.parentNode.removeChild(entry.state.audioFallback)
            }
          } catch (error) {}
        }
      }
      ;(entry.urls || []).forEach(function (url) {
        try {
          if (target.URL && typeof target.URL.revokeObjectURL === 'function') target.URL.revokeObjectURL(url)
        } catch (error) {}
      })
    }

    // 临时兜底：视频轨 QuotaExceededError 时切换为渐进式播放。优先使用
    // loadLoopBuffers 记录的真实 VFS 路径（与普通 [movie] 同一受管通道），
    // 路径不可用时退回内存 Blob。复用游戏创建的同一 video 元素，主段播完切
    // 循环段并 loop；音频走既有 plain-audio 降级。退出时统一回收 URL 并停掉
    // 降级音频。
    function startVideoFallback(state, reason) {
      if (!state || state.videoFallbackActive || state.disposed || !state.primaryVideoBuffer) return false
      var video = state.video
      if (!video || !target.Blob || !target.URL || typeof target.URL.createObjectURL !== 'function') return false
      state.videoFallbackActive = true
      var paths = dc.__dcTitleLoopPaths && dc.__dcTitleLoopPaths[state.name]
      var pathPrimary = paths && paths.primaryVideo && /(^|[/\\])data\//i.test(paths.primaryVideo)
        ? String(paths.primaryVideo)
        : ''
      var pathLoop = paths && paths.secondaryVideo && /(^|[/\\])data\//i.test(paths.secondaryVideo)
        ? String(paths.secondaryVideo)
        : ''
      try {
        var primaryBlobUrl = ''
        var primarySrc = pathPrimary
        if (!primarySrc) {
          primaryBlobUrl = target.URL.createObjectURL(new target.Blob([state.primaryVideoBuffer], { type: 'video/mp4' }))
          primarySrc = primaryBlobUrl
        }
        var hasSeparateLoop = Boolean(state.secondaryVideoBuffer && state.secondaryVideoBuffer !== state.primaryVideoBuffer)
        var loopBlobUrl = ''
        var loopSrc = pathLoop
        if (!loopSrc && hasSeparateLoop) {
          loopBlobUrl = target.URL.createObjectURL(new target.Blob([state.secondaryVideoBuffer], { type: 'video/mp4' }))
          loopSrc = loopBlobUrl
        }
        if (!loopSrc) loopSrc = primarySrc
        state.videoFallbackUrls = []
        if (primaryBlobUrl) state.videoFallbackUrls.push(primaryBlobUrl)
        if (loopBlobUrl && loopBlobUrl !== primaryBlobUrl) state.videoFallbackUrls.push(loopBlobUrl)
        if (!state.audioFallback && state.primaryAudioBuffer) createAudioFallback(state)
        if (typeof state.audioFallbackStart === 'function') {
          try { state.audioFallbackStart() } catch (error) {}
        }
        dispose(state, reason, true)
        dc.__dcTitleLoopFallback = dc.__dcTitleLoopFallback || {}
        dc.__dcTitleLoopFallback[state.name] = {
          state: state,
          urls: state.videoFallbackUrls.concat(state.audioFallbackUrls || []),
        }
        video.loop = false
        state.videoFallbackOnMain = true
        video.src = primarySrc
        var onFallbackEnded = function () {
          if (!state || !state.videoFallbackActive) return
          if (state.videoFallbackOnMain && loopSrc !== primarySrc) {
            state.videoFallbackOnMain = false
            if (primaryBlobUrl) {
              var entry = dc.__dcTitleLoopFallback && dc.__dcTitleLoopFallback[state.name]
              if (entry && entry.urls) {
                var index = entry.urls.indexOf(primaryBlobUrl)
                if (index !== -1) entry.urls.splice(index, 1)
              }
              try { target.URL.revokeObjectURL(primaryBlobUrl) } catch (error) {}
            }
            video.src = loopSrc
            video.loop = true
          } else {
            video.loop = true
          }
          try { video.play() } catch (error) {}
        }
        video.addEventListener('ended', onFallbackEnded)
        state.videoFallbackEnded = onFallbackEnded
        var playResult
        try { playResult = video.play() } catch (error) {}
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch(function (error) {
            if (state.videoFallbackPlayWarned) return
            state.videoFallbackPlayWarned = true
            if (target.console && typeof target.console.warn === 'function') {
              target.console.warn('[DC title loop] ' + state.name + ': ' +
                asError(error, 'Title video fallback playback was rejected').message)
            }
          })
        }
        if (target.console && typeof target.console.warn === 'function') {
          target.console.warn('[DC title loop] ' + state.name +
            ': MSE 配额不足，标题循环切换为渐进式播放（' + primarySrc.slice(0, 60) + '）')
        }
        return true
      } catch (error) {
        state.videoFallbackActive = false
        cleanupFallbackEntry(state.name)
        if (state.videoFallbackUrls) {
          state.videoFallbackUrls.forEach(function (url) {
            try { target.URL.revokeObjectURL(url) } catch (revokeError) {}
          })
          state.videoFallbackUrls = null
        }
        return false
      }
    }

    function clearLoopTimer(state, trackName) {
      var key = state.name + '_' + trackName
      var timer = dc.loopTimers[key]
      if (timer !== undefined) target.clearTimeout(timer)
      delete dc.loopTimers[key]
    }

    function detachVideo(state) {
      var video = state && state.video
      if (!video) return
      try {
        if (typeof video.pause === 'function') video.pause()
      } catch (error) {}
      try {
        if (typeof video.removeAttribute === 'function') video.removeAttribute('src')
        if (typeof video.load === 'function') video.load()
      } catch (error) {}
    }

    function removeSourceBuffer(mediaSource, sourceBuffer) {
      if (!sourceBuffer) return
      if (sourceBuffer.updating && typeof sourceBuffer.abort === 'function') {
        try { sourceBuffer.abort() } catch (error) {}
      }
      if (mediaSource.readyState === 'open' && typeof mediaSource.removeSourceBuffer === 'function') {
        try { mediaSource.removeSourceBuffer(sourceBuffer) } catch (error) {}
      }
    }

    function dispose(state, reason, handoffVideo) {
      if (!state || state.disposed) return false
      state.disposed = true
      var detachedUrl = state.video ? String(state.video.currentSrc || state.video.src || '') : ''
      if (!handoffVideo) detachVideo(state)
      clearLoopTimer(state, 'v')
      clearLoopTimer(state, 'a')

      var error = asError(reason, 'Title loop was released')
      if (state.videoTrack) state.videoTrack.release(error)
      if (state.audioTrack) state.audioTrack.release(error)
      state.mediaSource.removeEventListener('sourceopen', state.onSourceOpen)
      state.mediaSource.removeEventListener('sourceclose', state.onSourceClose)
      removeSourceBuffer(state.mediaSource, state.videoBuffer)
      removeSourceBuffer(state.mediaSource, state.audioBuffer)
      if (state.mediaSource.readyState === 'open') {
        try { state.mediaSource.endOfStream() } catch (endError) {}
      }
      if (detachedUrl && detachedUrl.slice(0, 5) === 'blob:' && target.URL && typeof target.URL.revokeObjectURL === 'function') {
        try { target.URL.revokeObjectURL(detachedUrl) } catch (error) {}
      }
      if (!handoffVideo) {
        if (state.audioFallback) {
          try { state.audioFallback.pause() } catch (error) {}
          try {
            if (state.audioFallback.parentNode && typeof state.audioFallback.parentNode.removeChild === 'function') {
              state.audioFallback.parentNode.removeChild(state.audioFallback)
            }
          } catch (error) {}
        }
        if (state.audioFallbackUrls) {
          state.audioFallbackUrls.forEach(function (url) {
            try { target.URL.revokeObjectURL(url) } catch (error) {}
          })
        }
        if (state.videoFallbackUrls) {
          state.videoFallbackUrls.forEach(function (url) {
            try { target.URL.revokeObjectURL(url) } catch (error) {}
          })
          state.videoFallbackUrls = null
        }
        if (state.volumeSyncTimer) {
          try { target.clearTimeout(state.volumeSyncTimer) } catch (error) {}
          state.volumeSyncTimer = 0
        }
      }

      state.primaryVideoBuffer = null
      state.primaryAudioBuffer = null
      state.secondaryVideoBuffer = null
      state.secondaryAudioBuffer = null
      if (!handoffVideo) {
        state.audioFallback = null
        state.audioFallbackStart = null
        state.audioFallbackUrls = null
        state.videoFallbackEnded = null
      }
      state.videoTrack = null
      state.audioTrack = null
      state.videoBuffer = null
      state.audioBuffer = null
      state.loopDeadlines = null
      if (dc.mediaSources[state.name] === state.mediaSource) delete dc.mediaSources[state.name]
      if (states[state.name] === state) delete states[state.name]
      return true
    }

    function fail(state, reason, context) {
      if (!state || state.disposed) return
      var error = asError(reason)
      warn(state, error)
      if (context && context.track === 'Video' && isQuotaError(error)) {
        if (!state.videoQuotaFallbackTried) {
          state.videoQuotaFallbackTried = true
          if (startVideoFallback(state, error)) return
        }
      }
      dispose(state, error)
    }

    function createTrack(state, sourceBuffer, label) {
      var queue = []
      var current = null
      var released = false

      function rejectTask(task, error) {
        if (task && typeof task.reject === 'function') task.reject(error)
      }

      function pump() {
        if (released || state.disposed || current || sourceBuffer.updating || !queue.length) return
        if (state.mediaSource.readyState !== 'open') {
          fail(state, new Error(label + ' SourceBuffer is not open'))
          return
        }
        current = queue.shift()
        try {
          if (current.run) {
            current.run(sourceBuffer)
          } else {
            if (current.beforeAppend) current.beforeAppend(sourceBuffer)
            sourceBuffer.appendBuffer(current.buffer)
          }
        } catch (error) {
          var failedTask = current
          current = null
          rejectTask(failedTask, error)
          fail(state, error, { tag: failedTask && failedTask.tag, track: label })
        }
      }

      function onUpdateEnd() {
        if (!current) return
        var completed = current
        current = null
        completed.resolve(sourceBuffer)
        pump()
      }

      function onError() {
        var error = new Error(label + ' SourceBuffer rejected a segment')
        var failedTask = current
        current = null
        rejectTask(failedTask, error)
        fail(state, error, { tag: failedTask && failedTask.tag, track: label })
      }

      sourceBuffer.addEventListener('updateend', onUpdateEnd)
      sourceBuffer.addEventListener('error', onError)

      return {
        enqueue: function (buffer, beforeAppend) {
          return new target.Promise(function (resolve, reject) {
            if (released || state.disposed) {
              reject(new Error(label + ' SourceBuffer queue is closed'))
              return
            }
            queue.push({ beforeAppend: beforeAppend, buffer: buffer, reject: reject, resolve: resolve })
            pump()
          })
        },
        release: function (reason) {
          if (released) return false
          released = true
          sourceBuffer.removeEventListener('updateend', onUpdateEnd)
          sourceBuffer.removeEventListener('error', onError)
          var error = asError(reason, label + ' SourceBuffer queue was released')
          rejectTask(current, error)
          current = null
          while (queue.length) rejectTask(queue.shift(), error)
          return true
        },
        remove: function (start, end) {
          return new target.Promise(function (resolve, reject) {
            if (released || state.disposed) {
              reject(new Error(label + ' SourceBuffer queue is closed'))
              return
            }
            queue.push({
              reject: reject,
              resolve: resolve,
              run: function (sourceBuffer) {
                if (typeof sourceBuffer.remove === 'function') sourceBuffer.remove(start, end)
              },
            })
            pump()
          })
        },
      }
    }

    function bufferedEnd(sourceBuffer) {
      var buffered = sourceBuffer.buffered
      return buffered && buffered.length ? buffered.end(buffered.length - 1) : 0
    }

    function readBoxAscii(view, offset, length) {
      var out = ''
      for (var index = 0; index < length; index++) {
        out += String.fromCharCode(view.getUint8(offset + index))
      }
      return out
    }

    function firstVideoPresentationOffset(buffer) {
      // 有界只读解析：读取 moov 内视频轨 timescale，以及第一个 moof 的
      // tfdt + 首样本 composition offset，返回首帧 PTS（秒）。
      // 任何解析失败都返回 0，保持原有 timestampOffset 行为。
      try {
        var view = null
        if (buffer && typeof buffer.byteLength === 'number' && typeof buffer.buffer === 'object' && buffer.buffer) {
          view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        } else if (buffer && typeof buffer.byteLength === 'number') {
          view = new DataView(buffer)
        }
        if (!view || !view.byteLength) return 0

        function boxList(start, end, limit) {
          var boxes = []
          var offset = start
          var guard = 0
          while (offset + 8 <= end && guard < limit) {
            guard++
            var size = view.getUint32(offset, false)
            var type = readBoxAscii(view, offset + 4, 4)
            var header = 8
            if (size === 1) {
              size = view.getUint32(offset + 8, false) * 0x100000000 + view.getUint32(offset + 12, false)
              header = 16
            } else if (size === 0) {
              size = end - offset
            }
            if (size < header || offset + size > end) break
            boxes.push({ end: offset + size, start: offset + header, type: type })
            offset += size
          }
          return boxes
        }

        var moov = null
        var firstMoof = null
        boxList(0, view.byteLength, 64).forEach(function (box) {
          if (box.type === 'moov') moov = box
          else if (box.type === 'moof' && !firstMoof) firstMoof = box
        })
        if (!moov || !firstMoof) return 0

        var trackId = null
        var timescale = null
        boxList(moov.start, moov.end, 64).forEach(function (trak) {
          if (trak.type !== 'trak' || timescale) return
          var trakTrackId = null
          var trakTimescale = null
          boxList(trak.start, trak.end, 64).forEach(function (entry) {
            if (entry.type === 'tkhd') {
              var version = view.getUint8(entry.start)
              trakTrackId = view.getUint32(entry.start + (version === 1 ? 20 : 12), false)
            } else if (entry.type === 'mdia') {
              boxList(entry.start, entry.end, 64).forEach(function (mdiaBox) {
                if (mdiaBox.type !== 'mdhd') return
                var mdhdVersion = view.getUint8(mdiaBox.start)
                trakTimescale = view.getUint32(mdiaBox.start + (mdhdVersion === 1 ? 20 : 12), false)
              })
            }
          })
          if (trakTrackId !== null) trackId = trakTrackId
          if (trakTimescale !== null) timescale = trakTimescale
        })
        if (!timescale) return 0

        var tfdt = null
        var firstCts = null
        boxList(firstMoof.start, firstMoof.end, 64).forEach(function (traf) {
          if (traf.type !== 'traf') return
          boxList(traf.start, traf.end, 64).forEach(function (entry) {
            if (entry.type === 'tfhd') {
              var flags = (view.getUint8(entry.start + 1) << 16) |
                (view.getUint8(entry.start + 2) << 8) |
                view.getUint8(entry.start + 3)
              var entryTrackId = view.getUint32(entry.start + 4, false)
              if (trackId !== null && entryTrackId !== trackId) return
            }
            if (entry.type === 'tfdt') {
              var tfdtVersion = view.getUint8(entry.start)
              tfdt = tfdtVersion === 1
                ? view.getUint32(entry.start + 4, false) * 0x100000000 + view.getUint32(entry.start + 8, false)
                : view.getUint32(entry.start + 4, false)
            }
            if (entry.type === 'trun' && firstCts === null) {
              var trunFlags = (view.getUint8(entry.start + 1) << 16) |
                (view.getUint8(entry.start + 2) << 8) |
                view.getUint8(entry.start + 3)
              var pos = entry.start + 8
              if (trunFlags & 0x1) pos += 4
              if (trunFlags & 0x4) pos += 4
              if (trunFlags & 0x100) pos += 4
              if (trunFlags & 0x200) pos += 4
              if (trunFlags & 0x400) pos += 4
              firstCts = trunFlags & 0x800 ? view.getInt32(pos, false) : 0
            }
          })
        })
        if (tfdt === null || firstCts === null) return 0
        return (tfdt + firstCts) / timescale
      } catch (error) {
        return 0
      }
    }

    function positiveDuration(value, label) {
      var duration = Number(value)
      if (!isFinite(duration) || duration <= 0) throw new Error(label + ' duration is invalid')
      return duration
    }

    function gaplessData(buffer, label) {
      if (!target.llama || typeof target.llama.parseGaplessData !== 'function') {
        throw new Error('Gapless audio parser is unavailable')
      }
      var gapless = target.llama.parseGaplessData(buffer)
      positiveDuration(gapless && gapless.audioDuration, label)
      return gapless
    }

    function makeAudioGapless(gapless, sourceBuffer) {
      var offset = bufferedEnd(sourceBuffer)
      sourceBuffer.appendWindowStart = offset
      sourceBuffer.appendWindowEnd = offset + gapless.audioDuration
      sourceBuffer.timestampOffset = offset - gapless.frontPaddingDuration
    }

    // 所有引擎的 MSE 都有缓冲配额（Chrome ~150MB / Firefox ~100MB /
    // Safari ~290MB）。原游戏循环段反复 append 且从不 remove，缓冲随停留时间
    // 无界增长，最终都会在 appendBuffer 时抛 QuotaExceededError。
    // 这里在每次循环段追加完成后，把已播放到 currentTime - 1s 之前的头部缓冲
    // 经同一串行队列移除，使缓冲恒定在“主段 + 循环段 + 1s”量级。
    function evictPlayedHead(state, sourceBuffer, track) {
      var currentTime = Number(state.video && state.video.currentTime) || 0
      var safeHead = Math.max(0, currentTime - KEEP_HEAD_SECONDS)
      if (safeHead <= 0) return target.Promise.resolve()
      var end = Math.min(safeHead, bufferedEnd(sourceBuffer))
      if (end <= 0) return target.Promise.resolve()
      // 防御：引擎若没有 SourceBuffer.remove，跳过回收，避免 remove 任务
      // 永远等不到 updateend 而卡死整条串行队列。
      if (!sourceBuffer || typeof sourceBuffer.remove !== 'function') return target.Promise.resolve()
      return track.remove(0, end)
    }

    function scheduleLoop(state, trackName, duration, append) {
      if (state.disposed) return
      clearLoopTimer(state, trackName)
      var interval = Math.max(1, Math.floor(positiveDuration(duration, trackName + ' loop') * 1000))
      var now = target.performance && typeof target.performance.now === 'function'
        ? target.performance.now()
        : Date.now()
      var deadline = state.loopDeadlines[trackName]
      if (!deadline || deadline < now - interval) deadline = now + interval
      else deadline += interval
      state.loopDeadlines[trackName] = deadline
      var delay = Math.max(1, Math.floor(deadline - now))
      var key = state.name + '_' + trackName
      dc.loopTimers[key] = target.setTimeout(function () {
        delete dc.loopTimers[key]
        if (state.disposed) return
        target.Promise.resolve().then(append).then(function () {
          scheduleLoop(state, trackName, duration, append)
        }).catch(function (error) {
          fail(state, error)
        })
      }, delay)
    }

    function begin(state) {
      var mainFirstPts = firstVideoPresentationOffset(state.primaryVideoBuffer)
      var loopFirstPts = firstVideoPresentationOffset(state.secondaryVideoBuffer)
      var videoMainEnd = 0
      var loopVideoDuration = 0
      var loopAudioDuration = 0

      var videoReady = state.videoTrack.enqueue(state.primaryVideoBuffer, function (sourceBuffer) {
        if (mainFirstPts > 0) sourceBuffer.timestampOffset = -mainFirstPts
      }).then(function () {
        videoMainEnd = bufferedEnd(state.videoBuffer)
        return state.videoTrack.enqueue(state.secondaryVideoBuffer, function (sourceBuffer) {
          sourceBuffer.timestampOffset = bufferedEnd(sourceBuffer) - loopFirstPts
        })
      }).then(function () {
        loopVideoDuration = positiveDuration(bufferedEnd(state.videoBuffer) - videoMainEnd, 'video loop')
      })

      var audioReady = target.Promise.resolve()
      var loopGapless = null
      if (state.audioTrack) {
        audioReady = target.Promise.resolve().then(function () {
          var primaryGapless = gaplessData(state.primaryAudioBuffer, 'primary audio')
          loopGapless = gaplessData(state.secondaryAudioBuffer, 'audio loop')
          loopAudioDuration = loopGapless.audioDuration
          return state.audioTrack.enqueue(state.primaryAudioBuffer, function (sourceBuffer) {
            makeAudioGapless(primaryGapless, sourceBuffer)
          })
        }).then(function () {
          return state.audioTrack.enqueue(state.secondaryAudioBuffer, function (sourceBuffer) {
            makeAudioGapless(loopGapless, sourceBuffer)
          })
        })
      }

      target.Promise.all([videoReady, audioReady]).then(function () {
        if (state.disposed) return
        var playResult
        try { playResult = state.video.play() } catch (error) { fail(state, error); return }
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch(function (error) {
            if (state.playWarning || state.disposed) return
            state.playWarning = true
            if (target.console && typeof target.console.warn === 'function') {
              target.console.warn('[DC title loop] ' + state.name + ': ' + asError(error, 'Title video playback was rejected').message)
            }
          })
        }
        if (typeof state.audioFallbackStart === 'function') {
          try { state.audioFallbackStart() } catch (error) {}
        }
        scheduleLoop(state, 'v', loopVideoDuration, function () {
          return state.videoTrack.enqueue(state.secondaryVideoBuffer, function (sourceBuffer) {
            sourceBuffer.timestampOffset = bufferedEnd(sourceBuffer) - loopFirstPts
          }).then(function () {
            return evictPlayedHead(state, state.videoBuffer, state.videoTrack)
          })
        })
        if (state.audioTrack) {
          scheduleLoop(state, 'a', loopAudioDuration, function () {
            return state.audioTrack.enqueue(state.secondaryAudioBuffer, function (sourceBuffer) {
              makeAudioGapless(loopGapless, sourceBuffer)
            }).then(function () {
              return evictPlayedHead(state, state.audioBuffer, state.audioTrack)
            })
          })
        }
      }).catch(function (error) {
        fail(state, error)
      })
    }

    dc.setUpMediaSourceForLoop = function (video, name) {
      name = String(name || '')
      dc.tearDownMediaSourceForLoop(name)
      var buffers = dc.getLoopBuffers(name)
      var primaryVideoBuffer = buffers[0]
      var primaryAudioBuffer = buffers[1]
      var secondaryVideoBuffer = buffers[2] || primaryVideoBuffer
      var secondaryAudioBuffer = buffers[3] || primaryAudioBuffer
      var mediaSource = new target.MediaSource()
      var state = {
        audioBuffer: null,
        audioDegradeWarned: false,
        audioFallback: null,
        audioFallbackStart: null,
        audioFallbackStarted: false,
        audioFallbackUrls: null,
        audioTrack: null,
        disposed: false,
        failureWarned: false,
        loopDeadlines: Object.create(null),
        mediaSource: mediaSource,
        name: name,
        primaryAudioBuffer: primaryAudioBuffer,
        primaryVideoBuffer: primaryVideoBuffer,
        secondaryAudioBuffer: secondaryAudioBuffer,
        secondaryVideoBuffer: secondaryVideoBuffer,
        video: video,
        videoBuffer: null,
        videoFallbackActive: false,
        videoFallbackEnded: null,
        videoFallbackOnMain: false,
        videoFallbackPlayWarned: false,
        videoFallbackUrls: null,
        videoQuotaFallbackTried: false,
        videoTrack: null,
        playWarning: false,
        volumeSyncTimer: 0,
      }

      state.onSourceOpen = function () {
        mediaSource.removeEventListener('sourceopen', state.onSourceOpen)
        if (state.disposed) return
        try {
          if (!state.primaryVideoBuffer) throw new Error('Primary title video buffer is unavailable')
          state.videoBuffer = mediaSource.addSourceBuffer(VIDEO_TYPE)
          state.videoBuffer.mode = VIDEO_APPEND_MODE
          state.videoTrack = createTrack(state, state.videoBuffer, 'Video')
          if (state.primaryAudioBuffer) {
            if (!state.secondaryAudioBuffer) throw new Error('Secondary title audio buffer is unavailable')
            try {
              var audioMseSupported =
                typeof target.MediaSource === 'function' &&
                typeof target.MediaSource.isTypeSupported === 'function' &&
                target.MediaSource.isTypeSupported(AUDIO_TYPE)
              if (!audioMseSupported) {
                throw new Error(AUDIO_TYPE + ' MSE is not supported; title loop continues video-only')
              }
              state.audioBuffer = mediaSource.addSourceBuffer(AUDIO_TYPE)
              state.audioBuffer.mode = AUDIO_APPEND_MODE
              state.audioTrack = createTrack(state, state.audioBuffer, 'Audio')
            } catch (audioError) {
              warnAudioDegrade(state, audioError)
              createAudioFallback(state)
            }
          }
          begin(state)
        } catch (error) {
          fail(state, error)
        }
      }
      state.onSourceClose = function () {
        if (!state.disposed) fail(state, new Error('Title loop MediaSource closed unexpectedly'))
      }
      mediaSource.addEventListener('sourceopen', state.onSourceOpen)
      mediaSource.addEventListener('sourceclose', state.onSourceClose)
      states[name] = state
      dc.mediaSources[name] = mediaSource
      return mediaSource
    }

    dc.tearDownMediaSourceForLoop = function (name) {
      var key = String(name || '')
      var state = states[key]
      var result = state ? dispose(state, new Error('Title loop was torn down')) : false
      cleanupFallbackEntry(key)
      return result
    }

    dc.__dcTitleLoopQueuePatch = { states: states }
  }

  function runtimeSource() {
    return ';(' + installTitleLoopQueue.toString() + ')(window)'
  }

  function transform(source) {
    var newline = source.indexOf('\r\n') !== -1 ? '\r\n' : '\n'
    return source + newline + runtimeSource() + newline
  }

  DCWeb.DevilConnectionTitleLoopPatch = {
    description: '串行追加标题循环的 MediaSource 视频与音频片段：视频按 segments 模式以片内时间戳串接，并用首帧 PTS 偏移把时间轴对齐到 0 且让循环边界无缝，MP3 音频保持 sequence 无间隙拼接；每次循环追加后回收已播放的头部缓冲，避免 MSE 配额耗尽；WebKitGTK/WPE 未配置 MSE_MAX_BUFFER_SIZE 导致视频轨配额不足时，临时降级为渐进式播放（优先 VFS 路径受管通道，主段播完切循环段）；切换或退出时完整释放运行状态。',
    failure: 'warn-and-continue',
    id: 'devil-connection-title-loop-sourcebuffer-queue',
    name: '标题循环媒体队列兼容',
    required: true,
    signatures: [
      { count: 1, name: '标题循环初始化', text: SETUP_SIGNATURE },
      { count: 2, name: '标题视频循环追加', text: VIDEO_APPEND_SIGNATURE },
      { count: 2, name: '标题音频循环追加', text: AUDIO_APPEND_SIGNATURE },
      { count: 1, name: '标题视频循环定时器', text: VIDEO_TIMER_SIGNATURE },
      { count: 1, name: '标题音频循环定时器', text: AUDIO_TIMER_SIGNATURE },
      { count: 1, name: '标题循环释放', text: TEARDOWN_SIGNATURE },
      { count: 1, name: '标题循环释放轮询', text: TEARDOWN_POLL_SIGNATURE },
      { count: 1, name: '标题媒体 URL 释放', text: REVOKE_SIGNATURE },
      { count: 0, name: '标题循环队列补丁标记', text: PATCH_MARKER },
    ],
    target: 'data/others/plugin/title_loop/main.js',
    transform: transform,
  }
})(window)
