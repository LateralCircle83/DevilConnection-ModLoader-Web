;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb

  async function create(packages) {
    var enabled = (packages || []).filter(function (mod) { return mod.enabled })
    await Promise.all(enabled.map(function (mod) { return mod.prepareRuntime() }))

    var textFiles = new Map()
    var filePaths = new Map()
    var hooks = []
    var metadata = []
    enabled.forEach(function (mod) {
      mod.archive.list().forEach(function (path) { filePaths.set(path.toLowerCase(), path) })
      mod.textFiles.forEach(function (text, path) { textFiles.set(path, text) })
      var hookSource = mod.getText('hook.js')
      if (hookSource) hooks.push({ id: mod.id, name: mod.name, source: hookSource })
      metadata.push({
        id: mod.id,
        name: mod.name,
        version: mod.version,
        hasHook: mod.hasHook,
      })
    })

    return {
      filePaths: filePaths,
      hooks: hooks,
      layers: enabled.map(function (mod) { return mod.toLayer() }),
      metadata: metadata,
      packages: enabled.slice(),
      textFiles: textFiles,
    }
  }

  DCWeb.ModPlan = { create: create }
})(window)
