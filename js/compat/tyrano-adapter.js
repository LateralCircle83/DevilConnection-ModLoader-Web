;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb

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

  function createStartOverlay(target, start) {
    var overlay = target.document.createElement('button')
    overlay.type = 'button'
    overlay.id = 'dc-browser-start'
    overlay.innerHTML = '<span>点击开始</span><small>CLICK TO START</small>'
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'gap:10px',
      'width:100%',
      'height:100%',
      'border:0',
      'border-radius:0',
      'color:#fff',
      'background:#111411',
      'font:700 32px/1.2 "Segoe UI","Microsoft YaHei",sans-serif',
      'letter-spacing:0',
      'cursor:pointer',
    ].join(';')
    overlay.querySelector('small').style.cssText = 'font:600 11px/1.2 Consolas,monospace;color:#9fb0a5;letter-spacing:0'
    overlay.addEventListener('click', function () {
      overlay.disabled = true
      overlay.querySelector('span').textContent = '正在启动'
      start().catch(function (error) {
        overlay.disabled = false
        overlay.querySelector('span').textContent = '启动失败，点击重试'
        target.console.error(error)
        target.parent.postMessage({ type: 'dc-player-error', message: error.message, stack: error.stack }, '*')
      })
    })
    target.document.body.appendChild(overlay)
    return overlay
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

  function install(target, vfs) {
    if (target.__dcTyranoCompatInstalled) return
    var $ = target.jQuery
    if (!$ || !target.TYRANO || !target.tyrano || !target.tyrano.plugin.kag) {
      throw new Error('Tyrano runtime was not ready for browser adaptation')
    }

    DCWeb.Runtime.installJQuery(target)
    target.TYRANO.cache_text = true
    target.TYRANO.resource_concurrency = 6
    DCWeb.TyranoSaveAdapter.install(target, $, vfs)
    installKagAdapters(target, $, vfs)

    var originalInit = target.TYRANO.init
    var started = false
    target.TYRANO.init = function () {
      if (started || target.document.getElementById('dc-browser-start')) return
      createStartOverlay(target, async function () {
        if (started) return
        started = true
        unlockAudio(target, vfs)
        try {
          target.TYRANO.kag.readyAudio()
          target.TYRANO.kag.tmp.ready_audio = true
        } catch (error) {}
        await target.api.storage.ready
        var overlay = target.document.getElementById('dc-browser-start')
        if (overlay) overlay.remove()
        originalInit.call(target.TYRANO)
      })
    }

    target.__dcTyranoCompatInstalled = true
    installTelemetry(target)
  }

  DCWeb.TyranoAdapter = { install: install }
})(window)
