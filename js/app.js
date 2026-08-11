;(function (global) {
  'use strict'

  var view = new global.DCWeb.ShellView(global.document)
  var player = new global.DCWeb.PlayerController(view, global.DCWeb.DevilConnectionProfile)
  player.bind()
  global.document.documentElement.setAttribute('data-dc-shell-ready', 'true')
})(window)
