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

  function PlayerController(view, profile) {
    this.view = view
    this.profile = profile
    this.baseGame = null
    this.mods = []
    this.nextModIndex = 1
    this.nextLaunchId = 1
    this.preparedSession = null
    this.activeSession = null
    this.busy = false
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
      saveModConfig: function (id, value) { controller.saveModConfig(id, value) },
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

  PlayerController.prototype.prepareLaunch = async function () {
    if (!this.baseGame || this.activeSession) return
    var controller = this
    var previous = this.preparedSession
    this.preparedSession = null
    this.view.setLaunchReady(false)
    this.view.setProgress(4, '模组')
    this.view.setStatus('正在准备启动环境')

    var resolver = null
    try {
      var modPlan = await DCWeb.ModPlan.create(this.mods)
      var layers = [{ id: 'base-game', kind: 'base', source: this.baseGame.archive }].concat(modPlan.layers)
      var vfs = new DCWeb.LayeredVfs(layers)
      resolver = new DCWeb.AssetResolver(vfs)
      var view = this.view
      await resolver.prepareStyles(function (current, total) {
        view.setProgress(10 + (current / Math.max(total, 1)) * 58, '样式 ' + current + '/' + total)
      })

      this.view.setStatus('正在准备浏览器兼容层')
      await this.profile.prepare(resolver)
      this.view.setProgress(78, '入口')
      var gameHtml = await DCWeb.GameDocument.build(resolver)
      var session = {
        baseGame: this.baseGame,
        html: gameHtml,
        launchId: this.nextLaunchId++,
        launchToken: createLaunchToken(),
        modPlan: modPlan,
        ready: false,
        released: false,
        resolver: resolver,
        restartWhenReady: false,
        vfs: vfs,
      }
      this.preparedSession = session
      this.publishBridge(session)
      resolver = null
      this.view.setProgress(88, '引擎')
      this.view.setStatus('正在后台载入游戏引擎')
      this.view.showPreparingPlayer()
      this.view.navigate(gameHtml, function () { controller.releaseSession(previous) })
    } catch (error) {
      if (resolver) resolver.release()
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
    this.view.showPlayer(session.baseGame.file, session.baseGame.packageJson.version, session.modPlan.metadata.length)
  }

  PlayerController.prototype.loadCore = async function (file) {
    if (this.busy || !file) return
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
      this.view.showBaseGame(file, packageJson.version)
      await this.prepareLaunch()
    } catch (error) {
      if (resolver) resolver.release()
      this.view.showError(error)
    } finally {
      this.setBusy(false)
      this.view.resetCoreInput()
    }
  }

  PlayerController.prototype.addMods = async function (files) {
    files = Array.prototype.slice.call(files || [])
    if (this.busy || this.activeSession || !files.length) return
    this.setBusy(true)
    this.view.clearError()
    this.view.setStatus('正在读取 ' + files.length + ' 个模组归档')

    try {
      var firstIndex = this.nextModIndex
      var packages = await Promise.all(files.map(function (file, index) {
        return DCWeb.ModPackage.open(file, firstIndex + index)
      }))
      var ids = new Set(this.mods.map(function (mod) { return mod.id }))
      packages.forEach(function (mod) {
        if (ids.has(mod.id)) throw new Error('模组 ID 重复：' + mod.id)
        ids.add(mod.id)
      })
      this.mods = this.mods.concat(packages)
      this.nextModIndex += packages.length
      this.syncMods()
      this.view.showPage('mods')
      if (this.baseGame) await this.prepareLaunch()
      else this.view.setStatus('已添加 ' + packages.length + ' 个模组；载入核心 ASAR 后即可准备游戏', 'ready')
    } catch (error) {
      this.view.showError(error)
    } finally {
      this.setBusy(false)
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
    this.view.showPlayer(session.baseGame.file, session.baseGame.packageJson.version, session.modPlan.metadata.length)
    this.startFrame(session)
  }

  PlayerController.prototype.prepareAfterClose = async function () {
    if (this.busy || this.activeSession || !this.baseGame) return
    this.setBusy(true)
    this.view.clearError()
    try { await this.prepareLaunch() } catch (error) { this.view.showError(error) } finally { this.setBusy(false) }
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
