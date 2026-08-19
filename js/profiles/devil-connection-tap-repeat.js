;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var TAP_MARKER = 'DCWeb tap-repeat'

  function insertTapRepeat(source, clickableLine) {
    var newline = source.indexOf('\r\n') !== -1 ? '\r\n' : '\n'
    var index = source.indexOf(clickableLine)
    if (index === -1) throw new Error('连点 clickable 行未匹配')
    var iscript = [
      '[iscript]',
      '// ' + TAP_MARKER,
      '(function () {',
      '  var kag = TYRANO && TYRANO.kag',
      '  var free = kag && kag.layer.getFreeLayer()',
      '  var button = free && free.children().last()',
      "  if (!button || !button[0] || typeof button[0].addEventListener !== 'function') return",
      "  button[0].addEventListener('touchend', function (event) {",
      '    if (event.cancelable !== false) event.preventDefault()',
      "    button.trigger('click')",
      '  }, { passive: false })',
      '})()',
      '[endscript]',
    ].join(newline)
    return source.slice(0, index) + clickableLine + newline + iscript + source.slice(index + clickableLine.length)
  }

  DCWeb.DevilConnectionNeoTapPatch = {
    description:
      '安卓端对快速连点会取消浏览器合成 click，使 NEO 魔力放出连打互动丢点击；在该处 clickable 按钮上以 touchend 直触发游戏 click 处理，保持逐次命中。',
    failure: 'warn-and-continue',
    id: 'devil-connection-neo-tap-repeat',
    name: 'NEO 魔力放出连点兼容',
    required: true,
    signatures: [
      {
        count: 1,
        name: 'NEO 连打 clickable',
        text:
          '[clickable  storage="Chapter4_2kuitomeru.ks"  x="190"  y="5"  width="902"  height="709"  target="*da"  cm="false"  _clickable_img=""  ]',
      },
      { count: 0, name: '连点补丁标记', text: TAP_MARKER },
    ],
    target: 'data/scenario/Chapter4_2kuitomeru.ks',
    transform: function (source) {
      return insertTapRepeat(
        source,
        '[clickable  storage="Chapter4_2kuitomeru.ks"  x="190"  y="5"  width="902"  height="709"  target="*da"  cm="false"  _clickable_img=""  ]',
      )
    },
  }

  DCWeb.DevilConnectionYumeKupyaTapPatch = {
    description:
      '安卓端对快速连点会取消浏览器合成 click，使梦之库皮亚的 3 秒限时连打互动丢点击；在该处 clickable 按钮上以 touchend 直触发游戏 click 处理，保持逐次命中。',
    failure: 'warn-and-continue',
    id: 'devil-connection-yume-kupya-tap-repeat',
    name: '梦之库皮亚连点兼容',
    required: true,
    signatures: [
      {
        count: 1,
        name: '梦之库皮亚连打 clickable',
        text:
          '[clickable  storage="omake_yume_kupya.ks"  width="650"  height="708"  x="323"  y="6"  target="*da"  cm="false"  _clickable_img=""  ]',
      },
      { count: 0, name: '连点补丁标记', text: TAP_MARKER },
    ],
    target: 'data/scenario/omake_yume_kupya.ks',
    transform: function (source) {
      return insertTapRepeat(
        source,
        '[clickable  storage="omake_yume_kupya.ks"  width="650"  height="708"  x="323"  y="6"  target="*da"  cm="false"  _clickable_img=""  ]',
      )
    },
  }
})(window)
