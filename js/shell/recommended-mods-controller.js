;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var CATALOG_URL = './recommended-mods/catalog.json'
  var MAX_ITEMS = 100
  var FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}\.asar$/
  var ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
  var EXTERNAL_DOWNLOAD_HOSTS = {
    'github.com': true,
    'raw.githubusercontent.com': true,
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  }

  function requiredText(item, key, maxLength, index) {
    var value = typeof item[key] === 'string' ? item[key].trim() : ''
    if (!value || value.length > maxLength) {
      throw new Error('推荐模组清单第 ' + (index + 1) + ' 项的 ' + key + ' 无效')
    }
    return value
  }

  function optionalText(item, key, maxLength, index) {
    if (item[key] === undefined || item[key] === null || item[key] === '') return ''
    if (typeof item[key] !== 'string') {
      throw new Error('推荐模组清单第 ' + (index + 1) + ' 项的 ' + key + ' 无效')
    }
    var value = item[key].trim()
    if (value.length > maxLength) {
      throw new Error('推荐模组清单第 ' + (index + 1) + ' 项的 ' + key + ' 无效')
    }
    return value
  }

  function normalizeDownload(file, baseUrl, URLClass, index) {
    if (FILE_NAME_PATTERN.test(file)) {
      return {
        downloadUrl: new URLClass('./recommended-mods/' + file, baseUrl).href,
        external: false,
        fileName: file,
      }
    }

    var parsed
    try { parsed = new URLClass(file) } catch (error) {
      throw new Error('推荐模组清单第 ' + (index + 1) + ' 项的 file 无效')
    }
    var pathParts = parsed.pathname.split('/')
    var fileName = pathParts[pathParts.length - 1]
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !EXTERNAL_DOWNLOAD_HOSTS[parsed.hostname] ||
      !FILE_NAME_PATTERN.test(fileName)
    ) {
      throw new Error('推荐模组清单第 ' + (index + 1) + ' 项的 file 无效')
    }
    return { downloadUrl: parsed.href, external: true, fileName: fileName }
  }

  function normalizeCatalog(value, baseUrl, URLConstructor) {
    if (!isPlainObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.mods)) {
      throw new Error('推荐模组清单格式不受支持')
    }
    if (value.mods.length > MAX_ITEMS) throw new Error('推荐模组清单项目过多')

    var ids = Object.create(null)
    var files = Object.create(null)
    var URLClass = URLConstructor || global.URL
    var normalized = value.mods.map(function (item, index) {
      if (!isPlainObject(item)) throw new Error('推荐模组清单第 ' + (index + 1) + ' 项无效')
      var id = requiredText(item, 'id', 64, index)
      var file = requiredText(item, 'file', 2048, index)
      if (!ID_PATTERN.test(id)) throw new Error('推荐模组清单第 ' + (index + 1) + ' 项的 id 无效')
      var download = normalizeDownload(file, baseUrl, URLClass, index)
      if (item.size !== undefined && (!Number.isSafeInteger(item.size) || item.size <= 0)) {
        throw new Error('推荐模组清单第 ' + (index + 1) + ' 项的 size 无效')
      }
      if (ids[id]) throw new Error('推荐模组清单包含重复 id：' + id)
      if (files[download.fileName]) throw new Error('推荐模组清单包含重复文件：' + download.fileName)
      ids[id] = true
      files[download.fileName] = true
      return Object.freeze({
        author: optionalText(item, 'author', 100, index),
        description: optionalText(item, 'description', 400, index),
        downloadUrl: download.downloadUrl,
        external: download.external,
        fileName: download.fileName,
        id: id,
        name: requiredText(item, 'name', 100, index),
        size: item.size || 0,
        version: optionalText(item, 'version', 50, index),
      })
    })
    return Object.freeze(normalized)
  }

  function RecommendedModsController(target, view, catalogUrl) {
    this.global = target
    this.view = view
    this.catalogUrl = catalogUrl || CATALOG_URL
    this.state = 'idle'
    this.pending = null
  }

  RecommendedModsController.prototype.bind = function () {
    var controller = this
    this.view.onRecommendedModsRequested(function (force) {
      controller.load(Boolean(force))
    })
  }

  RecommendedModsController.prototype.load = function (force) {
    if (this.state === 'ready' && !force) return Promise.resolve()
    if (this.pending) return this.pending

    var controller = this
    var fetchMethod = this.global.fetch
    this.state = 'loading'
    this.view.renderRecommendedMods({ state: 'loading' })
    if (typeof fetchMethod !== 'function') {
      this.state = 'failed'
      this.view.renderRecommendedMods({ state: 'failed', message: '当前浏览器无法读取推荐模组清单' })
      return Promise.resolve()
    }

    this.pending = fetchMethod.call(this.global, this.catalogUrl, {
      cache: 'no-store',
      credentials: 'same-origin',
    }).then(function (response) {
      if (!response || !response.ok) {
        throw new Error('推荐模组清单请求失败：HTTP ' + (response ? response.status : 0))
      }
      return response.json()
    }).then(function (catalog) {
      var mods = normalizeCatalog(catalog, controller.global.document.baseURI, controller.global.URL)
      controller.state = 'ready'
      controller.view.renderRecommendedMods({ mods: mods, state: 'ready' })
    }).catch(function (error) {
      controller.state = 'failed'
      controller.view.renderRecommendedMods({ state: 'failed', message: error.message || String(error) })
      if (controller.global.console && controller.global.console.warn) {
        controller.global.console.warn('[DC recommended mods]', error)
      }
    }).finally(function () {
      controller.pending = null
    })
    return this.pending
  }

  DCWeb.RecommendedModsController = RecommendedModsController
  DCWeb.RecommendedModsCatalog = {
    catalogUrl: CATALOG_URL,
    normalize: normalizeCatalog,
  }
})(window)
