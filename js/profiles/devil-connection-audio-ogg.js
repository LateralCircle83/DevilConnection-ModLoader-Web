;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var REWRITE_SIGNATURE = "        (storage = $.replaceAll(storage, '.ogg', '.m4a')))"
  var CONDITION_SIGNATURE = "      (('msie' != browser && 'safari' != browser && 'edge' != browser) ||"
  var KEEP_OGG_MARKER = 'DCWeb keep-ogg'

  function transform(source) {
    var guardLine =
      "        (storage = $.replaceAll(storage, '.ogg', '.ogg'))) // " + KEEP_OGG_MARKER
    if (source.indexOf(REWRITE_SIGNATURE) === -1) throw new Error('Safari OGG 改写源码行未匹配')
    return source.replace(REWRITE_SIGNATURE, guardLine)
  }

  DCWeb.DevilConnectionAudioOggPatch = {
    description: '移除旧 Tyrano 按 UA 将 .ogg 无条件改写为 .m4a 的逻辑；归档中没有 M4A，Safari 与 iOS 浏览器会因此全部无声',
    failure: 'warn-and-continue',
    id: 'devil-connection-audio-ogg-compat',
    name: 'Safari/WebKit OGG 音频兼容',
    required: true,
    signatures: [
      { count: 1, name: '音频格式改写条件', text: CONDITION_SIGNATURE },
      { count: 1, name: '音频格式改写动作', text: REWRITE_SIGNATURE },
      { count: 0, name: 'OGG 音频补丁标记', text: KEEP_OGG_MARKER },
    ],
    target: 'tyrano/plugins/kag/kag.tag_audio.js',
    transform: transform,
  }
})(window)
