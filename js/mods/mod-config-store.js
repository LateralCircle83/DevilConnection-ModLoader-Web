;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var KEY_PREFIX = 'mod_config_'

  function bareName(fileName) {
    return String(fileName || '')
      .replace(/^.*[\\/]/, '')
      .replace(/\.asar$/i, '')
      .replace(/^\d+_/, '')
  }

  function nameFromPath(path) {
    var match = String(path || '')
      .replace(/\\/g, '/')
      .replace(/[?#].*$/, '')
      .match(/(?:^|\/)plugins\/config\/([^/]+)\.json$/i)
    return match ? match[1] : ''
  }

  function keyForName(name) {
    var normalized = String(name || '').trim()
    return normalized ? KEY_PREFIX + normalized : ''
  }

  function readRaw(target, name) {
    var key = keyForName(name)
    if (!key) return null
    try { return target.localStorage.getItem(key) } catch (error) { return null }
  }

  function writeRaw(target, name, value) {
    var key = keyForName(name)
    if (!key) throw new Error('A mod config name is required')
    target.localStorage.setItem(key, String(value))
  }

  function remove(target, name) {
    var key = keyForName(name)
    if (!key) return
    target.localStorage.removeItem(key)
  }

  function readJson(target, name) {
    var raw = readRaw(target, name)
    if (raw === null || raw === '') return null
    try {
      var value = JSON.parse(raw)
      return value && !Array.isArray(value) && typeof value === 'object' ? value : null
    } catch (error) { return null }
  }

  function writeJson(target, name, value) {
    writeRaw(target, name, JSON.stringify(value))
  }

  DCWeb.ModConfigStore = {
    bareName: bareName,
    keyForName: keyForName,
    nameFromPath: nameFromPath,
    readJson: readJson,
    readRaw: readRaw,
    remove: remove,
    writeJson: writeJson,
    writeRaw: writeRaw,
  }
})(window)
