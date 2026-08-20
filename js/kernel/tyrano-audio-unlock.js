;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb || (global.DCWeb = {})
  var GESTURE_TYPES = ['pointerdown', 'touchend', 'keydown']
  var TRACK_MARKER = '__dcAudioUnlockTracked'
  var WRAP_MARKER = '__dcAudioUnlockWrapped'
  var GESTURE_MARKER = '__dcAudioUnlockGestures'

  // 游戏在多个地方各自 new AudioContext()：kag.tmp.audio_context、waapi
  // 无缝循环 BGM 播放器的模块级 context、popopo 插件的 audioContext、以及
  // howler 懒加载的 Howler.ctx。iOS/WebKit 下不在用户手势内创建的上下文都
  // 以 suspended 状态启动，而宿主“开始游戏”的点击不构成 iframe 文档内的
  // 用户激活，旧实现只在启动时 resume Howler.ctx，其余上下文永远无声。
  // 这里包装 AudioContext/webkitAudioContext 构造器跟踪全部实例，在 iframe
  // 内的真实手势（pointerdown/touchend/keydown）里统一 resume，创建时也
  // 顺带尝试一次（Chrome/Firefox 下上下文本就 running，resume 是无害空操作）。
  var liveContexts = []

  function resumeContext(context) {
    if (!context || typeof context.resume !== 'function') return
    if (context.state !== 'suspended') return
    try {
      var result = context.resume()
      if (result && typeof result.catch === 'function') result.catch(function () {})
    } catch (error) {}
  }

  function resumeAll(target) {
    for (var index = 0; index < liveContexts.length; index++) resumeContext(liveContexts[index])
    if (target && target.Howler && target.Howler.ctx) resumeContext(target.Howler.ctx)
    var kag = target && target.TYRANO && target.TYRANO.kag
    if (kag) {
      if (kag.tmp && kag.tmp.audio_context) resumeContext(kag.tmp.audio_context)
      if (kag.popopo && kag.popopo.audioContext) resumeContext(kag.popopo.audioContext)
    }
  }

  function wrapConstructor(target, key) {
    var Native = target[key]
    if (typeof Native !== 'function' || Native[WRAP_MARKER]) return

    function PatchedAudioContext() {
      var instance
      if (typeof Reflect === 'object' && typeof Reflect.construct === 'function') {
        instance = Reflect.construct(Native, Array.prototype.slice.call(arguments), PatchedAudioContext)
      } else {
        instance = new Native(Array.prototype.slice.call(arguments)[0])
      }
      if (instance && instance[TRACK_MARKER] !== true) {
        try { Object.defineProperty(instance, TRACK_MARKER, { value: true }) } catch (error) {}
        liveContexts.push(instance)
        resumeContext(instance)
      }
      return instance
    }
    PatchedAudioContext.prototype = Native.prototype
    Object.defineProperty(PatchedAudioContext, WRAP_MARKER, { value: true })
    try {
      Object.defineProperty(target, key, { configurable: true, writable: true, value: PatchedAudioContext })
    } catch (error) {}
  }

  function installGestures(target, doc) {
    if (!doc || doc[GESTURE_MARKER]) return
    try { Object.defineProperty(doc, GESTURE_MARKER, { value: true }) } catch (error) {}

    var unlock = function () { resumeAll(target) }
    GESTURE_TYPES.forEach(function (type) {
      if (typeof doc.addEventListener === 'function') doc.addEventListener(type, unlock, { passive: true })
    })
    var win = doc.defaultView || target
    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('pagehide', function () {
        GESTURE_TYPES.forEach(function (type) {
          if (typeof doc.removeEventListener === 'function') doc.removeEventListener(type, unlock)
        })
        liveContexts.length = 0
      }, { once: true })
    }
  }

  function install(target) {
    if (!target || typeof target !== 'object') return false
    if (target.AudioContext) wrapConstructor(target, 'AudioContext')
    if (target.webkitAudioContext) wrapConstructor(target, 'webkitAudioContext')
    installGestures(target, target.document)
    resumeAll(target)
    return Boolean(target.AudioContext || target.webkitAudioContext)
  }

  DCWeb.TyranoAudioUnlock = {
    install: install,
    resumeAll: resumeAll,
    resumeContext: resumeContext,
  }
})(typeof window !== 'undefined' ? window : globalThis)
