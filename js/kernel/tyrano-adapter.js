;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb

  function installPreloadScheduler(target, kag) {
    if (!DCWeb.TyranoPreloadScheduler || typeof kag.preload !== 'function') return null
    var originalPreload = kag.preload
    var readiness = DCWeb.ResourceReadiness ? DCWeb.ResourceReadiness.forTarget(target) : null
    var scheduler = new DCWeb.TyranoPreloadScheduler(target, function (storage, callback, options) {
      return originalPreload.call(kag, storage, function (element) {
        if (!readiness) {
          callback(element)
          return
        }
        readiness.waitForPreload(element, storage).then(function () { callback(element) })
      }, options)
    })

    kag.preload = function (storage, callback, options) {
      return scheduler.preload(storage, callback, options)
    }
    kag.preloadAll = function (storage, callback, options) {
      return scheduler.preload(storage, callback, options)
    }
    if (typeof kag.registerPreloadCompleteCallback === 'function') {
      kag.registerPreloadCompleteCallback = function (callback) {
        scheduler.whenIdle(callback)
      }
    }
    if (typeof target.addEventListener === 'function') {
      target.addEventListener('pagehide', function () { scheduler.cancel() }, { once: true })
    }
    return scheduler
  }

  function imageStorage($, pm) {
    if (!pm || !pm.storage) return ''
    var storage = String(pm.storage)
    if ((typeof $.isHTTP === 'function' && $.isHTTP(storage)) || /^[a-z]+:/i.test(storage)) return storage
    var folder = pm.folder || (pm.layer === 'base' ? 'bgimage' : 'fgimage')
    return './data/' + folder + '/' + storage
  }

  function installImageReadiness($, kag) {
    var masterTag = kag.ftag && kag.ftag.master_tag && kag.ftag.master_tag.image
    var sourceTag = kag.tag && kag.tag.image
    var imageTag = masterTag || sourceTag
    if (!imageTag || typeof imageTag.start !== 'function') return
    var originalStart = imageTag.start
    if (originalStart.__dcImageReadiness || /\bkag\.preload\s*\(/.test(String(originalStart))) return

    function start(pm) {
      var tag = this
      var storage = imageStorage($, pm)
      if (!storage || !tag.kag || typeof tag.kag.preload !== 'function') return originalStart.call(tag, pm)
      tag.kag.preload(storage, function () { originalStart.call(tag, pm) })
    }
    start.__dcImageReadiness = true
    imageTag.start = start
    if (masterTag && sourceTag && sourceTag !== masterTag && sourceTag.start === originalStart) sourceTag.start = start
  }

  function installKagAdapters(target, $, vfs) {
    var kag = target.tyrano.plugin.kag

    kag.init = function () {
      this.kag = this
      var that = this
      this.tyrano.test()
      this.parser.loadConfig(function (mapConfig) {
        that.config = $.extend(true, that.config, mapConfig)
        that.config.configSave = 'webstorage'
        that.checkUpdate(function () { that.init_game() })
      })

      $('script').each(function () {
        var src = $(this).attr('src')
        if (src && (src.indexOf('cordova') !== -1 || src.indexOf('phonegap') !== -1)) {
          that.define.FLAG_APRI = true
        }
      })

      this.tmp.ready_audio = true
      var AudioContext = target.AudioContext || target.webkitAudioContext
      if (AudioContext) this.tmp.audio_context = new AudioContext()
      try { $.getBrowser() } catch (error) { target.console.log(error) }
    }

    kag.checkUpdate = function (callback) { callback() }
    kag.applyPatch = function (patchPath, reload, callback) {
      if (typeof callback === 'function') callback()
    }

    kag.tag.web = {
      vital: ['url'],
      pm: { url: '' },
      start: function (pm) {
        target.open(pm.url, '_blank', 'noopener')
        this.kag.ftag.nextOrder()
      },
    }
    kag.ftag.master_tag.web = kag.tag.web
    kag.ftag.master_tag.web.kag = kag

    kag.tag.close = {
      pm: { ask: 'true' },
      start: function (pm) {
        var tag = this
        if (pm.ask === 'true') {
          $.confirm($.lang('exit_game'), function () { tag.close() }, function () { tag.kag.ftag.nextOrder() })
        } else tag.close()
      },
      close: function () { target.api.quit() },
    }
    kag.ftag.master_tag.close = kag.tag.close
    kag.ftag.master_tag.close.kag = kag

    kag.tag.check_web_patch = {
      vital: ['url'],
      pm: { url: '', reload: 'false' },
      start: function () { this.kag.ftag.nextOrder() },
    }
    kag.ftag.master_tag.check_web_patch = kag.tag.check_web_patch
    kag.ftag.master_tag.check_web_patch.kag = kag

    $.isElectron = function () { return false }
    $.getExePath = function () { return '' }
    $.loadText = function (path, callback) {
      vfs.readText(path).then(callback).catch(function (error) {
        target.console.error(error)
        callback('')
      })
    }
    $.saveFile = async function (dataUrl) {
      try {
        await target.api.saveFile({ dataUrl: dataUrl })
        $.alert($.lang('photo_saved'))
      } catch (error) {
        target.console.error(error)
        $.alert($.lang('photo_save_failed'))
      }
    }
    $.enableCloseConfirm = function () {
      target.onbeforeunload = function () { return $.lang('confirm_beforeunload') }
    }
  }

  function unlockAudio(target, vfs) {
    try {
      var silentPath = 'tyrano/audio/silent.mp3'
      if (vfs.has(silentPath)) {
        var audio = new target.Audio(vfs.getObjectUrl(silentPath))
        audio.volume = 0.01
        audio.play().catch(function () {})
      }
    } catch (error) {}
    try {
      if (target.Howler && target.Howler.ctx && target.Howler.ctx.state === 'suspended') {
        target.Howler.ctx.resume().catch(function () {})
      }
    } catch (error) {}
  }

  function installTelemetry(target) {
    target.setInterval(function () {
      var root = target.document && target.document.documentElement
      var kag = target.TYRANO && target.TYRANO.kag
      if (!root || !kag) return
      if (kag.stat) root.setAttribute('data-dc-scenario', String(kag.stat.current_scenario || ''))
      if (kag.ftag) {
        root.setAttribute('data-dc-order', String(kag.ftag.current_order_index))
        var tag = kag.ftag.array_tag && kag.ftag.array_tag[kag.ftag.current_order_index]
        if (tag) root.setAttribute('data-dc-tag', String(tag.name || ''))
      }
      if (kag.waapi) {
        try {
          root.setAttribute('data-dc-bgm-loading', String(Boolean(kag.waapi.bgm && kag.waapi.bgm.isLoading())))
          root.setAttribute('data-dc-se-loading', String(Boolean(kag.waapi.se && kag.waapi.se.isLoading())))
        } catch (error) {}
      }
      if (kag.dc && kag.dc.loopBuffers) {
        root.setAttribute('data-dc-loop-buffers', String(Object.keys(kag.dc.loopBuffers).length))
      }
      if (target.context && target.context.state) {
        root.setAttribute('data-dc-audio-state', String(target.context.state))
      }
    }, 250)
  }

  function install(target, vfs, launchId, launchToken) {
    if (target.__dcTyranoCompatInstalled) return
    var $ = target.jQuery
    if (!$ || !target.TYRANO || !target.tyrano || !target.tyrano.plugin.kag) {
      throw new Error('Tyrano runtime was not ready for browser adaptation')
    }
    var kag = target.tyrano.plugin.kag

    DCWeb.Runtime.installJQuery(target, vfs)
    target.TYRANO.cache_text = true
    target.TYRANO.resource_concurrency = 4
    DCWeb.TyranoSaveAdapter.install(target, $, vfs)
    installKagAdapters(target, $, vfs)
    installPreloadScheduler(target, kag)
    installImageReadiness($, kag)

    var root = target.document && target.document.documentElement
    if (root) root.setAttribute('data-dc-launch-id', String(launchId))

    var originalInit = target.TYRANO.init
    var started = false
    var startPromise = null
    var readyPosted = false
    var readyPromise = null
    var modRuntimeReady = target.__dcModRuntimeReady || Promise.resolve()
    var storageReady = Promise.resolve(target.api.storage.ready).catch(function (error) {
      target.console.warn('Browser storage initialization failed; continuing with fallback storage', error)
    })
    var prerequisitesReady = Promise.all([storageReady, modRuntimeReady])

    function publishStartError(error) {
      target.console.error(error)
      target.parent.postMessage({
        type: 'dc-player-error',
        launchToken: launchToken,
        message: error.message,
        stack: error.stack,
      }, '*')
      throw error
    }

    function startGame() {
      if (started) return startPromise
      if (!readyPosted) return Promise.reject(new Error('Game start requested before launch prerequisites were ready'))
      started = true
      if (root) root.setAttribute('data-dc-start-gate', 'starting')
      unlockAudio(target, vfs)
      try {
        target.TYRANO.kag.readyAudio()
        target.TYRANO.kag.tmp.ready_audio = true
      } catch (error) {}
      target.parent.postMessage({ type: 'dc-player-started', launchId: launchId, launchToken: launchToken }, '*')
      if (root) {
        var activation = target.navigator && target.navigator.userActivation
        root.setAttribute('data-dc-start-path', 'host-bridge')
        root.setAttribute('data-dc-start-user-active', String(Boolean(activation && activation.isActive)))
        root.setAttribute('data-dc-start-user-has-been-active', String(Boolean(activation && activation.hasBeenActive)))
        root.setAttribute('data-dc-start-gate', 'started')
      }
      try {
        startPromise = Promise.resolve(originalInit.call(target.TYRANO)).catch(publishStartError)
      } catch (error) {
        startPromise = Promise.reject(error).catch(publishStartError)
      }
      return startPromise
    }

    target.__dcStartGame = startGame
    target.TYRANO.init = function () {
      if (started) return startPromise
      if (readyPromise) return readyPromise
      readyPromise = prerequisitesReady.then(function () {
        if (started || readyPosted) return null
        readyPosted = true
        if (root) root.setAttribute('data-dc-start-gate', 'ready')
        target.parent.postMessage({ type: 'dc-player-ready', launchId: launchId, launchToken: launchToken }, '*')
        return null
      })
      return readyPromise
    }

    target.__dcTyranoCompatInstalled = true
    installTelemetry(target)
  }

  DCWeb.TyranoAdapter = { install: install }
})(window)
