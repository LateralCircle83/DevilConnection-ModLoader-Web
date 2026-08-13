;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb

  function countObjectUrls(value) {
    return (String(value || '').match(/blob(?::|%3a|%253a)/gi) || []).length
  }

  function install(target, $, vfs) {
    var storage = target.api.storage

    function serialize(value) {
      var restoredUrlCount = 0
      var serialized = JSON.stringify(value, function (key, item) {
        if (typeof item !== 'string') return item
        var restored = vfs.restoreObjectUrls(item)
        if (restored !== item) restoredUrlCount += countObjectUrls(item) - countObjectUrls(restored)
        return restored
      })
      var root = target.document && target.document.documentElement
      if (root) {
        root.setAttribute('data-dc-save-restored-urls', String(restoredUrlCount))
        root.setAttribute('data-dc-save-unmapped-urls', String(countObjectUrls(serialized)))
      }
      return serialized
    }

    $.setStorageWeb = function (key, value) {
      storage.setItem(key, encodeURIComponent(serialize(value)))
    }
    $.getStorageWeb = function (key) {
      var raw = storage.getItem(key)
      if (raw === null || raw === 'null') return null
      try { return decodeURIComponent(raw) } catch (error) { return unescape(raw) }
    }
    $.setStorageCompress = function (key, value) {
      var encoded = encodeURIComponent(serialize(value))
      storage.setItem(key, target.LZString ? target.LZString.compress(encoded) : encoded)
    }
    $.getStorageCompress = function (key) {
      var raw = storage.getItem(key)
      if (raw === null || raw === 'null') return null
      var decoded = target.LZString ? target.LZString.decompress(raw) || raw : raw
      try { return decodeURIComponent(decoded) } catch (error) { return unescape(decoded) }
    }
    $.setStorageFile = $.setStorageWeb
    $.getStorageFile = $.getStorageWeb
    $.clearStorage = function (type, key) {
      if (key) storage.removeItem(key)
      else storage.clear()
    }
  }

  DCWeb.TyranoSaveAdapter = { install: install }
})(window)
