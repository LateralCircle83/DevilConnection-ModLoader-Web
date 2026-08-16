'use strict'

const assert = require('node:assert/strict')
const vm = require('node:vm')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')
require('../js/profiles/profile-runner.js')
require('../js/profiles/devil-connection-remodal.js')

const patch = window.DCWeb.DevilConnectionRemodalPatch

function supportedIndex() {
  return [
    '<!doctype html>',
    '<html>',
    '<head><script src="./tyrano/libs/remodal/remodal.js"></script></head>',
    '<body>',
    '<div class="remodal" data-remodal-id="modal">',
    '<button data-remodal-action="confirm" class="remodal-confirm">OK</button>',
    '</div>',
    '</body>',
    '</html>',
  ].join('\n')
}

function injectedRuntime() {
  const transformed = patch.transform(supportedIndex())
  const marker = transformed.match(/<script id="dc-profile-remodal-scaler">([\s\S]*?)<\/script>/)
  assert.ok(marker)
  assert.equal((transformed.match(/id="dc-profile-remodal-scaler"/g) || []).length, 1)
  assert.equal(transformed.indexOf('dc-profile-remodal-scaler') < transformed.indexOf('</body>'), true)
  return marker[1]
}

function createClassList(node) {
  return {
    contains(name) {
      return String(node.className || '').split(/\s+/).includes(name)
    },
  }
}

function createNode(className) {
  const node = {
    children: [],
    className: className || '',
    jqueryHandlers: new Map(),
    parentNode: null,
    style: {},
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child)
      this.children.push(child)
      child.parentNode = this
      return child
    },
    insertBefore(child, reference) {
      if (child.parentNode) child.parentNode.removeChild(child)
      const index = this.children.indexOf(reference)
      this.children.splice(index === -1 ? this.children.length : index, 0, child)
      child.parentNode = this
      return child
    },
    removeChild(child) {
      const index = this.children.indexOf(child)
      if (index !== -1) this.children.splice(index, 1)
      child.parentNode = null
      return child
    },
  }
  Object.defineProperty(node, 'classList', { value: createClassList(node) })
  Object.defineProperty(node, 'firstElementChild', {
    get() { return this.children[0] || null },
  })
  return node
}

function createEnvironment() {
  const handlers = new Map()
  const windowListeners = new Map()
  const viewportListeners = new Map()
  const wrapper = createNode('remodal-wrapper')
  wrapper.style.bottom = '0px'
  wrapper.style.height = ''
  wrapper.style.top = '0px'
  const modal = createNode('remodal remodal-is-closed')
  wrapper.appendChild(modal)

  const document = {
    body: createNode('body'),
    documentElement: { clientHeight: 720 },
    createElement() { return createNode('') },
    getElementById() { return null },
    querySelectorAll(selector) {
      if (selector === '.dc-remodal-scale-frame') {
        return wrapper.children.filter((node) => node.classList.contains('dc-remodal-scale-frame'))
      }
      if (selector === '.remodal') return [modal]
      return []
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null
    },
  }

  function jquery(value) {
    if (value === document) {
      return {
        off(eventName) {
          handlers.delete(String(eventName).split('.')[0])
          return this
        },
        on(events, _selector, handler) {
          events.split(/\s+/).forEach((event) => handlers.set(event.split('.')[0], handler))
          return this
        },
      }
    }
    if (value && value.jqueryHandlers) {
      return {
        off(namespace) {
          if (namespace === '.dcRemodalScale') value.jqueryHandlers.clear()
          return this
        },
        on(events, handler) {
          events.split(/\s+/).forEach((event) => value.jqueryHandlers.set(event.split('.')[0], handler))
          return this
        },
      }
    }
    const selected = value === '.remodal' ? [modal] : []
    return {
      each(callback) {
        selected.forEach((node) => callback.call(node))
        return this
      },
      off(namespace) {
        selected.forEach((node) => {
          if (namespace === '.dcRemodalScale') node.jqueryHandlers.clear()
        })
        return this
      },
    }
  }

  let animationFrame = null
  let nextTimer = 0
  const timers = new Map()
  const target = {
    Number,
    Array,
    console,
    document,
    innerHeight: 720,
    isFinite,
    jQuery: jquery,
    TYRANO: { kag: { tmp: { base_scale: 0.5 } } },
    visualViewport: {
      height: 640,
      offsetTop: 18,
      addEventListener(type, handler) { viewportListeners.set(type, handler) },
      removeEventListener(type) { viewportListeners.delete(type) },
    },
    addEventListener(type, handler) { windowListeners.set(type, handler) },
    removeEventListener(type) { windowListeners.delete(type) },
    requestAnimationFrame(handler) {
      animationFrame = handler
      return 1
    },
    cancelAnimationFrame() { animationFrame = null },
    setTimeout(handler, delay) {
      const id = ++nextTimer
      timers.set(id, { delay, handler })
      return id
    },
    clearTimeout(id) { timers.delete(id) },
    flushAnimationFrame() {
      const handler = animationFrame
      animationFrame = null
      if (handler) handler()
    },
    flushTimer(delay) {
      const match = Array.from(timers.entries()).find((entry) => entry[1].delay === delay)
      if (!match) return false
      timers.delete(match[0])
      match[1].handler()
      return true
    },
  }
  target.window = target

  return {
    handlers,
    modal,
    target,
    viewportListeners,
    windowListeners,
    wrapper,
  }
}

function trigger(modal, eventName) {
  const handler = modal.jqueryHandlers.get(eventName)
  assert.equal(typeof handler, 'function')
  handler.call(modal)
}

function runHook(environment) {
  vm.runInNewContext(injectedRuntime(), environment.target, { filename: 'devil-connection-remodal-runtime.js' })
}

function testOpenRefreshCloseLifecycle() {
  const environment = createEnvironment()
  const { modal, target, viewportListeners, wrapper } = environment
  runHook(environment)

  trigger(modal, 'opening')
  const frame = wrapper.children[0]
  assert.equal(frame.className, 'dc-remodal-scale-frame')
  assert.equal(frame.children[0], modal)
  assert.equal(frame.style.width, '700px')
  assert.equal(frame.style.transform, 'translate(-50%, -50%) scale(0.5)')
  assert.equal(wrapper.style.height, '640px')
  assert.equal(wrapper.style.top, '18px')
  assert.equal(wrapper.style.bottom, 'auto')

  trigger(modal, 'opened')
  assert.equal(wrapper.children.length, 1)
  target.TYRANO.kag.tmp.base_scale = 0.75
  viewportListeners.get('resize')()
  target.flushAnimationFrame()
  assert.equal(frame.style.transform, 'translate(-50%, -50%) scale(0.75)')
  target.TYRANO.kag.tmp.base_scale = 0.625
  assert.equal(target.flushTimer(250), true)
  assert.equal(frame.style.transform, 'translate(-50%, -50%) scale(0.625)')

  trigger(modal, 'closed')
  assert.deepEqual(wrapper.children, [modal])
  assert.equal(wrapper.style.height, '')
  assert.equal(wrapper.style.top, '0px')
  assert.equal(wrapper.style.bottom, '0px')
  assert.equal(target.flushTimer(250), false)
}

function testDesignWidthMatchesGameCoordinateScale() {
  const baseWidth = 700
  const cases = [
    { scale: 0.75, viewportWidth: 1280, expectedWidth: 525 },
    { scale: 0.40625, viewportWidth: 520, expectedWidth: 284.375 },
    { scale: 0.3046875, viewportWidth: 390, expectedWidth: 213.28125 },
  ]

  cases.forEach((testCase) => {
    const visualWidth = baseWidth * testCase.scale
    assert.equal(visualWidth, testCase.expectedWidth)
    assert.equal(visualWidth <= testCase.viewportWidth, true)
  })
}

function testInstallIsIdempotentAndPageHideCleansUp() {
  const environment = createEnvironment()
  const { handlers, modal, target, windowListeners, wrapper } = environment
  runHook(environment)
  const installation = target.__dcRemodalScaleHook
  runHook(environment)

  assert.equal(target.__dcRemodalScaleHook, installation)
  trigger(modal, 'opening')
  handlers.set('closed', function () {})
  environment.target.jQuery(environment.target.document).off('closed', '.remodal')
  trigger(modal, 'closed')
  trigger(modal, 'opening')
  windowListeners.get('pagehide')()

  assert.deepEqual(wrapper.children, [modal])
  assert.equal(target.__dcRemodalScaleHook, undefined)
  assert.equal(handlers.size, 0)
}

async function testStrictProfileTransform() {
  let prepared = null
  const resolver = {
    resolve(path) { return { kind: 'base', layerId: 'base-game', path } },
    readText(path) {
      assert.equal(path, 'index.html')
      return Promise.resolve(supportedIndex())
    },
    prepareText(path, text, mime) { prepared = { mime, path, text } },
  }
  const result = await window.DCWeb.ProfileRunner.run({
    id: 'remodal-test',
    name: 'Remodal test',
    patches: [patch],
  }, resolver)
  assert.equal(result.status, 'ready')
  assert.equal(result.patches[0].status, 'applied')
  assert.equal(prepared.path, 'index.html')
  assert.equal(prepared.mime, 'text/html;charset=utf-8')
  assert.match(prepared.text, /id="dc-profile-remodal-scaler"/)

  const warning = await window.DCWeb.ProfileRunner.run({ id: 'unsupported', patches: [patch] }, {
    resolve(path) { return { kind: 'base', layerId: 'base-game', path } },
    readText() { return Promise.resolve(supportedIndex().replace('data-remodal-id="modal"', 'data-remodal-id="custom"')) },
  })
  assert.equal(warning.status, 'warning')
  assert.equal(warning.launchAllowed, true)
  assert.equal(warning.patches[0].status, 'unverified')
  assert.match(warning.patches[0].message, /预期 1 处，实际 0 处/)
}

async function main() {
  assert.equal(patch.id, 'devil-connection-remodal-browser-scale')
  assert.equal(patch.target, 'index.html')
  assert.equal(patch.required, true)
  assert.equal(patch.failure, 'warn-and-continue')
  testOpenRefreshCloseLifecycle()
  testDesignWidthMatchesGameCoordinateScale()
  testInstallIsIdempotentAndPageHideCleansUp()
  await testStrictProfileTransform()
  console.log('Remodal profile tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
