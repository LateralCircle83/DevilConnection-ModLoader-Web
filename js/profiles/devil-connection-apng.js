;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var RESULT_SIGNATURE = 'return new APNG().load(blob).then(([frames, iterations]) => {'
  var BINARY_SIGNATURE = 'const bytes = new Uint8Array(blob.buffer)'
  var PLAYER_SIGNATURE = 'function playAPNG(apng, canvas, x, y, w, h, reversed, onFinish, onTick) {'

  function transform(source) {
    var guardedResult = [
      'return new APNG().load(blob).then(result => {',
      '    if (!result) return { frames: [], images: [], delays: [] }',
      '    const [frames, iterations] = result',
    ].join('\n')
    var transformed = source.split(RESULT_SIGNATURE).join(guardedResult)
    transformed = transformed.replace(BINARY_SIGNATURE, [
      '// Electron passes a Buffer here; browser mode passes an ArrayBuffer.',
      '      const bytes = ArrayBuffer.isView(blob)',
      '        ? new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength)',
      '        : new Uint8Array(blob)',
    ].join('\n'))

    var playerStart = transformed.indexOf(PLAYER_SIGNATURE) + PLAYER_SIGNATURE.length
    return transformed.slice(0, playerStart) + [
      '',
      '  if (!apng || !apng.images || apng.images.length === 0) {',
      '    if (onFinish) onFinish()',
      '    return',
      '  }',
    ].join('\n') + transformed.slice(playerStart)
  }

  DCWeb.DevilConnectionApngPatch = {
    description: '修正 APNG 二进制输入、空解码结果与空帧播放行为。',
    failure: 'abort-session',
    id: 'devil-connection-apng-browser-compat',
    name: 'APNG 浏览器兼容',
    required: true,
    signatures: [
      { count: 2, name: 'APNG 解码结果', text: RESULT_SIGNATURE },
      { count: 1, name: 'APNG 二进制输入', text: BINARY_SIGNATURE },
      { count: 1, name: 'APNG 播放入口', text: PLAYER_SIGNATURE },
    ],
    target: 'tyrano/libs/apng.js',
    transform: transform,
  }
})(window)
