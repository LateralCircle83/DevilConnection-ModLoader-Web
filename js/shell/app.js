;(function (global) {
  'use strict'

  var view = new global.DCWeb.ShellView(global.document)
  var sourceStore = global.DCWeb.LocalSourceStore.create(global)
  var player = new global.DCWeb.PlayerController(view, global.DCWeb.DevilConnectionProfile, sourceStore)
  var saveStore = global.DCWeb.BrowserSaveStore.create(global)
  var saveManager = new global.DCWeb.SaveManager(global, saveStore)
  var saveController = new global.DCWeb.SaveManagerController(view, saveManager, player)
  var compatibilityView = new global.DCWeb.CompatibilityView(global, global.document)
  var compatibilityController = new global.DCWeb.CompatibilityController(view, compatibilityView, global.DCWeb.DevilConnectionProfile)
  player.onCompatibilityChange(function (event) {
    if (event.state === 'checking') compatibilityController.checking(event.context)
    if (event.state === 'ready') compatibilityController.ready(event.report, event.context)
    if (event.state === 'failed') compatibilityController.failed(event.error, event.context)
  })
  player.bind()
  saveController.bind()
  compatibilityController.bind()
  global.document.documentElement.setAttribute('data-dc-shell-ready', 'true')
  player.restoreSources(false)
})(window)
