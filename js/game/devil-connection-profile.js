;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var Path = DCWeb.ResourcePath
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

  async function prepareApngWorker(resolver) {
    var path = 'tyrano/libs/apng.js'
    if (!resolver.has(path)) return
    var source = await resolver.readText(path)
    var callbackStart = 'return new APNG().load(blob).then(([frames, iterations]) => {'
    if (source.split(callbackStart).length - 1 !== 2) {
      throw new Error('The APNG result compatibility patch no longer matches this game version')
    }
    var guardedStart = [
      'return new APNG().load(blob).then(result => {',
      '    if (!result) return { frames: [], images: [], delays: [] }',
      '    const [frames, iterations] = result',
    ].join('\n')
    var patched = source.split(callbackStart).join(guardedStart)

    var byteViewStart = 'const bytes = new Uint8Array(blob.buffer)'
    if (patched.indexOf(byteViewStart) === -1) {
      throw new Error('The APNG binary compatibility patch no longer matches this game version')
    }
    patched = patched.replace(byteViewStart, [
      '// Electron passes a Buffer here; browser mode passes an ArrayBuffer.',
      '      const bytes = ArrayBuffer.isView(blob)',
      '        ? new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength)',
      '        : new Uint8Array(blob)',
    ].join('\n'))

    var playerStart = 'function playAPNG(apng, canvas, x, y, w, h, reversed, onFinish, onTick) {'
    var playerStartIndex = patched.indexOf(playerStart)
    if (playerStartIndex === -1) {
      throw new Error('The APNG playback compatibility patch no longer matches this game version')
    }
    var playerBodyIndex = playerStartIndex + playerStart.length
    patched = patched.slice(0, playerBodyIndex) + [
      '',
      '  if (!apng || !apng.images || apng.images.length === 0) {',
      '    if (onFinish) onFinish()',
      '    return',
      '  }',
    ].join('\n') + patched.slice(playerBodyIndex)

    resolver.prepareText(path, patched, Path.mimeForPath(path))
  }

  async function readTitle(resolver) {
    try { return parseGameTitle(await resolver.readText('data/system/Config.tjs')) } catch (error) { return '' }
  }

  DCWeb.DevilConnectionProfile = {
    id: 'devil-connection',
    parseGameTitle: parseGameTitle,
    prepare: prepareApngWorker,
    readTitle: readTitle,
    requiredFiles: REQUIRED_FILES.slice(),
    validate: validate,
  }
})(window)
