;(function (global) {
  'use strict'

  var view = new global.DCWeb.ShellView(global.document)
  var sourceStore = global.DCWeb.LocalSourceStore.create(global)
  var player = new global.DCWeb.PlayerController(view, global.DCWeb.DevilConnectionProfile, sourceStore)
  player.bind()
  global.document.documentElement.setAttribute('data-dc-shell-ready', 'true')
  player.restoreSources(false)
})(window)
