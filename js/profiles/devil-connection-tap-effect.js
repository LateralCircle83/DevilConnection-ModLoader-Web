;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var MARKER = 'DCWeb tap-effect coordinate guard'
  var X_SIGNATURE = '        const x = e.clientX || e.targetTouches[0].clientX'
  var Y_SIGNATURE = '        const y = e.clientY || e.targetTouches[0].clientY'

  // 游戏自带 tap_effect 插件在 body 上委托 mousedown/touchstart 读取点击坐标：
  // `e.clientX || e.targetTouches[0].clientX`。Firefox 对键盘激活（Enter/Space）
  // 会合成 clientX=0 的 mousedown 序列（Chrome 只发 click），此时 0 为假值，
  // 继续读 e.targetTouches[0] 抛 TypeError，事件处理器崩溃还会中断该次分发中
  // 后续的 jQuery 处理器。这里把坐标读取改为对非触摸事件完全防御的写法：
  // 优先 clientX，其次触摸坐标，最后回退 0，任何事件类型都不再抛错。
  function transform(source) {
    var newline = source.indexOf('\r\n') !== -1 ? '\r\n' : '\n'
    var xIndex = source.indexOf(X_SIGNATURE)
    var yIndex = source.indexOf(Y_SIGNATURE)
    if (xIndex === -1 || yIndex === -1 || xIndex > yIndex) {
      throw new Error('tap_effect 坐标读取行未匹配')
    }
    var guarded = [
      '        // ' + MARKER,
      '        const touch = e.targetTouches && e.targetTouches[0]',
      '        const x = e.clientX || (touch && touch.clientX) || 0',
      '        const y = e.clientY || (touch && touch.clientY) || 0',
    ].join(newline)
    var yEnd = yIndex + Y_SIGNATURE.length
    return source.slice(0, xIndex) + guarded + source.slice(yEnd)
  }

  DCWeb.DevilConnectionTapEffectPatch = {
    description:
      'tap_effect 的 body 级 mousedown/touchstart 坐标读取对非触摸事件没有防御：Firefox 键盘激活合成 clientX=0 的 mousedown 时会读 e.targetTouches[0] 抛 TypeError 并中断该次分发。补丁把坐标读取改为优先 clientX、其次触摸坐标、最后回退 0，任何事件类型都不再抛错，波纹效果与对话点击行为不变。',
    failure: 'warn-and-continue',
    id: 'devil-connection-tap-effect-coordinate-guard',
    name: 'tap_effect 坐标读取防御',
    required: true,
    signatures: [
      { count: 1, name: 'tap_effect 横向坐标读取', text: X_SIGNATURE },
      { count: 1, name: 'tap_effect 纵向坐标读取', text: Y_SIGNATURE },
      { count: 0, name: 'tap_effect 坐标补丁标记', text: MARKER },
    ],
    target: 'data/others/plugin/tap_effect/main.js',
    transform: transform,
  }
})(window)
