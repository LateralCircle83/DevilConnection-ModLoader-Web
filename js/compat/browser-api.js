;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb

  function install(target, vfs) {
    if (target.api && target.api.__dcBrowserApi) return target.api

    var storage = DCWeb.BrowserSaveStore.create(target)
    var binaryDebug = { pending: 0, completed: 0, failed: 0 }

    function publishBinaryDebug(path, error) {
      var root = target.document && target.document.documentElement
      if (!root) return
      root.setAttribute('data-dc-bin-pending', String(binaryDebug.pending))
      root.setAttribute('data-dc-bin-completed', String(binaryDebug.completed))
      root.setAttribute('data-dc-bin-failed', String(binaryDebug.failed))
      if (path) root.setAttribute('data-dc-bin-last', String(path).slice(-240))
      if (error) {
        root.setAttribute('data-dc-bin-error', String(error.message || error).slice(0, 500))
        root.setAttribute('data-dc-bin-stack', String(error.stack || '').slice(0, 2000))
      }
    }

    publishBinaryDebug('', null)
    target.addEventListener('error', function (event) {
      var root = target.document && target.document.documentElement
      if (!root) return
      root.setAttribute('data-dc-window-error', String(event.message || event.error || 'Unknown error').slice(0, 1000))
      root.setAttribute('data-dc-window-stack', String(event.error && event.error.stack || '').slice(0, 2000))
    })
    target.addEventListener('unhandledrejection', function (event) {
      var root = target.document && target.document.documentElement
      if (!root) return
      var reason = event.reason || 'Unknown promise rejection'
      root.setAttribute('data-dc-promise-error', String(reason.message || reason).slice(0, 1000))
      root.setAttribute('data-dc-promise-stack', String(reason.stack || '').slice(0, 2000))
    })

    var api = {
      __dcBrowserApi: true,
      storage: storage,

      returnProcess: function () {
        return { platform: 'browser', execPath: target.location.href, env: {} }
      },
      returnDirName: function () { return '' },
      returnAppPath: function () { return '' },
      returnSingleInstanceLock: function () { return true },
      returnRelativePath: function (filePath, itemPath) {
        return Promise.resolve(itemPath || filePath || '')
      },

      existFile: function (path) { return storage.getItem('file:' + path) !== null },
      makeDir: function () {},
      writeFile: function (path, value) { storage.setItem('file:' + path, value) },
      writeFileEnc: function (path, value) { storage.setItem('file:' + path, value) },
      readFile: function (path) { return storage.getItem('file:' + path) || '' },
      readFileDec: function (path) { return storage.getItem('file:' + path) || '' },
      readFileBin: function (path) {
        binaryDebug.pending++
        publishBinaryDebug(path, null)
        var blob
        try {
          blob = vfs.getBlob(path)
          if (!blob) throw new Error('ASAR file not found: ' + path)
        } catch (error) {
          binaryDebug.pending--
          binaryDebug.failed++
          publishBinaryDebug(path, error)
          return Promise.reject(error)
        }
        return blob.arrayBuffer().then(function (value) {
          var copy = DCWeb.Runtime.copyArrayBufferToRealm(target, value)
          binaryDebug.pending--
          binaryDebug.completed++
          publishBinaryDebug(path, null)
          return copy
        }).catch(function (error) {
          binaryDebug.pending--
          binaryDebug.failed++
          publishBinaryDebug(path, error)
          throw error
        })
      },
      rm: function (path) { storage.removeItem('file:' + path) },
      unlink: function (path) { storage.removeItem('file:' + path) },

      saveFile: async function (param) {
        var link = target.document.createElement('a')
        link.href = (param && param.dataUrl) || param
        link.download = 'photo.png'
        target.document.body.appendChild(link)
        link.click()
        link.remove()
        return true
      },

      showDialog: async function (option) {
        var text = (option && (option.detail || option.message)) || ''
        if (option && option.buttons && option.buttons.length > 1) {
          return target.confirm(text) ? (option.defaultId || 0) : (option.cancelId || 1)
        }
        target.alert(text)
        return 0
      },

      setFullScreen: async function (enabled) {
        if (!enabled) {
          if (target.document.fullscreenElement && target.document.exitFullscreen) await target.document.exitFullscreen()
          return
        }
        var element = target.document.documentElement
        if (element.requestFullscreen) await element.requestFullscreen()
      },

      quit: async function () { target.parent.postMessage({ type: 'dc-player-quit' }, '*') },
      applyPatch: async function () { return false },
      openWebPage: async function (url) { target.open(url, '_blank', 'noopener') },
      readSubDir: async function () { return [] },
      toggleDevTools: async function () {},
      isMuteAudio: async function (enabled) {
        var media = target.document.querySelectorAll('audio,video')
        for (var index = 0; index < media.length; index++) media[index].muted = Boolean(enabled)
      },
      captureWindow: async function () { return '' },
      registerHotKey: async function () {},
      getSaveKey: function () { return null },
      isAppActivated: async function () { return true },
      activateAchievement: async function () {},
      triggerScreenshot: async function () {},
      log: async function () { target.console.log.apply(target.console, arguments) },
    }

    target.api = api
    target.process = api.returnProcess()
    target.__dirname = ''
    return api
  }

  DCWeb.BrowserApi = { install: install }
})(window)
