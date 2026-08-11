;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var CLOSED_DOCUMENT = '<!doctype html><title>Closed</title>'
  var RELOADING_DOCUMENT = '<!doctype html><title>Reloading</title>'

  function PlayerController(view, profile) {
    this.view = view
    this.profile = profile
    this.activeSession = null
    this.busy = false
  }

  PlayerController.prototype.bind = function () {
    var controller = this
    this.view.bind({
      close: function () { controller.close() },
      isBusy: function () { return controller.busy },
      mount: function (file) { controller.mount(file) },
      reload: function () { controller.reload() },
    })
    global.addEventListener('message', function (event) {
      if (event.source !== controller.view.frame.contentWindow || !event.data) return
      if (event.data.type === 'dc-player-quit') controller.close()
      if (event.data.type === 'dc-player-error') {
        global.console.error('[Game frame]', event.data.message, event.data.stack || '')
      }
    })
    global.addEventListener('beforeunload', function () {
      if (controller.activeSession) controller.activeSession.resolver.release()
    })
  }

  PlayerController.prototype.setBusy = function (value) {
    this.busy = value
    this.view.setBusy(value)
  }

  PlayerController.prototype.publishSession = function (session) {
    this.activeSession = session
    global.__dcActiveResolver = session ? session.resolver : null
    global.__dcActiveArchive = session ? session.resolver : null
  }

  PlayerController.prototype.mount = async function (file) {
    if (this.busy || !file) return
    this.setBusy(true)
    this.view.clearError()
    this.view.setProgress(4, '读取')
    this.view.setStatus('正在读取 ' + file.name + ' · ' + DCWeb.ShellView.formatBytes(file.size))

    var resolver = null
    try {
      var archive = await DCWeb.AsarArchive.open(file)
      var vfs = new DCWeb.LayeredVfs([{ id: 'base-game', kind: 'base', source: archive }])
      resolver = new DCWeb.AssetResolver(vfs)

      this.view.setProgress(18, '校验')
      var packageJson = await this.profile.validate(resolver)
      this.view.setStatus('正在准备浏览器资源映射')
      var view = this.view
      await resolver.prepareStyles(function (current, total) {
        view.setProgress(18 + (current / Math.max(total, 1)) * 52, '样式 ' + current + '/' + total)
      })

      this.view.setStatus('正在准备浏览器兼容层')
      await this.profile.prepare(resolver)
      this.view.setProgress(78, '入口')
      var gameHtml = await DCWeb.GameDocument.build(resolver)
      var previousSession = this.activeSession
      var nextSession = { archive: archive, resolver: resolver, vfs: vfs, html: gameHtml }
      this.publishSession(nextSession)
      resolver = null

      this.view.showPlayer(file, packageJson.version)
      this.view.navigate(gameHtml, function () {
        if (previousSession) previousSession.resolver.release()
      })
      this.view.setProgress(100, '完成')
    } catch (error) {
      if (resolver) resolver.release()
      this.view.showError(error)
    } finally {
      this.setBusy(false)
      this.view.resetInput()
    }
  }

  PlayerController.prototype.close = function () {
    var previousSession = this.activeSession
    this.publishSession(null)
    this.view.showLoader()
    this.view.navigate(CLOSED_DOCUMENT, function () {
      if (previousSession) previousSession.resolver.release()
    })
  }

  PlayerController.prototype.reload = function () {
    var session = this.activeSession
    if (!session) return
    var view = this.view
    view.navigate(RELOADING_DOCUMENT, function () {
      global.setTimeout(function () { view.navigate(session.html) }, 0)
    })
  }

  DCWeb.PlayerController = PlayerController
})(window)
