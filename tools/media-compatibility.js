;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var VIDEO_EXTENSIONS = /\.(?:m4v|mp4|ogv|webm)$/i
  var FALLBACK_EXTENSIONS = /\.(?:m4v|mp4)$/i
  var PROBE_TIMEOUT_MS = 20000
  var RELEASE_DELAY_MS = 120

  var elements = {}
  var state = {
    activeProbeCancel: null,
    exportReport: null,
    records: [],
    resolver: null,
    running: false,
    stopRequested: false,
  }

  function byId(id) {
    return document.getElementById(id)
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0
    if (value >= 1024 * 1024) return (value / (1024 * 1024)).toFixed(2) + ' MiB'
    if (value >= 1024) return (value / 1024).toFixed(1) + ' KiB'
    return value + ' B'
  }

  function errorText(error) {
    if (!error) return ''
    return String(error.message || error.name || error).slice(0, 300)
  }

  function delay(milliseconds) {
    return new Promise(function (resolve) { setTimeout(resolve, milliseconds) })
  }

  function setText(element, value) {
    element.textContent = value
  }

  function setStatus(message) {
    setText(elements.runStatus, message)
  }

  function releaseResolver() {
    if (state.resolver) state.resolver.release()
    state.resolver = null
    setText(elements.releaseState, '临时 URL：0')
  }

  function resetProbeVideo() {
    var video = elements.video
    try { video.pause() } catch (error) {}
    video.removeAttribute('src')
    try { video.load() } catch (error) {}
  }

  function summarizeMediaError(video) {
    var mediaError = video.error
    return {
      code: mediaError ? Number(mediaError.code) || 0 : 0,
      message: mediaError ? String(mediaError.message || '') : '',
      networkState: Number(video.networkState) || 0,
      readyState: Number(video.readyState) || 0,
    }
  }

  function probeSource(url) {
    return new Promise(function (resolve) {
      var video = elements.video
      var settled = false
      var timer = 0
      var metadataAt = 0
      var playRejection = ''

      function removeListeners() {
        video.removeEventListener('error', onError)
        video.removeEventListener('loadeddata', onLoadedData)
        video.removeEventListener('loadedmetadata', onLoadedMetadata)
      }

      function finish(result) {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        removeListeners()
        state.activeProbeCancel = null
        var media = summarizeMediaError(video)
        var duration = Number.isFinite(video.duration) ? video.duration : 0
        var height = Number(video.videoHeight) || 0
        var width = Number(video.videoWidth) || 0
        resetProbeVideo()
        resolve({
          code: media.code,
          duration: duration,
          elapsedMs: Math.round(performance.now() - startedAt),
          height: height,
          message: result.message || media.message || playRejection,
          networkState: media.networkState,
          ok: Boolean(result.ok),
          readyState: media.readyState,
          stage: result.stage,
          width: width,
        })
      }

      function onLoadedMetadata() {
        metadataAt = performance.now()
      }

      function onLoadedData() {
        finish({ ok: true, stage: 'loadeddata' })
      }

      function onError() {
        finish({ ok: false, stage: metadataAt ? 'decode-error' : 'demux-error' })
      }

      var startedAt = performance.now()
      state.activeProbeCancel = function (message) {
        finish({ message: message || '测试已停止', ok: false, stage: 'cancelled' })
      }
      video.addEventListener('error', onError)
      video.addEventListener('loadeddata', onLoadedData)
      video.addEventListener('loadedmetadata', onLoadedMetadata)
      video.muted = true
      video.defaultMuted = true
      video.playsInline = true
      video.loop = true
      video.preload = 'auto'
      video.src = url
      try { video.load() } catch (error) {}
      try {
        var playResult = video.play()
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch(function (error) {
            playRejection = errorText(error)
            if (error && error.name === 'NotSupportedError' && video.error) onError()
          })
        }
      } catch (error) {
        playRejection = errorText(error)
      }
      timer = setTimeout(function () {
        finish({ message: playRejection || '等待首帧超时', ok: false, stage: metadataAt ? 'frame-timeout' : 'metadata-timeout' })
      }, PROBE_TIMEOUT_MS)
    })
  }

  function renderCell(cell, stateName, primary, detail) {
    cell.className = stateName ? 'state-' + stateName : ''
    cell.replaceChildren()
    var strong = document.createElement('span')
    strong.className = 'cell-primary'
    strong.textContent = primary
    cell.appendChild(strong)
    if (detail) {
      var small = document.createElement('span')
      small.className = 'cell-detail'
      small.textContent = detail
      cell.appendChild(small)
    }
  }

  function createRecordRow(record) {
    var row = document.createElement('tr')
    var pathCell = document.createElement('td')
    pathCell.className = 'resource-path'
    pathCell.textContent = record.path
    var layerCell = document.createElement('td')
    layerCell.textContent = record.layerId
    var sizeCell = document.createElement('td')
    sizeCell.textContent = formatBytes(record.size)
    if (record.size > DCWeb.MediaSourceFallback.MAX_BYTES) {
      var limit = document.createElement('span')
      limit.className = 'cell-detail'
      limit.textContent = '超过 MSE 上限'
      sizeCell.appendChild(limit)
    }
    var directCell = document.createElement('td')
    var fallbackCell = document.createElement('td')
    var finalCell = document.createElement('td')
    renderCell(directCell, '', '待测试', '')
    renderCell(fallbackCell, '', '待测试', '')
    renderCell(finalCell, '', '待测试', '')
    ;[pathCell, layerCell, sizeCell, directCell, fallbackCell, finalCell].forEach(function (cell) { row.appendChild(cell) })
    elements.resultsBody.appendChild(row)
    record.cells = { direct: directCell, fallback: fallbackCell, final: finalCell }
    record.row = row
  }

  function updateSummary() {
    var direct = state.records.filter(function (record) { return record.finalState === 'pass' }).length
    var recovered = state.records.filter(function (record) { return record.finalState === 'recovered' }).length
    var failed = state.records.filter(function (record) { return record.finalState === 'failed' }).length
    var finished = direct + recovered + failed
    setText(elements.metricTotal, state.records.length)
    setText(elements.metricDirect, direct)
    setText(elements.metricRecovered, recovered)
    setText(elements.metricFailed, failed)
    setText(elements.metricPending, Math.max(0, state.records.length - finished))
    setText(elements.runProgress, finished + ' / ' + state.records.length)
    elements.progress.max = Math.max(1, state.records.length)
    elements.progress.value = finished
  }

  function updateCurrent(record, stage) {
    setText(elements.currentPath, record ? record.path : '尚未开始')
    setText(elements.currentLayer, record ? record.layerId : '-')
    setText(elements.currentSize, record ? formatBytes(record.size) : '-')
    setText(elements.currentStage, stage || '-')
  }

  function directDetail(result) {
    if (!result) return ''
    var dimensions = result.width && result.height ? result.width + 'x' + result.height : ''
    var timing = result.elapsedMs + ' ms'
    return [dimensions, timing, result.message].filter(Boolean).join(' / ')
  }

  async function testFallback(record) {
    if (!FALLBACK_EXTENSIONS.test(record.path)) {
      return { detail: '当前回退仅处理 MP4/M4V', ok: false, state: 'not-applicable' }
    }

    var mseDetail = ''
    if (record.size <= DCWeb.MediaSourceFallback.MAX_BYTES) {
      updateCurrent(record, '建立 MediaSource')
      var handle
      try {
        handle = await state.resolver.createMediaSourceObjectUrl(record.path, DCWeb.MediaSourceFallback.MAX_BYTES)
      } catch (error) {
        mseDetail = 'MSE 创建失败：' + errorText(error)
      }
      if (handle) {
        setText(elements.releaseState, '临时 URL：1')
        var retryPromise = probeSource(handle.url)
        var buffered = await handle.ready
        if (!buffered.ok && state.activeProbeCancel) state.activeProbeCancel(buffered.error || buffered.state)
        var retry = await retryPromise
        handle.release()
        setText(elements.releaseState, '临时 URL：0')
        mseDetail = [handle.mimeType, buffered.error || buffered.state, directDetail(retry)].filter(Boolean).join(' / ')
        if (buffered.ok && retry.ok) return { detail: mseDetail, mode: 'mse', ok: true, state: 'recovered' }
        if (retry.stage === 'cancelled') return { detail: mseDetail, mode: 'mse', ok: false, state: 'cancelled' }
      } else if (!mseDetail) mseDetail = 'MSE：非 fMP4、codec 不支持或不可用'
    } else mseDetail = 'MSE：' + formatBytes(record.size) + ' > ' + formatBytes(DCWeb.MediaSourceFallback.MAX_BYTES)

    updateCurrent(record, '建立仅画面表示')
    var visualHandle
    try {
      visualHandle = await state.resolver.createVisualOnlyMediaObjectUrl(record.path)
    } catch (error) {
      return { detail: [mseDetail, '仅画面创建失败：' + errorText(error)].filter(Boolean).join(' / '), ok: false, state: 'create-error' }
    }
    if (!visualHandle) {
      return { detail: [mseDetail, '不是可降级的 progressive H.264/AAC MP4'].filter(Boolean).join(' / '), ok: false, state: 'unavailable' }
    }
    console.warn(
      '[DC media] Diagnostic visual-only recovery dropped AAC audio: ' + record.path +
      ' (layer: ' + (visualHandle.sourceLayerId || record.layerId) +
      ', codecs: ' + visualHandle.videoCodec + ', ' + visualHandle.audioCodec + ')',
    )
    setText(elements.releaseState, '临时 URL：1')
    var visualRetry
    try {
      visualRetry = await probeSource(visualHandle.url)
    } finally {
      visualHandle.release()
    }
    setText(elements.releaseState, '临时 URL：0')
    return {
      detail: [mseDetail, 'visual-only', visualHandle.videoCodec, visualHandle.audioCodec, directDetail(visualRetry)].filter(Boolean).join(' / '),
      mode: 'visual-only',
      ok: Boolean(visualRetry.ok),
      state: visualRetry.ok ? 'visual-only-recovered' : 'failed',
    }
  }

  async function testRecord(record) {
    record.row.className = 'row-running'
    updateCurrent(record, 'Blob 首帧')
    renderCell(record.cells.direct, '', '测试中', '')
    renderCell(record.cells.fallback, '', '等待', '')
    renderCell(record.cells.final, '', '测试中', '')

    var blob = state.resolver.getBlob(record.path)
    var directUrl = URL.createObjectURL(blob)
    var direct
    setText(elements.releaseState, '临时 URL：1')
    try {
      direct = await probeSource(directUrl)
    } finally {
      URL.revokeObjectURL(directUrl)
      setText(elements.releaseState, '临时 URL：0')
    }
    record.direct = direct

    if (direct.stage === 'cancelled' && state.stopRequested) {
      renderCell(record.cells.direct, '', '已停止', direct.message)
      renderCell(record.cells.fallback, '', '未执行', '')
      renderCell(record.cells.final, '', '未完成', '')
      record.row.className = ''
      return
    }

    if (direct.ok) {
      renderCell(record.cells.direct, 'pass', '首帧成功', directDetail(direct))
      renderCell(record.cells.fallback, '', '无需回退', '')
      renderCell(record.cells.final, 'pass', '通过', record.profileApplied ? '已使用兼容 Profile' : '')
      record.finalState = 'pass'
      record.row.className = 'row-pass'
      return
    }

    renderCell(record.cells.direct, 'failed', '失败' + (direct.code ? ' / code ' + direct.code : ''), direct.stage + (direct.message ? ' / ' + direct.message : ''))
    if (direct.code !== 4) {
      renderCell(record.cells.fallback, '', '未触发', '运行时只在 MEDIA_ERR_SRC_NOT_SUPPORTED 后回退')
      renderCell(record.cells.final, 'failed', '未覆盖', '错误码 ' + (direct.code || 0))
      record.finalState = 'failed'
      record.fallback = { detail: '', ok: false, state: 'not-triggered' }
      record.row.className = 'row-failed'
      return
    }

    renderCell(record.cells.fallback, '', '准备中', '')
    var fallback = await testFallback(record)
    record.fallback = fallback
    if (fallback.ok) {
      renderCell(record.cells.fallback, 'recovered', '恢复成功', fallback.detail)
      renderCell(record.cells.final, 'recovered', '回退恢复', '')
      record.finalState = 'recovered'
      record.row.className = 'row-recovered'
    } else {
      renderCell(record.cells.fallback, 'failed', '不可恢复', fallback.state + (fallback.detail ? ' / ' + fallback.detail : ''))
      renderCell(record.cells.final, 'failed', '未覆盖', fallback.state)
      record.finalState = 'failed'
      record.row.className = 'row-failed'
    }
  }

  function recordPriority(record) {
    if (/\/title_intro\.mp4$/i.test(record.path)) return 0
    if (/\/kiri2\.mp4$/i.test(record.path)) return 1
    if (/\/effect\.mp4$/i.test(record.path)) return 2
    if (record.size > DCWeb.MediaSourceFallback.MAX_BYTES) return 3
    return 10
  }

  function buildRecords(resolver, profileAppliedTargets) {
    return resolver.list('').filter(function (path) {
      return VIDEO_EXTENSIONS.test(path)
    }).map(function (path) {
      var resolved = resolver.resolve(path)
      var blob = resolver.getBlob(path)
      return {
        cells: null,
        direct: null,
        fallback: null,
        finalState: '',
        layerId: resolved.layerId,
        path: path,
        profileApplied: Boolean(profileAppliedTargets[path.toLowerCase()]),
        row: null,
        size: blob.size,
      }
    }).sort(function (left, right) {
      var priority = recordPriority(left) - recordPriority(right)
      if (priority) return priority
      return right.size - left.size || left.path.localeCompare(right.path)
    })
  }

  async function prepareResolver() {
    var coreFile = elements.coreFile.files[0]
    if (!coreFile) throw new Error('请选择游戏本体 app.asar')
    setStatus('正在读取 ASAR 索引')
    var core = await DCWeb.AsarArchive.open(coreFile)
    var layers = [{ id: 'base-game', kind: 'base', source: core }]
    var modFiles = Array.from(elements.modFiles.files || [])
    for (var index = 0; index < modFiles.length; index++) {
      layers.push({ id: 'mod-' + (index + 1), kind: 'mod', source: await DCWeb.AsarArchive.open(modFiles[index]) })
    }
    var resolver = new DCWeb.AssetResolver(new DCWeb.LayeredVfs(layers))
    var profileAppliedTargets = Object.create(null)
    var patches = [DCWeb.DevilConnectionKiriVideoPatch, DCWeb.DevilConnectionEffectVideoPatch].filter(function (patch) {
      return patch && resolver.has(patch.target)
    })
    if (patches.length) {
      try {
        var report = await DCWeb.ProfileRunner.run({ id: 'media-diagnostic', name: '媒体诊断', patches: patches }, resolver)
        report.patches.forEach(function (patchState, index) {
          if (patchState.status === 'applied') profileAppliedTargets[patches[index].target.toLowerCase()] = true
        })
        var delegated = report.patches.filter(function (patchState) { return patchState.status === 'delegated' }).length
        setText(
          elements.profileStatus,
          'Profile：已应用 ' + Object.keys(profileAppliedTargets).length + ' / ' + patches.length +
          (delegated ? '，交由运行时 ' + delegated : ''),
        )
      } catch (error) {
        var stateRecord = error.compatibility && error.compatibility.patches && error.compatibility.patches.find(function (item) {
          return item.status === 'failed' || item.status === 'unsupported'
        })
        setText(elements.profileStatus, 'Profile：' + (stateRecord ? stateRecord.status : 'failed'))
      }
    } else setText(elements.profileStatus, 'Profile：目标不存在')
    return { profileAppliedTargets: profileAppliedTargets, resolver: resolver }
  }

  function reportForExport(status) {
    return {
      generatedAt: new Date().toISOString(),
      mediaSourceAvailable: typeof global.MediaSource === 'function',
      mediaSourceLimitBytes: DCWeb.MediaSourceFallback.MAX_BYTES,
      records: state.records.map(function (record) {
        return {
          direct: record.direct,
          fallback: record.fallback,
          finalState: record.finalState || 'not-tested',
          layerId: record.layerId,
          path: record.path,
          profileApplied: record.profileApplied,
          size: record.size,
        }
      }),
      status: status,
      userAgent: navigator.userAgent,
    }
  }

  function buildSelfTestAsar(resources) {
    var root = { files: {} }
    var offset = 0
    resources.forEach(function (resource) {
      var parts = resource.path.split('/')
      var branch = root
      parts.forEach(function (part, index) {
        if (index === parts.length - 1) {
          branch.files[part] = { offset: String(offset), size: resource.bytes.byteLength }
          offset += resource.bytes.byteLength
          return
        }
        if (!branch.files[part]) branch.files[part] = { files: {} }
        branch = branch.files[part]
      })
    })

    var json = new TextEncoder().encode(JSON.stringify(root))
    var alignedJsonSize = json.byteLength + ((4 - (json.byteLength % 4)) % 4)
    var dataOffset = 16 + alignedJsonSize
    var header = new Uint8Array(dataOffset)
    var view = new DataView(header.buffer)
    view.setUint32(0, 4, true)
    view.setUint32(4, dataOffset - 8, true)
    view.setUint32(8, dataOffset - 12, true)
    view.setUint32(12, json.byteLength, true)
    header.set(json, 16)
    return new File(
      [header].concat(resources.map(function (resource) { return resource.bytes })),
      'media-compatibility-selftest.asar',
      { type: 'application/octet-stream' },
    )
  }

  async function createSelfTestVideo() {
    var mimeType = ['video/webm;codecs=vp8', 'video/webm'].find(function (type) {
      return global.MediaRecorder && global.MediaRecorder.isTypeSupported(type)
    })
    if (!mimeType) throw new Error('当前浏览器无法生成 WebM 自检视频')
    var canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    var context = canvas.getContext('2d')
    var stream = canvas.captureStream(12)
    var recorder = new MediaRecorder(stream, { mimeType: mimeType })
    var chunks = []
    recorder.addEventListener('dataavailable', function (event) {
      if (event.data.size) chunks.push(event.data)
    })
    var stopped = new Promise(function (resolve) { recorder.addEventListener('stop', resolve, { once: true }) })
    recorder.start()
    for (var frame = 0; frame < 8; frame++) {
      context.fillStyle = frame % 2 ? '#18604b' : '#d59b2d'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await delay(60)
    }
    recorder.stop()
    await stopped
    stream.getTracks().forEach(function (track) { track.stop() })
    return new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer())
  }

  async function runSelfTestIfRequested() {
    if (!new URLSearchParams(global.location.search).has('selftest')) return
    setStatus('正在准备内存自检')
    try {
      var videoBytes = await createSelfTestVideo()
      var fixture = buildSelfTestAsar([
        { bytes: videoBytes, path: 'data/video/selftest.webm' },
        { bytes: new Uint8Array([0, 0, 0, 8, 0x62, 0x61, 0x64, 0x21]), path: 'data/video/selftest-invalid.mp4' },
      ])
      var transfer = new DataTransfer()
      transfer.items.add(fixture)
      elements.coreFile.files = transfer.files
      elements.coreFile.dispatchEvent(new Event('change', { bubbles: true }))
      await runTest()
    } catch (error) {
      setStatus('自检失败：' + errorText(error))
    }
  }

  async function runTest() {
    if (state.running) return
    state.running = true
    state.stopRequested = false
    state.exportReport = null
    elements.start.disabled = true
    elements.stop.disabled = false
    elements.export.disabled = true
    elements.resultsBody.replaceChildren()
    resetProbeVideo()
    releaseResolver()
    updateCurrent(null, '-')

    try {
      var prepared = await prepareResolver()
      state.resolver = prepared.resolver
      state.records = buildRecords(state.resolver, prepared.profileAppliedTargets)
      if (!state.records.length) throw new Error('最终资源视图中没有可测试的视频')
      state.records.forEach(createRecordRow)
      updateSummary()
      setStatus('正在测试')

      for (var index = 0; index < state.records.length; index++) {
        if (state.stopRequested) break
        await testRecord(state.records[index])
        updateSummary()
        if (!state.stopRequested) await delay(RELEASE_DELAY_MS)
      }

      var completed = state.records.filter(function (record) { return record.finalState }).length
      var runState = state.stopRequested ? 'stopped' : 'complete'
      setStatus(state.stopRequested ? '测试已停止' : '测试完成')
      state.exportReport = reportForExport(runState)
      elements.export.disabled = completed === 0
    } catch (error) {
      setStatus('测试失败：' + errorText(error))
      state.exportReport = reportForExport('error')
      elements.export.disabled = state.records.length === 0
    } finally {
      state.running = false
      state.activeProbeCancel = null
      elements.stop.disabled = true
      elements.start.disabled = !elements.coreFile.files[0]
      resetProbeVideo()
      setText(elements.releaseState, '临时 URL：0')
    }
  }

  function stopTest() {
    if (!state.running) return
    state.stopRequested = true
    setStatus('正在停止')
    if (state.activeProbeCancel) state.activeProbeCancel('用户停止测试')
  }

  function exportResults() {
    if (!state.exportReport) return
    var blob = new Blob([JSON.stringify(state.exportReport, null, 2)], { type: 'application/json;charset=utf-8' })
    var url = URL.createObjectURL(blob)
    var link = document.createElement('a')
    link.href = url
    link.download = 'dc-media-compatibility-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(function () { URL.revokeObjectURL(url) }, 0)
  }

  function bindElements() {
    elements = {
      coreFile: byId('core-file'),
      currentLayer: byId('current-layer'),
      currentPath: byId('current-path'),
      currentSize: byId('current-size'),
      currentStage: byId('current-stage'),
      environment: byId('environment'),
      export: byId('export-results'),
      metricDirect: byId('metric-direct'),
      metricFailed: byId('metric-failed'),
      metricPending: byId('metric-pending'),
      metricRecovered: byId('metric-recovered'),
      metricTotal: byId('metric-total'),
      modFiles: byId('mod-files'),
      profileStatus: byId('profile-status'),
      progress: byId('progress'),
      releaseState: byId('release-state'),
      resultsBody: byId('results-body'),
      runProgress: byId('run-progress'),
      runStatus: byId('run-status'),
      start: byId('start-test'),
      stop: byId('stop-test'),
      video: byId('probe-video'),
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindElements()
    setText(elements.environment, navigator.userAgent)
    elements.coreFile.addEventListener('change', function () {
      elements.start.disabled = state.running || !elements.coreFile.files[0]
      if (elements.coreFile.files[0]) setStatus('已选择游戏本体')
    })
    elements.start.addEventListener('click', runTest)
    elements.stop.addEventListener('click', stopTest)
    elements.export.addEventListener('click', exportResults)
    global.addEventListener('pagehide', function () {
      state.stopRequested = true
      if (state.activeProbeCancel) state.activeProbeCancel('页面退出')
      resetProbeVideo()
      releaseResolver()
    })
    runSelfTestIfRequested()
  })
})(window)
