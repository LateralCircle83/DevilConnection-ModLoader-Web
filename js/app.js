;(function () {
  'use strict'

  var input = document.getElementById('asar-input')
  var dropButton = document.getElementById('file-drop')
  var loaderView = document.getElementById('loader-view')
  var playerView = document.getElementById('player-view')
  var frame = document.getElementById('game-frame')
  var statusCopy = document.getElementById('mount-status')
  var progressRow = document.getElementById('progress-row')
  var progressFill = document.getElementById('progress-fill')
  var progressLabel = document.getElementById('progress-label')
  var errorDetails = document.getElementById('error-details')
  var errorOutput = document.getElementById('error-output')
  var mountedFile = document.getElementById('mounted-file')
  var closeButton = document.getElementById('close-game')
  var reloadButton = document.getElementById('reload-game')

  var activeArchive = null
  var activeGameHtml = ''
  var busy = false

  function formatBytes(bytes) {
    var units = ['B', 'KB', 'MB', 'GB', 'TB']
    var value = bytes
    var unit = 0
    while (value >= 1000 && unit < units.length - 1) {
      value /= 1000
      unit++
    }
    return value.toFixed(unit > 1 ? 2 : 0) + ' ' + units[unit]
  }

  function setStatus(message, state) {
    statusCopy.textContent = message
    if (state) statusCopy.dataset.state = state
    else delete statusCopy.dataset.state
  }

  function setProgress(value, label) {
    var percentage = Math.max(0, Math.min(100, Math.round(value)))
    progressRow.hidden = false
    progressFill.style.width = percentage + '%'
    progressLabel.textContent = label || percentage + '%'
  }

  function showError(error) {
    var message = error && error.message ? error.message : String(error)
    setStatus(message, 'error')
    errorOutput.textContent = error && error.stack ? error.stack : message
    errorDetails.hidden = false
    errorDetails.open = true
  }

  function clearError() {
    errorDetails.hidden = true
    errorDetails.open = false
    errorOutput.textContent = ''
  }

  function setBusy(value) {
    busy = value
    dropButton.disabled = value
    input.disabled = value
  }

  async function validateGameArchive(archive) {
    var required = [
      'index.html',
      'package.json',
      'tyrano/tyrano.js',
      'tyrano/plugins/kag/kag.js',
      'data/system/Config.tjs',
    ]
    var missing = required.filter(function (path) { return !archive.has(path) })
    if (missing.length) throw new Error('缺少游戏文件：' + missing.join(', '))

    var packageJson
    try {
      packageJson = JSON.parse(await archive.readText('package.json'))
    } catch (error) {
      throw new Error('无法读取游戏 package.json')
    }
    if (packageJson.name !== 'devil-connection') {
      throw new Error('这个 ASAR 不是受支持的 Devil Connection 游戏归档')
    }
    return packageJson
  }

  function inlineScript(doc, source) {
    var script = doc.createElement('script')
    script.textContent = source
    return script
  }

  function rewriteStaticElement(archive, element, attribute) {
    var value = element.getAttribute(attribute)
    if (value && archive.has(value)) element.setAttribute(attribute, archive.getObjectUrl(value))
  }

  async function buildGameHtml(archive) {
    var source = await archive.readText('index.html')
    var doc = new DOMParser().parseFromString(source, 'text/html')
    if (!doc.documentElement || doc.querySelector('parsererror')) {
      throw new Error('游戏 index.html 无法解析')
    }

    var bootstrap = inlineScript(
      doc,
      [
        ';(function () {',
        '  var vfs = parent.__dcActiveArchive',
        '  if (!vfs) throw new Error("ASAR mount is not available")',
        '  parent.DCVfsRuntime.install(window, vfs)',
        '  parent.DCCompat.installBrowserApi(window, vfs)',
        '  window.addEventListener("error", function (event) {',
        '    parent.postMessage({ type: "dc-player-error", message: event.message, stack: event.error && event.error.stack }, "*")',
        '  })',
        '})()',
      ].join('\n'),
    )
    doc.head.insertBefore(bootstrap, doc.head.firstChild)

    var scripts = Array.prototype.slice.call(doc.querySelectorAll('script[src]'))
    scripts.forEach(function (script) {
      var sourcePath = script.getAttribute('src') || ''
      var normalized = window.DCAsar.normalizePath(sourcePath)
      if (normalized === 'electron_latest.js') {
        script.removeAttribute('src')
        script.textContent = 'parent.DCCompat.installTyranoCompat(window, window.__ASAR_VFS__)'
        return
      }
      if (archive.has(sourcePath)) script.setAttribute('src', archive.getObjectUrl(sourcePath))

      if (normalized === 'tyrano/libs/jquery-3.6.0.min.js') {
        script.parentNode.insertBefore(
          inlineScript(doc, 'parent.DCVfsRuntime.installJQuery(window)'),
          script.nextSibling,
        )
      }
    })

    Array.prototype.slice.call(doc.querySelectorAll('link[href]')).forEach(function (link) {
      rewriteStaticElement(archive, link, 'href')
    })
    Array.prototype.slice.call(doc.querySelectorAll('img[src],audio[src],video[src],source[src]')).forEach(function (element) {
      rewriteStaticElement(archive, element, 'src')
    })
    Array.prototype.slice.call(doc.querySelectorAll('video[poster]')).forEach(function (element) {
      rewriteStaticElement(archive, element, 'poster')
    })

    doc.documentElement.setAttribute('data-dc-asar-player', 'true')
    return '<!doctype html>\n' + doc.documentElement.outerHTML
  }

  async function mountFile(file) {
    if (busy || !file) return
    setBusy(true)
    clearError()
    setProgress(4, '读取')
    setStatus('正在读取 ' + file.name + ' · ' + formatBytes(file.size))

    var archive = null
    try {
      archive = await window.DCAsar.AsarArchive.open(file)
      setProgress(18, '校验')
      var packageJson = await validateGameArchive(archive)

      setStatus('正在准备浏览器资源映射')
      await archive.prepareStyles(function (current, total) {
        setProgress(18 + (current / Math.max(total, 1)) * 52, '样式 ' + current + '/' + total)
      })

      setStatus('正在准备浏览器兼容层')
      await archive.prepareBrowserCompat()

      setProgress(78, '入口')
      window.__dcActiveArchive = archive
      var gameHtml = await buildGameHtml(archive)

      if (activeArchive) activeArchive.release()
      activeArchive = archive
      activeGameHtml = gameHtml
      archive = null

      mountedFile.textContent = file.name + ' · ' + packageJson.version
      frame.srcdoc = activeGameHtml
      setProgress(100, '完成')
      loaderView.hidden = true
      playerView.hidden = false
    } catch (error) {
      if (archive) archive.release()
      showError(error)
    } finally {
      setBusy(false)
      input.value = ''
    }
  }

  function closeGame() {
    frame.srcdoc = '<!doctype html><title>Closed</title>'
    playerView.hidden = true
    loaderView.hidden = false
    progressRow.hidden = true
    setStatus('等待选择 app.asar')
    if (activeArchive) activeArchive.release()
    activeArchive = null
    activeGameHtml = ''
    window.__dcActiveArchive = null
  }

  function reloadGame() {
    if (!activeArchive || !activeGameHtml) return
    frame.srcdoc = '<!doctype html><title>Reloading</title>'
    window.setTimeout(function () { frame.srcdoc = activeGameHtml }, 0)
  }

  dropButton.addEventListener('click', function () { if (!busy) input.click() })
  input.addEventListener('change', function () { mountFile(input.files && input.files[0]) })

  ;['dragenter', 'dragover'].forEach(function (type) {
    dropButton.addEventListener(type, function (event) {
      event.preventDefault()
      if (!busy) dropButton.classList.add('is-dragging')
    })
  })
  ;['dragleave', 'drop'].forEach(function (type) {
    dropButton.addEventListener(type, function (event) {
      event.preventDefault()
      dropButton.classList.remove('is-dragging')
    })
  })
  dropButton.addEventListener('drop', function (event) {
    if (!busy) mountFile(event.dataTransfer.files && event.dataTransfer.files[0])
  })

  closeButton.addEventListener('click', closeGame)
  reloadButton.addEventListener('click', reloadGame)
  window.addEventListener('message', function (event) {
    if (event.source !== frame.contentWindow || !event.data) return
    if (event.data.type === 'dc-player-quit') closeGame()
    if (event.data.type === 'dc-player-error') {
      console.error('[Game frame]', event.data.message, event.data.stack || '')
    }
  })
  window.addEventListener('beforeunload', function () {
    if (activeArchive) activeArchive.release()
  })
})()
