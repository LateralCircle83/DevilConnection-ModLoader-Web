;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var Path = DCWeb.ResourcePath
  var ConfigStore = DCWeb.ModConfigStore

  function joinPath() {
    var segments = []
    Array.prototype.slice.call(arguments).join('/').replace(/\\/g, '/').split('/').forEach(function (part) {
      if (!part || part === '.') return
      if (part === '..') segments.pop()
      else segments.push(part)
    })
    return segments.join('/')
  }

  function basename(path) {
    var parts = String(path || '').replace(/\\/g, '/').split('/')
    return parts.pop() || ''
  }

  function dirname(path) {
    var parts = String(path || '').replace(/\\/g, '/').split('/')
    parts.pop()
    return parts.join('/') || '.'
  }

  function configKey(path) {
    return ConfigStore.nameFromPath(path)
  }

  function install(target, plan, resolver) {
    if (target.__dcModRuntimeInstalled) return target.ModLoader
    plan = plan || { filePaths: new Map(), hooks: [], metadata: [], packages: [], textFiles: new Map() }

    function getText(path) {
      var normalized = Path.normalize(path)
      if (!normalized) return null
      var key = normalized.toLowerCase()
      return plan.textFiles.has(key) ? plan.textFiles.get(key) : null
    }

    function findModPath(path) {
      var normalized = Path.normalize(path)
      return normalized ? plan.filePaths.get(normalized.toLowerCase()) || '' : ''
    }

    function getModConfig(modId) {
      return ConfigStore.readJson(target, modId)
    }

    function setModConfig(modId, value) {
      try { ConfigStore.writeJson(target, modId, value) } catch (error) {
        target.console.warn('[DC mod config]', modId, error)
      }
    }

    var loader = {
      getFileJSON: function (path) {
        var text = getText(path)
        if (text === null) return null
        try { return JSON.parse(text.replace(/^\uFEFF/, '')) } catch (error) { return null }
      },
      getFileText: getText,
      getAsarFileJSON: function (index, path) {
        var text = this.getAsarFileText(index, path)
        if (text === null) return null
        try { return JSON.parse(text.replace(/^\uFEFF/, '')) } catch (error) { return null }
      },
      getAsarFileText: function (index, path) {
        var mod = plan.packages[index]
        return mod ? mod.getText(path) : null
      },
      getFileIndex: function () {
        var index = new Map()
        plan.filePaths.forEach(function (path) {
          var resolved = resolver.resolve(path)
          index.set(path, resolved ? { layerId: resolved.layerId } : null)
        })
        return index
      },
      getModConfig: getModConfig,
      getModList: function () { return Promise.resolve(plan.metadata.slice()) },
      getMods: function () { return plan.metadata.slice() },
      hasFile: function (path) { return Boolean(findModPath(path)) },
      resolveURL: function (path) {
        var modPath = findModPath(path)
        return modPath ? resolver.getObjectUrl(modPath) : path
      },
      setModConfig: setModConfig,
    }
    loader.tryResolveURL = loader.resolveURL

    function readSync(path) {
      var configName = configKey(path)
      if (configName) {
        return ConfigStore.readRaw(target, configName) || ''
      }
      var text = getText(path)
      if (text !== null) return text
      throw new Error('Mod file is not synchronously available: ' + path)
    }

    function existsSync(path) {
      var configName = configKey(path)
      if (configName) {
        return ConfigStore.readRaw(target, configName) !== null
      }
      return getText(path) !== null || resolver.has(path)
    }

    function writeSync(path, value) {
      var configName = configKey(path)
      if (!configName) throw new Error('Mod compatibility writes are limited to plugins/config/*.json')
      ConfigStore.writeRaw(target, configName, value)
    }

    var fileSystem = {
      existsSync: existsSync,
      mkdirSync: function () {},
      readFileSync: readSync,
      readdirSync: function () { return [] },
      writeFileSync: writeSync,
    }
    var pathApi = {
      basename: basename,
      dirname: dirname,
      extname: function (path) {
        var name = basename(path)
        var dot = name.lastIndexOf('.')
        return dot === -1 ? '' : name.slice(dot)
      },
      join: joinPath,
      resolve: joinPath,
    }
    var electronApi = {
      existsSync: existsSync,
      getPath: function () { return '' },
      joinPath: joinPath,
      readFile: function (path) { return Promise.resolve(readSync(path)) },
      readFileSync: readSync,
      writeFile: function (path, value) { writeSync(path, value); return Promise.resolve() },
      writeFileSync: writeSync,
    }

    target.ModLoader = loader
    target.electronAPI = electronApi
    target.require = function (name) {
      if (name === 'fs') return fileSystem
      if (name === 'path') return pathApi
      if (name === 'electron') return {}
      return {}
    }
    if (!target.Buffer) {
      var BufferShim = function (value, encoding) {
        return BufferShim.from(value, encoding)
      }
      BufferShim.prototype = target.Uint8Array.prototype
      BufferShim.from = function (value, encoding) {
        if (typeof value !== 'string') return value
        if (encoding === 'base64') {
          var binary = target.atob(value)
          var bytes = new target.Uint8Array(binary.length)
          for (var index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
          return bytes
        }
        return new target.TextEncoder().encode(value)
      }
      BufferShim.isBuffer = function (value) { return value instanceof BufferShim }
      target.Buffer = BufferShim
    }
    if (target.process) {
      target.process.argv = []
      target.process.cwd = function () { return target.location.href.split('/').slice(0, -1).join('/') }
      target.process.type = 'renderer'
    }

    if (target.document && target.document.documentElement) {
      target.document.documentElement.setAttribute('data-dc-mod-count', String(plan.metadata.length))
      target.document.documentElement.setAttribute('data-dc-mod-hook-state', 'waiting')
    }

    var documentReady = target.document && target.document.readyState === 'loading'
      ? new Promise(function (resolve) {
        target.document.addEventListener('DOMContentLoaded', resolve, { once: true })
      })
      : Promise.resolve()
    loader.ready = documentReady.then(function () {
      var failures = 0
      var root = target.document && target.document.documentElement
      if (root) root.setAttribute('data-dc-mod-hook-state', 'running')
      plan.hooks.forEach(function (hook) {
        try {
          var source = hook.source + '\n//# sourceURL=dc-mod://' + encodeURIComponent(hook.id) + '/hook.js'
          var hookFunction = new target.Function(source)
          hookFunction.call(target)
        } catch (error) {
          failures++
          target.console.error('[DC mod hook]', hook.name, error)
        }
      })
      if (root) {
        root.setAttribute('data-dc-mod-hook-errors', String(failures))
        root.setAttribute('data-dc-mod-hook-state', 'ready')
      }
      return loader
    })
    target.__dcModRuntimeReady = loader.ready
    target.__dcModRuntimeInstalled = true
    return loader
  }

  DCWeb.ModRuntime = { install: install }
})(window)
