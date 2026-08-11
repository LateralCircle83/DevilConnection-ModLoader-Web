;(function (global) {
  'use strict'

  function createStorage(target) {
    var DB_NAME = 'devil_connection_web_shell'
    var STORE_NAME = 'saves'
    var VERSION = 1
    var LOCAL_PREFIX = 'dc-shell:'

    function reportStorageError(error) {
      var message = String(error && error.message || error || 'Unknown storage error')
      target.console.error('[DC storage]', error)
      var root = target.document && target.document.documentElement
      if (root) root.setAttribute('data-dc-storage-error', message.slice(0, 500))
      try {
        target.dispatchEvent(new target.CustomEvent('dc-storage-error', { detail: { message: message } }))
      } catch (dispatchError) {}
    }

    function safeLocalGet(key) {
      try { return target.localStorage.getItem(LOCAL_PREFIX + key) } catch (error) { return null }
    }

    function safeLocalSet(key, value) {
      try { target.localStorage.setItem(LOCAL_PREFIX + key, value) } catch (error) {}
    }

    function safeLocalRemove(key) {
      try { target.localStorage.removeItem(LOCAL_PREFIX + key) } catch (error) {}
    }

    function readLocalEntries() {
      var entries = {}
      try {
        for (var index = 0; index < target.localStorage.length; index++) {
          var storageKey = target.localStorage.key(index)
          if (!storageKey || storageKey.indexOf(LOCAL_PREFIX) !== 0) continue
          var key = storageKey.slice(LOCAL_PREFIX.length)
          var value = target.localStorage.getItem(storageKey)
          if (value !== null) entries[key] = value
        }
      } catch (error) {}
      return entries
    }

    function clearLocalEntries(entries) {
      Object.keys(entries || readLocalEntries()).forEach(safeLocalRemove)
    }

    var storage = {
      cache: {},
      pending: {},
      db: null,
      ready: null,
      flushTimer: null,
      useIndexedDB: Boolean(target.indexedDB),

      loadLocalFallback: function () {
        var entries = readLocalEntries()
        var that = this
        Object.keys(entries).forEach(function (key) {
          if (!Object.prototype.hasOwnProperty.call(that.cache, key)) that.cache[key] = entries[key]
        })
      },

      migrateLocalFallback: function () {
        var entries = readLocalEntries()
        var keys = Object.keys(entries)
        if (!keys.length || !this.db) return Promise.resolve()

        var that = this
        var missingKeys = keys.filter(function (key) {
          return !Object.prototype.hasOwnProperty.call(that.cache, key)
        })
        missingKeys.forEach(function (key) { that.cache[key] = entries[key] })

        if (!missingKeys.length) {
          clearLocalEntries(entries)
          return Promise.resolve()
        }

        return new Promise(function (resolve, reject) {
          var transaction = that.db.transaction(STORE_NAME, 'readwrite')
          var store = transaction.objectStore(STORE_NAME)
          missingKeys.forEach(function (key) { store.put(entries[key], key) })
          var settled = false
          function fail() {
            if (settled) return
            settled = true
            reject(transaction.error || new Error('Failed to migrate local save data to IndexedDB'))
          }
          transaction.oncomplete = function () {
            if (settled) return
            settled = true
            clearLocalEntries(entries)
            resolve()
          }
          transaction.onerror = fail
          transaction.onabort = fail
        })
      },

      init: function () {
        if (this.ready) return this.ready
        var that = this
        this.ready = new Promise(function (resolve) {
          if (!that.useIndexedDB) {
            that.loadLocalFallback()
            resolve(false)
            return
          }

          var request
          try {
            request = target.indexedDB.open(DB_NAME, VERSION)
          } catch (error) {
            that.useIndexedDB = false
            that.loadLocalFallback()
            reportStorageError(error)
            resolve(false)
            return
          }

          request.onupgradeneeded = function (event) {
            var db = event.target.result
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
          }
          request.onerror = function () {
            that.useIndexedDB = false
            that.loadLocalFallback()
            reportStorageError(request.error || new Error('IndexedDB could not be opened'))
            resolve(false)
          }
          request.onsuccess = function () {
            that.db = request.result
            that.db.onversionchange = function () { that.db.close() }
            var transaction = that.db.transaction(STORE_NAME, 'readonly')
            var store = transaction.objectStore(STORE_NAME)
            var cursorRequest = store.openCursor()
            cursorRequest.onsuccess = function (event) {
              var cursor = event.target.result
              if (cursor) {
                that.cache[cursor.key] = cursor.value
                cursor.continue()
              }
            }
            transaction.oncomplete = function () {
              that.migrateLocalFallback().then(
                function () { resolve(true) },
                function (error) {
                  reportStorageError(error)
                  resolve(true)
                },
              )
            }
            transaction.onerror = function () {
              that.useIndexedDB = false
              that.loadLocalFallback()
              reportStorageError(transaction.error || new Error('IndexedDB saves could not be read'))
              resolve(false)
            }
          }
        })
        return this.ready
      },

      getItem: function (key) {
        if (Object.prototype.hasOwnProperty.call(this.cache, key)) return this.cache[key]
        var fallback = safeLocalGet(key)
        return fallback === null ? null : fallback
      },

      setItem: function (key, value) {
        this.cache[key] = String(value)
        if (this.useIndexedDB) {
          this.pending[key] = true
          this.scheduleFlush()
        } else safeLocalSet(key, String(value))
      },

      removeItem: function (key) {
        delete this.cache[key]
        if (this.useIndexedDB) {
          this.pending[key] = true
          this.scheduleFlush()
        } else safeLocalRemove(key)
      },

      clear: function () {
        var previousCache = this.cache
        this.cache = {}
        this.pending = {}
        clearLocalEntries()
        var that = this
        return this.ready.then(function () {
          if (!that.useIndexedDB || !that.db) return
          return new Promise(function (resolve, reject) {
            var transaction = that.db.transaction(STORE_NAME, 'readwrite')
            transaction.objectStore(STORE_NAME).clear()
            transaction.oncomplete = function () { resolve() }
            transaction.onerror = function () {
              reject(transaction.error || new Error('IndexedDB saves could not be cleared'))
            }
          })
        }).catch(function (error) {
          Object.keys(previousCache).forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(that.cache, key)) that.cache[key] = previousCache[key]
          })
          reportStorageError(error)
        })
      },

      scheduleFlush: function () {
        if (this.flushTimer) return
        var that = this
        this.flushTimer = target.setTimeout(function () {
          that.flushTimer = null
          that.flush().catch(function () {})
        }, 60)
      },

      flush: function () {
        var that = this
        var keys = Object.keys(this.pending)
        this.pending = {}
        if (!keys.length) return Promise.resolve()
        return this.ready.then(function () {
          if (!that.useIndexedDB || !that.db) {
            keys.forEach(function (key) {
              if (Object.prototype.hasOwnProperty.call(that.cache, key)) safeLocalSet(key, that.cache[key])
              else safeLocalRemove(key)
            })
            return
          }
          return new Promise(function (resolve, reject) {
            var transaction = that.db.transaction(STORE_NAME, 'readwrite')
            var store = transaction.objectStore(STORE_NAME)
            keys.forEach(function (key) {
              if (Object.prototype.hasOwnProperty.call(that.cache, key)) store.put(that.cache[key], key)
              else store.delete(key)
            })
            var settled = false
            function fail() {
              if (settled) return
              settled = true
              reject(transaction.error || new Error('IndexedDB save transaction failed'))
            }
            transaction.oncomplete = function () {
              if (settled) return
              settled = true
              var root = target.document && target.document.documentElement
              if (root) root.removeAttribute('data-dc-storage-error')
              resolve()
            }
            transaction.onerror = fail
            transaction.onabort = fail
          })
        }).catch(function (error) {
          keys.forEach(function (key) { that.pending[key] = true })
          reportStorageError(error)
          throw error
        })
      },
    }

    storage.init()
    target.addEventListener('pagehide', function () { storage.flush().catch(function () {}) })
    target.document.addEventListener('visibilitychange', function () {
      if (target.document.visibilityState === 'hidden') storage.flush().catch(function () {})
    })
    return storage
  }

  function installBrowserApi(target, vfs) {
    if (target.api && target.api.__dcBrowserApi) return target.api

    var storage = createStorage(target)
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
        binaryDebug.pending += 1
        publishBinaryDebug(path, null)
        var blob
        try {
          blob = vfs.getBlob(path)
          if (!blob) throw new Error('ASAR file not found: ' + path)
        } catch (error) {
          binaryDebug.pending -= 1
          binaryDebug.failed += 1
          publishBinaryDebug(path, error)
          return Promise.reject(error)
        }
        return blob.arrayBuffer().then(function (value) {
          var copy = global.DCVfsRuntime.copyArrayBufferToRealm(target, value)
          binaryDebug.pending -= 1
          binaryDebug.completed += 1
          publishBinaryDebug(path, null)
          return copy
        }).catch(function (error) {
          binaryDebug.pending -= 1
          binaryDebug.failed += 1
          publishBinaryDebug(path, error)
          throw error
        })
      },
      rm: function (path) { storage.removeItem('file:' + path) },
      unlink: function (path) { storage.removeItem('file:' + path) },

      saveFile: async function (param) {
        var href = (param && param.dataUrl) || param
        var link = target.document.createElement('a')
        link.href = href
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
          if (target.document.fullscreenElement && target.document.exitFullscreen) {
            await target.document.exitFullscreen()
          }
          return
        }
        var element = target.document.documentElement
        if (element.requestFullscreen) await element.requestFullscreen()
      },

      quit: async function () {
        target.parent.postMessage({ type: 'dc-player-quit' }, '*')
      },
      applyPatch: async function () { return false },
      openWebPage: async function (url) { target.open(url, '_blank', 'noopener') },
      readSubDir: async function () { return [] },
      toggleDevTools: async function () {},
      isMuteAudio: async function (enabled) {
        var media = target.document.querySelectorAll('audio,video')
        for (var i = 0; i < media.length; i++) media[i].muted = Boolean(enabled)
      },
      captureWindow: async function () { return '' },
      registerHotKey: async function () {},
      getSaveKey: function () { return null },
      isAppActivated: async function () { return true },
      activateAchievement: async function () {},
      triggerScreenshot: async function () {},
      log: async function () {
        target.console.log.apply(target.console, arguments)
      },
    }

    target.api = api
    target.process = api.returnProcess()
    target.__dirname = ''
    return api
  }

  function installStorageAdapters(target, $, vfs) {
    var api = target.api
    var storage = api.storage

    function countObjectUrls(value) {
      return (String(value || '').match(/blob(?::|%3a|%253a)/gi) || []).length
    }

    function serialize(value) {
      var restoredUrlCount = 0
      var serialized = JSON.stringify(value, function (key, item) {
        if (typeof item !== 'string') return item
        var restored = vfs.restoreObjectUrls(item)
        if (restored !== item) {
          restoredUrlCount += countObjectUrls(item) - countObjectUrls(restored)
        }
        return restored
      })
      var root = target.document && target.document.documentElement
      if (root) {
        root.setAttribute('data-dc-save-restored-urls', String(restoredUrlCount))
        root.setAttribute('data-dc-save-unmapped-urls', String(countObjectUrls(serialized)))
      }
      return serialized
    }

    $.setStorageWeb = function (key, value) {
      storage.setItem(key, encodeURIComponent(serialize(value)))
    }

    $.getStorageWeb = function (key) {
      var raw = storage.getItem(key)
      if (raw === null || raw === 'null') return null
      try { return decodeURIComponent(raw) } catch (error) { return unescape(raw) }
    }

    $.setStorageCompress = function (key, value) {
      var encoded = encodeURIComponent(serialize(value))
      storage.setItem(key, target.LZString ? target.LZString.compress(encoded) : encoded)
    }

    $.getStorageCompress = function (key) {
      var raw = storage.getItem(key)
      if (raw === null || raw === 'null') return null
      var decoded = target.LZString ? target.LZString.decompress(raw) || raw : raw
      try { return decodeURIComponent(decoded) } catch (error) { return unescape(decoded) }
    }

    $.setStorageFile = $.setStorageWeb
    $.getStorageFile = $.getStorageWeb
    $.clearStorage = function (type, key) {
      if (key) storage.removeItem(key)
      else storage.clear()
    }
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
    var small = overlay.querySelector('small')
    small.style.cssText = 'font:600 11px/1.2 Consolas,monospace;color:#9fb0a5;letter-spacing:0'
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

  function installTyranoCompat(target, vfs) {
    if (target.__dcTyranoCompatInstalled) return
    var $ = target.jQuery
    if (!$ || !target.TYRANO || !target.tyrano || !target.tyrano.plugin.kag) {
      throw new Error('Tyrano runtime was not ready for browser adaptation')
    }

    global.DCVfsRuntime.installJQuery(target)
    target.TYRANO.cache_text = true
    target.TYRANO.resource_concurrency = 6
    installStorageAdapters(target, $, vfs)
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

  global.DCCompat = {
    installBrowserApi: installBrowserApi,
    installTyranoCompat: installTyranoCompat,
  }
})(window)
