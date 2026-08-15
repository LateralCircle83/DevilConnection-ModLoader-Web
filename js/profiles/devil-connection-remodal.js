;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var SCRIPT_ID = 'dc-profile-remodal-scaler'
  var BODY_CLOSE = '</body>'

  function installRemodalScaler(global) {
    'use strict'

    var INSTALL_KEY = '__dcRemodalScaleHook'
    var EVENT_NAMESPACE = '.dcRemodalScale'
    var FRAME_CLASS = 'dc-remodal-scale-frame'
    var WRAPPER_STATE_KEY = '__dcRemodalScaleState'
    var DESIGN_WIDTH = 700
    var SETTLE_DELAY_MS = 250
    var targetDocument = global.document
    var $ = global.jQuery || global.$

    if (global[INSTALL_KEY]) {
      global[INSTALL_KEY].refresh()
      return
    }

    if (!targetDocument || typeof $ !== 'function') {
      if (global.console && global.console.warn) {
        global.console.warn('[DC remodal scale] Remodal profile patch requires jQuery')
      }
      return
    }

    var scheduledFrame = 0
    var settleTimer = 0
    var visualViewport = global.visualViewport || null
    var modalObserver = null

    function finitePositive(value) {
      var number = Number(value)
      return isFinite(number) && number > 0 ? number : 0
    }

    function currentScale() {
      var tyranoScale = finitePositive(
        global.TYRANO &&
        global.TYRANO.kag &&
        global.TYRANO.kag.tmp &&
        global.TYRANO.kag.tmp.base_scale
      )
      if (tyranoScale) return tyranoScale

      var scaleContainer = targetDocument.getElementById && targetDocument.getElementById('scale_container')
      if (scaleContainer && scaleContainer.getBoundingClientRect && scaleContainer.offsetWidth) {
        var bounds = scaleContainer.getBoundingClientRect()
        var measuredScale = finitePositive(bounds.width / scaleContainer.offsetWidth)
        if (measuredScale) return measuredScale
      }
      return 1
    }

    function viewportGeometry() {
      var height = visualViewport && finitePositive(visualViewport.height)
      if (!height) height = finitePositive(global.innerHeight)
      if (!height && targetDocument.documentElement) {
        height = finitePositive(targetDocument.documentElement.clientHeight)
      }
      return {
        height: height || 1,
        top: visualViewport ? Number(visualViewport.offsetTop) || 0 : 0,
      }
    }

    function rememberWrapper(wrapper) {
      if (wrapper[WRAPPER_STATE_KEY]) return
      wrapper[WRAPPER_STATE_KEY] = {
        bottom: wrapper.style.bottom,
        height: wrapper.style.height,
        top: wrapper.style.top,
      }
    }

    function updateFrame(frame) {
      if (!frame || !frame.parentNode) return
      var wrapper = frame.parentNode
      var viewport = viewportGeometry()
      rememberWrapper(wrapper)
      wrapper.style.top = viewport.top + 'px'
      wrapper.style.bottom = 'auto'
      wrapper.style.height = viewport.height + 'px'
      frame.style.transform = 'translate(-50%, -50%) scale(' + currentScale() + ')'
    }

    function mount(modal) {
      if (!modal || !modal.parentNode) return
      if (modal.parentNode.classList && modal.parentNode.classList.contains(FRAME_CLASS)) {
        updateFrame(modal.parentNode)
        return
      }

      var wrapper = modal.parentNode
      if (!wrapper.classList || !wrapper.classList.contains('remodal-wrapper')) return
      rememberWrapper(wrapper)

      var frame = targetDocument.createElement('div')
      frame.className = FRAME_CLASS
      frame.style.position = 'absolute'
      frame.style.left = '50%'
      frame.style.top = '50%'
      frame.style.transformOrigin = 'center center'
      frame.style.width = DESIGN_WIDTH + 'px'
      wrapper.insertBefore(frame, modal)
      frame.appendChild(modal)
      updateFrame(frame)
    }

    function restoreWrapper(wrapper) {
      var state = wrapper && wrapper[WRAPPER_STATE_KEY]
      if (!state) return
      wrapper.style.bottom = state.bottom
      wrapper.style.height = state.height
      wrapper.style.top = state.top
      delete wrapper[WRAPPER_STATE_KEY]
    }

    function unmount(modal) {
      if (!modal || !modal.parentNode) return
      var frame = modal.parentNode
      if (!frame.classList || !frame.classList.contains(FRAME_CLASS)) return
      var wrapper = frame.parentNode
      if (!wrapper) return
      wrapper.insertBefore(modal, frame)
      wrapper.removeChild(frame)
      restoreWrapper(wrapper)
      if (!targetDocument.querySelector('.' + FRAME_CLASS)) cancelRefresh()
    }

    function refresh() {
      bindModals(targetDocument)
      var frames = targetDocument.querySelectorAll('.' + FRAME_CLASS)
      Array.prototype.forEach.call(frames, updateFrame)
    }

    function bindModal(modal) {
      $(modal)
        .off(EVENT_NAMESPACE)
        .on('opening' + EVENT_NAMESPACE + ' opened' + EVENT_NAMESPACE, function () {
          mount(this)
        })
        .on('closed' + EVENT_NAMESPACE, function () {
          unmount(this)
        })
    }

    function bindModals(root) {
      if (!root) return
      if (root.matches && root.matches('.remodal')) bindModal(root)
      if (!root.querySelectorAll) return
      var modals = root.querySelectorAll('.remodal')
      Array.prototype.forEach.call(modals, bindModal)
    }

    function scheduleRefresh() {
      if (!scheduledFrame) {
        var requestFrame = global.requestAnimationFrame || function (callback) {
          return global.setTimeout(callback, 0)
        }
        scheduledFrame = requestFrame(function () {
          scheduledFrame = 0
          refresh()
        })
      }
      if (settleTimer) global.clearTimeout(settleTimer)
      settleTimer = global.setTimeout(function () {
        settleTimer = 0
        refresh()
      }, SETTLE_DELAY_MS)
    }

    function cancelRefresh() {
      if (scheduledFrame) {
        var cancelFrame = global.cancelAnimationFrame || global.clearTimeout
        cancelFrame.call(global, scheduledFrame)
        scheduledFrame = 0
      }
      if (settleTimer) {
        global.clearTimeout(settleTimer)
        settleTimer = 0
      }
    }

    function cleanup() {
      cancelRefresh()
      $('.remodal').off(EVENT_NAMESPACE)
      if (modalObserver) {
        modalObserver.disconnect()
        modalObserver = null
      }
      global.removeEventListener('resize', scheduleRefresh)
      global.removeEventListener('orientationchange', scheduleRefresh)
      global.removeEventListener('pagehide', cleanup)
      if (visualViewport) {
        visualViewport.removeEventListener('resize', scheduleRefresh)
        visualViewport.removeEventListener('scroll', scheduleRefresh)
      }
      var frames = targetDocument.querySelectorAll('.' + FRAME_CLASS)
      Array.prototype.forEach.call(frames, function (frame) {
        if (frame.firstElementChild) unmount(frame.firstElementChild)
      })
      delete global[INSTALL_KEY]
    }

    bindModals(targetDocument)
    if (global.MutationObserver && targetDocument.body) {
      modalObserver = new global.MutationObserver(function (records) {
        records.forEach(function (record) {
          Array.prototype.forEach.call(record.addedNodes || [], bindModals)
        })
      })
      modalObserver.observe(targetDocument.body, { childList: true, subtree: true })
    }

    global.addEventListener('resize', scheduleRefresh)
    global.addEventListener('orientationchange', scheduleRefresh)
    global.addEventListener('pagehide', cleanup, { once: true })
    if (visualViewport) {
      visualViewport.addEventListener('resize', scheduleRefresh)
      visualViewport.addEventListener('scroll', scheduleRefresh)
    }

    global[INSTALL_KEY] = {
      cleanup: cleanup,
      refresh: refresh,
    }

    $('.remodal.remodal-is-opening, .remodal.remodal-is-opened').each(function () {
      mount(this)
    })
  }

  function runtimeSource() {
    return ';(' + installRemodalScaler.toString() + ')(window)'
  }

  function transform(source) {
    var script = [
      '    <script id="' + SCRIPT_ID + '">',
      runtimeSource(),
      '    </script>',
      '  ',
    ].join('\n')
    return source.replace(BODY_CLOSE, script + BODY_CLOSE)
  }

  DCWeb.DevilConnectionRemodalPatch = {
    description: '保持原版 Remodal 弹窗在浏览器视口中按 Tyrano 游戏坐标等比缩放',
    failure: 'abort-session',
    id: 'devil-connection-remodal-browser-scale',
    name: 'Remodal 浏览器缩放兼容',
    required: true,
    signatures: [
      {
        name: 'Remodal 运行时依赖',
        text: '<script src="./tyrano/libs/remodal/remodal.js"></script>',
        count: 1,
      },
      {
        name: '原版 Remodal 弹窗',
        text: 'data-remodal-id="modal"',
        count: 1,
      },
      {
        name: '原版 Remodal 确认按钮',
        text: 'data-remodal-action="confirm" class="remodal-confirm"',
        count: 1,
      },
      {
        name: '页面结束标记',
        text: BODY_CLOSE,
        count: 1,
      },
      {
        name: 'Remodal 补丁标记',
        text: 'id="' + SCRIPT_ID + '"',
        count: 0,
      },
    ],
    target: 'index.html',
    transform: transform,
  }
})(window)
