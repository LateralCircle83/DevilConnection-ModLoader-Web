;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var REQUIRED_FILES = [
    'index.html',
    'package.json',
    'tyrano/tyrano.js',
    'tyrano/plugins/kag/kag.js',
    'data/system/Config.tjs',
  ]

  function parseGameTitle(source) {
    var match = String(source || '').replace(/^\uFEFF/, '').match(/^\s*;?\s*System\.title\s*=\s*(.*?)\s*$/im)
    if (!match) return ''
    var title = match[1].trim()
    if (title.length > 1 && ((title[0] === '"' && title[title.length - 1] === '"') || (title[0] === "'" && title[title.length - 1] === "'"))) {
      title = title.slice(1, -1)
    }
    return title.trim()
  }

  async function validate(resolver) {
    var missing = REQUIRED_FILES.filter(function (path) { return !resolver.has(path) })
    if (missing.length) throw new Error('缺少游戏文件：' + missing.join(', '))

    var packageJson
    try { packageJson = JSON.parse(await resolver.readText('package.json')) } catch (error) {
      throw new Error('无法读取游戏 package.json')
    }
    if (packageJson.name !== 'devil-connection') {
      throw new Error('这个 ASAR 不是受支持的 Devil Connection 游戏归档')
    }
    return packageJson
  }

  async function readTitle(resolver) {
    try { return parseGameTitle(await resolver.readText('data/system/Config.tjs')) } catch (error) { return '' }
  }

  DCWeb.DevilConnectionProfile = {
    id: 'devil-connection',
    name: 'Devil Connection',
    patches: [
      DCWeb.DevilConnectionApngPatch,
      DCWeb.DevilConnectionKiriVideoPatch,
      DCWeb.DevilConnectionEffectVideoPatch,
      DCWeb.DevilConnectionRemodalPatch,
      DCWeb.DevilConnectionCollectionScrollPatch,
      DCWeb.DevilConnectionTitleLoopPatch,
    ],
    parseGameTitle: parseGameTitle,
    readTitle: readTitle,
    requiredFiles: REQUIRED_FILES.slice(),
    validate: validate,
  }
})(window)
