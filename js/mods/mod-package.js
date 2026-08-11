;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var Path = DCWeb.ResourcePath
  var TEXT_EXTENSIONS = {
    '.css': true,
    '.html': true,
    '.js': true,
    '.json': true,
    '.ks': true,
    '.md': true,
    '.mjs': true,
    '.tjs': true,
    '.txt': true,
  }

  function cleanId(value, fallbackIndex) {
    var id = String(value || '')
      .replace(/\.asar$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    return id || 'local-mod-' + fallbackIndex
  }

  function textValue(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback
    return String(value)
  }

  function ModPackage(file, archive, manifest, fallbackIndex) {
    this.file = file
    this.archive = archive
    this.manifest = manifest
    this.id = cleanId(manifest.id || file.name, fallbackIndex)
    this.name = textValue(manifest.name, file.name.replace(/\.asar$/i, ''))
    this.description = textValue(manifest.description, '本地导入的 DCML 模组')
    this.version = textValue(manifest.displayVersion, textValue(manifest.version, '--'))
    this.enabled = true
    this.hasHook = archive.has('hook.js')
    this.hasConfig = archive.has('config.schema.json')
    this.textFiles = new Map()
    this.runtimeReady = null
  }

  ModPackage.open = async function (file, fallbackIndex) {
    if (!file || !/\.asar$/i.test(file.name || '')) throw new Error('请选择 .asar 模组文件')
    var archive = await DCWeb.AsarArchive.open(file)
    var manifest = {}
    if (archive.has('mods.json')) {
      try {
        manifest = JSON.parse((await archive.readText('mods.json')).replace(/^\uFEFF/, ''))
      } catch (error) {
        throw new Error(file.name + ' 的 mods.json 无法解析')
      }
      if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') {
        throw new Error(file.name + ' 的 mods.json 格式无效')
      }
    }
    return new ModPackage(file, archive, manifest, fallbackIndex || 1)
  }

  ModPackage.prototype.prepareRuntime = function () {
    if (this.runtimeReady) return this.runtimeReady
    var mod = this
    var paths = this.archive.list().filter(function (path) {
      return Boolean(TEXT_EXTENSIONS[Path.extensionOf(path)])
    })

    this.runtimeReady = (async function () {
      for (var offset = 0; offset < paths.length; offset += 8) {
        await Promise.all(paths.slice(offset, offset + 8).map(async function (path) {
          var text = await mod.archive.readTextByPath(path)
          mod.textFiles.set(path.toLowerCase(), text)
        }))
      }
      return mod
    })()
    return this.runtimeReady
  }

  ModPackage.prototype.getText = function (path) {
    var normalized = Path.normalize(path)
    if (!normalized) return null
    var key = normalized.toLowerCase()
    return this.textFiles.has(key) ? this.textFiles.get(key) : null
  }

  ModPackage.prototype.toLayer = function () {
    return { id: 'mod:' + this.id, kind: 'mod', source: this.archive }
  }

  ModPackage.prototype.toViewModel = function () {
    return {
      description: this.description,
      enabled: this.enabled,
      fileName: this.file.name,
      hasConfig: this.hasConfig,
      hasHook: this.hasHook,
      id: this.id,
      name: this.name,
      size: this.file.size,
      version: this.version,
    }
  }

  DCWeb.ModPackage = ModPackage
})(window)
