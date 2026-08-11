;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  DCWeb.Compat = {
    installBrowserApi: DCWeb.BrowserApi.install,
    installTyranoCompat: DCWeb.TyranoAdapter.install,
  }
  global.DCCompat = DCWeb.Compat
})(window)
