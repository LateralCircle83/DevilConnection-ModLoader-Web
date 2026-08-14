;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var CLOSED_DOCUMENT = '<!doctype html><title>Closed</title>'
  var RELOADING_DOCUMENT = '<!doctype html><title>Reloading</title>'

  function createLaunchToken() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID()
    var bytes = new Uint32Array(4)
    if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
      global.crypto.getRandomValues(bytes)
      return Array.prototype.map.call(bytes, function (value) { return value.toString(16).padStart(8, '0') }).join('')
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2)
  }

  function PlayerController(view, profile, sourceStore) {
    this.view = view
    this.profile = profile
    this.sourceStore = sourceStore || { supported: false }
    this.baseGame = null
    this.coreHandle = null
    this.mods = []
    this.nextModIndex = 1
    this.nextLaunchId = 1
    this.preparedSession = null
    this.activeSession = null
    this.busy = false
    this.restoreRecord = null
    this.restoringSources = false
    this.compatibilityListeners = []
  }

  PlayerController.prototype.bind = function () {
    var controller = this
    this.view.bind({
      addMods: function (files) { controller.addMods(files) },
      close: function () { controller.close() },
      configureMod: function (id) { controller.configureMod(id) },
      isBusy: function () { return controller.busy },
      loadCore: function (file) { controller.loadCore(file) },
      moveMod: function (id, delta) { controller.moveMod(id, delta) },
      reload: function () { controller.reload() },
      removeMod: function (id) { controller.removeMod(id) },
      restoreSources: function (requestAccess) { controller.restoreSources(requestAccess) },
      saveModConfig: function (id, value) { controller.saveModConfig(id, value) },
      selectCore: function () { controller.selectCore() },
      selectMods: function () { controller.selectMods() },
      start: function () { controller.start() },
      toggleMod: function (id, enabled) { controller.toggleMod(id, enabled) },
    })
    this.syncMods()

    global.addEventListener('message', function (event) {
      if (!event.data || typeof event.data.type !== 'string' || event.data.type.indexOf('dc-player-') !== 0) return
      var prepared = controller.preparedSession
      var active = controller.activeSession
      var trusted = (prepared && event.data.launchToken === prepared.launchToken) ||
        (active && event.data.launchToken === active.launchToken)
      if (!trusted) return
      if (event.data.type === 'dc-player-quit') controller.close()
      if (event.data.type === 'dc-player-ready') controller.onFrameReady(event.data.launchId)
      if (event.data.type === 'dc-player-started') controller.onFrameStarted(event.data.launchId)
      if (event.data.type === 'dc-player-error') {
        global.console.error('[Game frame]', event.data.message, event.data.stack || '')
      }
    })
    global.addEventListener('beforeunload', function () {
      controller.releaseSession(controller.preparedSession)
      controller.releaseSession(controller.activeSession)
    })
  }

  PlayerController.prototype.setBusy = function (value) {
    this.busy = value
    this.view.setBusy(value)
  }

  PlayerController.prototype.onCompatibilityChange = function (listener) {
    if (typeof listener === 'function') this.compatibilityListeners.push(listener)
  }

  PlayerController.prototype.compatibilityContext = function () {
    return {
      gameVersion: this.baseGame && this.baseGame.packageJson ? this.baseGame.packageJson.version || '' : '',
      mods: this.mods.filter(function (mod) { return mod.enabled }).map(function (mod) {
        return { id: mod.id, name: mod.name, version: mod.version }
      }),
    }
  }

  PlayerController.prototype.publishCompatibility = function (state, value) {
    var event = { context: this.compatibilityContext(), state: state }
    if (state === 'ready') event.report = value
    if (state === 'failed') event.error = value
    this.compatibilityListeners.forEach(function (listener) { listener(event) })
  }

  PlayerController.prototype.publishBridge = function (session) {
    global.__dcActiveResolver = session ? session.resolver : null
    global.__dcActiveModPlan = session ? session.modPlan : null
    global.__dcActiveLaunchId = session ? session.launchId : null
    global.__dcActiveLaunchToken = session ? session.launchToken : null
  }

  PlayerController.prototype.releaseSession = function (session) {
    if (!session || session.released) return
    session.released = true
    session.resolver.release()
  }

  PlayerController.prototype.syncMods = function () {
    this.view.renderMods(this.mods.map(function (mod) { return mod.toViewModel() }))
    this.view.setModCount(this.mods.filter(function (mod) { return mod.enabled }).length)
    this.view.setLaunchReady(Boolean(this.preparedSession && this.preparedSession.ready))
  }

  PlayerController.prototype.persistSources = function () {
    if (this.restoringSources || !this.sourceStore.supported || typeof this.sourceStore.save !== 'function') return Promise.resolve(false)
    var controller = this
    return this.sourceStore.save(this.coreHandle, this.mods.map(function (mod) {
      return { enabled: mod.enabled, handle: mod.sourceHandle || null }
    })).catch(function (error) {
      global.console.warn('[DC local sources]', error)
      return false
    }).then(function (result) {
      if (result) {
        controller.restoreRecord = null
        if (controller.view.hideSourceRestore) controller.view.hideSourceRestore()
      }
      return result
    })
  }

  PlayerController.prototype.selectCore = async function () {
    if (this.busy || this.activeSession) return
    if (!this.sourceStore.supported) {
      this.view.chooseCoreFile()
      return
    }
    try {
      var handle = await this.sourceStore.pickCore()
      if (handle) await this.loadCore(await handle.getFile(), handle)
    } catch (error) {
      if (!error || error.name !== 'AbortError') this.view.showError(error)
    }
  }

  PlayerController.prototype.selectMods = async function () {
    if (this.busy || this.activeSession) return
    if (!this.sourceStore.supported) {
      this.view.chooseModFiles()
      return
    }
    try {
      var handles = Array.prototype.slice.call(await this.sourceStore.pickMods() || [])
      if (handles.length) await this.addMods(await Promise.all(handles.map(function (handle) { return handle.getFile() })), handles)
    } catch (error) {
      if (!error || error.name !== 'AbortError') this.view.showError(error)
    }
  }

  PlayerController.prototype.restoreSources = async function (requestAccess) {
    if (this.busy || this.activeSession || !this.sourceStore.supported) return
    this.setBusy(true)
    this.view.clearError()
    try {
      var record = this.restoreRecord || await this.sourceStore.load()
      if (!record || !record.core) {
        this.restoreRecord = null
        this.view.hideSourceRestore()
        return
      }
      this.restoreRecord = record
      var entries = [{ handle: record.core, kind: 'core' }].concat((record.mods || []).map(function (mod) {
        return { enabled: mod.enabled !== false, handle: mod.handle, kind: 'mod' }
      }))
      var permissionStates = await Promise.all(entries.map(function (entry) {
        return this.sourceStore.permissionFor(entry.handle, Boolean(requestAccess))
      }, this))
      var unavailable = permissionStates.filter(function (state) { return state !== 'granted' }).length
      if (unavailable) {
        this.view.showSourceRestore(unavailable)
        this.view.setStatus(requestAccess ? '无法读取部分已记住的归档，请重新选择文件' : '可以恢复上次选择的本地归档')
        return
      }

      this.view.hideSourceRestore()
      this.view.setStatus('正在恢复上次选择的本地归档')
      var files = await Promise.all(entries.map(function (entry) { return entry.handle.getFile() }))
      this.restoringSources = true
      if (!await this.loadCore(files[0], record.core, true)) throw new Error('无法恢复上次选择的核心 ASAR')
      if (entries.length > 1) {
        var beforeCount = this.mods.length
        if (!await this.addMods(files.slice(1), entries.slice(1).map(function (entry) { return entry.handle }), true)) {
          throw new Error('无法恢复上次选择的模组 ASAR')
        }
        this.mods.slice(beforeCount).forEach(function (mod, index) {
          mod.enabled = entries[index + 1].enabled
        })
        this.syncMods()
      }
      this.restoreRecord = null
      this.restoringSources = false
      await this.persistSources()
      this.view.showPage('launch')
      await this.prepareLaunch()
      this.view.setStatus('已恢复上次选择，启动环境正在就绪', 'ready')
    } catch (error) {
      this.restoringSources = false
      if (requestAccess) this.view.showError(error)
      else global.console.warn('[DC local sources]', error)
    } finally {
      this.setBusy(false)
    }
  }

  PlayerController.prototype.prepareLaunch = async function () {
    if (!this.baseGame || this.activeSession) return
    var controller = this
    var previous = this.preparedSession
    this.preparedSession = null
    this.view.setLaunchReady(false)
    this.view.setProgress(4, '模组')
    this.view.setStatus('正在准备启动环境')

    var prepared = null
    var compatibility = null
    this.publishCompatibility('checking')
    try {
      var view = this.view
      prepared = await DCWeb.SessionPreparer.prepare({
        baseGame: this.baseGame,
        mods: this.mods,
        onPhase: function (phase, detail) {
          if (phase === 'profile') view.setStatus('正在应用游戏兼容档案')
          if (phase === 'profile-ready') compatibility = detail
          if (phase === 'entry') view.setProgress(78, '入口')
        },
        onStyleProgress: function (current, total) {
          view.setProgress(10 + (current / Math.max(total, 1)) * 58, '样式 ' + current + '/' + total)
        },
        profile: this.profile,
      })
      var session = {
        baseGame: this.baseGame,
        compatibility: prepared.compatibility,
        html: prepared.html,
        gameTitle: prepared.gameTitle,
        launchId: this.nextLaunchId++,
        launchToken: createLaunchToken(),
        modPlan: prepared.modPlan,
        ready: false,
        released: false,
        resolver: prepared.resolver,
        restartWhenReady: false,
        vfs: prepared.vfs,
      }
      this.preparedSession = session
      this.publishCompatibility('ready', prepared.compatibility)
      this.publishBridge(session)
      this.view.setProgress(88, '引擎')
      this.view.setStatus('正在后台载入游戏引擎')
      this.view.showPreparingPlayer()
      this.view.navigate(prepared.html, function () { controller.releaseSession(previous) })
    } catch (error) {
      if (prepared && prepared.resolver) prepared.resolver.release()
      if (error && error.compatibility) this.publishCompatibility('failed', error)
      else if (compatibility) this.publishCompatibility('ready', compatibility)
      this.preparedSession = null
      this.publishBridge(null)
      if (previous) {
        this.view.navigate(CLOSED_DOCUMENT, function () { controller.releaseSession(previous) })
      }
      throw error
    }
  }

  PlayerController.prototype.onFrameReady = function (launchId) {
    var prepared = this.preparedSession
    if (prepared && prepared.launchId === launchId) {
      prepared.ready = true
      this.view.setProgress(100, '已就绪')
      this.view.setStatus('启动环境已就绪，可以开始游戏', 'ready')
      this.view.setLaunchReady(true)
      return
    }

    var active = this.activeSession
    if (active && active.launchId === launchId && active.restartWhenReady) {
      active.restartWhenReady = false
      this.startFrame(active)
    }
  }

  PlayerController.prototype.onFrameStarted = function (launchId) {
    var session = this.preparedSession
    if (!session || session.launchId !== launchId || this.activeSession) return
    this.preparedSession = null
    this.activeSession = session
    this.view.setLaunchReady(false)
    this.view.showPlayer(session.baseGame.file, session.baseGame.packageJson.version, session.modPlan.metadata.length, session.gameTitle)
  }

  PlayerController.prototype.loadCore = async function (file, handle, deferPrepare) {
    if ((this.busy && !this.restoringSources) || !file) return
    this.setBusy(true)
    this.view.setLaunchReady(false)
    this.view.clearError()
    this.view.setProgress(8, '读取')
    this.view.setStatus('正在读取 ' + file.name + ' · ' + DCWeb.ShellView.formatBytes(file.size))

    var resolver = null
    try {
      var archive = await DCWeb.AsarArchive.open(file)
      var vfs = new DCWeb.LayeredVfs([{ id: 'base-game', kind: 'base', source: archive }])
      resolver = new DCWeb.AssetResolver(vfs)
      this.view.setProgress(24, '校验')
      var packageJson = await this.profile.validate(resolver)
      resolver.release()
      resolver = null

      this.baseGame = { archive: archive, file: file, packageJson: packageJson }
      this.coreHandle = handle || null
      this.view.showBaseGame(file, packageJson.version)
      await this.persistSources()
      if (!deferPrepare) await this.prepareLaunch()
      return true
    } catch (error) {
      if (resolver) resolver.release()
      this.view.showError(error)
      return false
    } finally {
      if (!this.restoringSources) this.setBusy(false)
      this.view.resetCoreInput()
    }
  }

  PlayerController.prototype.addMods = async function (files, handles, deferPrepare) {
    files = Array.prototype.slice.call(files || [])
    if ((this.busy && !this.restoringSources) || this.activeSession || !files.length) return
    this.setBusy(true)
    this.view.clearError()
    this.view.setStatus('正在读取 ' + files.length + ' 个模组归档')

    try {
      var firstIndex = this.nextModIndex
      var packages = await Promise.all(files.map(function (file, index) {
        return DCWeb.ModPackage.open(file, firstIndex + index)
      }))
      packages.forEach(function (mod, index) { mod.sourceHandle = handles && handles[index] ? handles[index] : null })
      var ids = new Set(this.mods.map(function (mod) { return mod.id }))
      packages.forEach(function (mod) {
        if (ids.has(mod.id)) throw new Error('模组 ID 重复：' + mod.id)
        ids.add(mod.id)
      })
      this.mods = this.mods.concat(packages)
      this.nextModIndex += packages.length
      this.syncMods()
      await this.persistSources()
      this.view.showPage('mods')
      if (this.baseGame && !deferPrepare) await this.prepareLaunch()
      else this.view.setStatus('已添加 ' + packages.length + ' 个模组；载入核心 ASAR 后即可准备游戏', 'ready')
      return true
    } catch (error) {
      this.view.showError(error)
      return false
    } finally {
      if (!this.restoringSources) this.setBusy(false)
      this.view.resetModInput()
    }
  }

  PlayerController.prototype.findModIndex = function (id) {
    return this.mods.findIndex(function (mod) { return mod.id === id })
  }

  PlayerController.prototype.configureMod = function (id) {
    if (this.busy || this.activeSession) return
    var index = this.findModIndex(id)
    var mod = index === -1 ? null : this.mods[index]
    if (!mod || !mod.configSchema) return
    var saved = DCWeb.ModConfigStore.readJson(global, mod.configName) || {}
    this.view.openModConfig({
      configName: mod.configName,
      id: mod.id,
      name: mod.name,
      schema: mod.configSchema,
    }, saved)
  }

  PlayerController.prototype.normalizeModConfig = function (schema, input) {
    var output = {}
    ;(schema.fields || []).forEach(function (field) {
      if (!field || !field.key) return
      var value = Object.prototype.hasOwnProperty.call(input, field.key) ? input[field.key] : field.default
      if (field.required && field.type !== 'toggle' && (value === undefined || value === null || String(value).trim() === '')) {
        throw new Error((field.label || field.key) + '不能为空')
      }
      if (field.type === 'toggle') value = Boolean(value)
      else if (field.type === 'number') {
        value = Number(value)
        if (!Number.isFinite(value)) value = Number(field.default) || 0
        if (Number.isFinite(Number(field.min))) value = Math.max(value, Number(field.min))
        if (Number.isFinite(Number(field.max))) value = Math.min(value, Number(field.max))
      } else value = value === undefined || value === null ? '' : String(value)
      output[field.key] = value
    })
    return output
  }

  PlayerController.prototype.saveModConfig = async function (id, input) {
    if (this.busy || this.activeSession) return
    var index = this.findModIndex(id)
    var mod = index === -1 ? null : this.mods[index]
    if (!mod || !mod.configSchema) return
    var value
    try {
      value = this.normalizeModConfig(mod.configSchema, input || {})
      DCWeb.ModConfigStore.writeJson(global, mod.configName, value)
    } catch (error) {
      this.view.showModConfigError(error && error.message ? error.message : String(error))
      return
    }

    this.view.closeModConfig()
    this.view.setStatus('已保存 ' + mod.name + ' 的配置', 'ready')
    if (!this.baseGame) return
    this.setBusy(true)
    try {
      await this.prepareLaunch()
    } catch (error) {
      this.view.showError(error)
    } finally {
      this.setBusy(false)
    }
  }

  PlayerController.prototype.updateModSelection = async function (change) {
    if (this.busy || this.activeSession) return
    this.setBusy(true)
    this.view.clearError()
    try {
      if (!change()) return
      this.syncMods()
      await this.persistSources()
      if (this.baseGame) await this.prepareLaunch()
    } catch (error) {
      this.view.showError(error)
    } finally {
      this.setBusy(false)
    }
  }

  PlayerController.prototype.toggleMod = function (id, enabled) {
    var controller = this
    this.updateModSelection(function () {
      var index = controller.findModIndex(id)
      if (index === -1) return false
      controller.mods[index].enabled = Boolean(enabled)
      if (!controller.mods[index].enabled && controller.mods[index].releaseRuntimeCache) {
        controller.mods[index].releaseRuntimeCache()
      }
      return true
    })
  }

  PlayerController.prototype.moveMod = function (id, delta) {
    var controller = this
    this.updateModSelection(function () {
      var index = controller.findModIndex(id)
      var target = index + delta
      if (index === -1 || target < 0 || target >= controller.mods.length) return false
      var moved = controller.mods[index]
      controller.mods[index] = controller.mods[target]
      controller.mods[target] = moved
      return true
    })
  }

  PlayerController.prototype.removeMod = function (id) {
    var controller = this
    this.updateModSelection(function () {
      var index = controller.findModIndex(id)
      if (index === -1) return false
      if (controller.mods[index].releaseRuntimeCache) controller.mods[index].releaseRuntimeCache()
      controller.mods.splice(index, 1)
      return true
    })
  }

  PlayerController.prototype.startFrame = function (session) {
    try {
      var start = this.view.frame.contentWindow && this.view.frame.contentWindow.__dcStartGame
      if (typeof start !== 'function') throw new Error('游戏启动入口尚未就绪')
      Promise.resolve(start.call(this.view.frame.contentWindow)).catch(function (error) {
        global.console.error('[Game start]', error)
      })
    } catch (error) {
      this.view.showError(error)
    }
  }

  PlayerController.prototype.start = function () {
    var session = this.preparedSession
    if (this.busy || !session || !session.ready || this.activeSession) return
    this.preparedSession = null
    this.activeSession = session
    this.view.setLaunchReady(false)
    this.view.showPlayer(session.baseGame.file, session.baseGame.packageJson.version, session.modPlan.metadata.length, session.gameTitle)
    this.startFrame(session)
  }

  PlayerController.prototype.prepareAfterClose = async function () {
    if (this.busy || this.activeSession || !this.baseGame) return
    this.setBusy(true)
    this.view.clearError()
    try { await this.prepareLaunch() } catch (error) { this.view.showError(error) } finally { this.setBusy(false) }
  }

  PlayerController.prototype.flushPreparedStorage = async function () {
    var frameStorage = this.preparedSession && this.view.frame.contentWindow && this.view.frame.contentWindow.api && this.view.frame.contentWindow.api.storage
    if (frameStorage && typeof frameStorage.flush === 'function') await frameStorage.flush()
  }

  PlayerController.prototype.suspendPreparedSession = async function () {
    if (this.activeSession) throw new Error('游戏运行期间不能替换存档数据')
    var controller = this
    var previous = this.preparedSession
    await this.flushPreparedStorage()
    this.preparedSession = null
    this.publishBridge(null)
    this.view.setLaunchReady(false)
    if (!previous) return
    await new Promise(function (resolve) {
      controller.view.navigate(CLOSED_DOCUMENT, function () {
        controller.releaseSession(previous)
        resolve()
      })
    })
  }

  PlayerController.prototype.refreshStorageSession = async function () {
    if (this.activeSession) throw new Error('游戏运行期间不能替换存档数据')
    if (this.baseGame) await this.prepareLaunch()
  }

  PlayerController.prototype.close = function () {
    if (!this.activeSession) return
    var controller = this
    var previous = this.activeSession
    this.activeSession = null
    this.publishBridge(null)
    this.view.showManager(Boolean(this.baseGame))
    this.view.navigate(CLOSED_DOCUMENT, function () {
      controller.releaseSession(previous)
      controller.prepareAfterClose()
    })
  }

  PlayerController.prototype.reload = function () {
    var session = this.activeSession
    if (!session) return
    var view = this.view
    session.restartWhenReady = true
    view.navigate(RELOADING_DOCUMENT, function () {
      global.setTimeout(function () {
        view.navigate(session.html)
      }, 0)
    })
  }

  DCWeb.PlayerController = PlayerController
})(window)
