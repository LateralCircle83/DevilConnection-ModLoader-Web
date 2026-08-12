;(function (global) {
  'use strict'

  var view = new global.DCWeb.ShellView(global.document)
  var sourceStore = global.DCWeb.LocalSourceStore.create(global)
  var player = new global.DCWeb.PlayerController(view, global.DCWeb.DevilConnectionProfile, sourceStore)
  var saveStore = global.DCWeb.BrowserSaveStore.create(global)
  var saveManager = new global.DCWeb.SaveManager(global, saveStore)
  var saveController = new global.DCWeb.SaveManagerController(view, saveManager, player)
  player.bind()
  saveController.bind()
  global.document.documentElement.setAttribute('data-dc-shell-ready', 'true')
  player.restoreSources(false)
})(window)
