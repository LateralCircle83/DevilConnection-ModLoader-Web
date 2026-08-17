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

    dc.loopTimers = dc.loopTimers || {}
    dc.mediaSources = dc.mediaSources || {}

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
          if (state.disposed || !state.audioFallback) return
          syncAudioFallbackVolume(state)
          // 镜像标题视频音量：游戏淡出按 10ms 步进改写 video.volume，
          // 视频循环节拍（约 80s）太慢，需要独立高频采样才能跟随淡出。
          if (!state.volumeSyncTimer) {
            state.volumeSyncTimer = target.setTimeout(function volumeSyncTick() {
              if (state.disposed) {
                state.volumeSyncTimer = 0
                return
              }
              syncAudioFallbackVolume(state)
              state.volumeSyncTimer = target.setTimeout(volumeSyncTick, 50)
            }, 50)
          }
          audio.addEventListener('ended', function () {
            if (state.disposed) return
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

    function dispose(state, reason) {
      if (!state || state.disposed) return false
      state.disposed = true
      var detachedUrl = state.video ? String(state.video.currentSrc || state.video.src || '') : ''
      detachVideo(state)
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
      if (state.volumeSyncTimer) {
        try { target.clearTimeout(state.volumeSyncTimer) } catch (error) {}
        state.volumeSyncTimer = 0
      }

      state.primaryVideoBuffer = null
      state.primaryAudioBuffer = null
      state.secondaryVideoBuffer = null
      state.secondaryAudioBuffer = null
      state.audioFallback = null
      state.audioFallbackStart = null
      state.audioFallbackUrls = null
      state.videoTrack = null
      state.audioTrack = null
      state.videoBuffer = null
      state.audioBuffer = null
      state.loopDeadlines = null
      if (dc.mediaSources[state.name] === state.mediaSource) delete dc.mediaSources[state.name]
      if (states[state.name] === state) delete states[state.name]
      return true
    }

    function fail(state, reason) {
      if (!state || state.disposed) return
      var error = asError(reason)
      warn(state, error)
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
          if (current.beforeAppend) current.beforeAppend(sourceBuffer)
          sourceBuffer.appendBuffer(current.buffer)
        } catch (error) {
          var failedTask = current
          current = null
          rejectTask(failedTask, error)
          fail(state, error)
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
        fail(state, error)
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
      }
    }

    function bufferedEnd(sourceBuffer) {
      var buffered = sourceBuffer.buffered
      return buffered && buffered.length ? buffered.end(buffered.length - 1) : 0
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
      var videoMainEnd = 0
      var loopVideoDuration = 0
      var loopAudioDuration = 0

      var videoReady = state.videoTrack.enqueue(state.primaryVideoBuffer).then(function () {
        videoMainEnd = bufferedEnd(state.videoBuffer)
        return state.videoTrack.enqueue(state.secondaryVideoBuffer, function (sourceBuffer) {
          sourceBuffer.timestampOffset = bufferedEnd(sourceBuffer)
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
            sourceBuffer.timestampOffset = bufferedEnd(sourceBuffer)
          })
        })
        if (state.audioTrack) {
          scheduleLoop(state, 'a', loopAudioDuration, function () {
            return state.audioTrack.enqueue(state.secondaryAudioBuffer, function (sourceBuffer) {
              makeAudioGapless(loopGapless, sourceBuffer)
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
          state.videoBuffer.mode = 'sequence'
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
              state.audioBuffer.mode = 'sequence'
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
      var state = states[String(name || '')]
      return state ? dispose(state, new Error('Title loop was torn down')) : false
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
    description: '串行追加标题循环的 MediaSource 视频与音频片段，并在切换或退出时完整释放运行状态。',
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
