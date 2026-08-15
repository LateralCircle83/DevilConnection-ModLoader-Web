'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/shell/shell-view.js')

const ShellView = window.DCWeb.ShellView

function createFrame() {
  const listeners = []
  return {
    listeners,
    srcdoc: '',
    addEventListener(type, listener) {
      if (type === 'load') listeners.push(listener)
    },
    removeEventListener(type, listener) {
      if (type !== 'load') return
      const index = listeners.indexOf(listener)
      if (index !== -1) listeners.splice(index, 1)
    },
    dispatchLoad() {
      listeners.slice().forEach((listener) => listener({ type: 'load' }))
    },
  }
}

function testLatestNavigationOwnsLoadCallback() {
  const frame = createFrame()
  const view = { frame, pendingFrameLoad: null }
  const calls = []

  ShellView.prototype.navigate.call(view, '<title>first</title>', () => calls.push('first'))
  ShellView.prototype.navigate.call(view, '<title>second</title>', () => calls.push('second'))

  assert.equal(frame.listeners.length, 1)
  assert.equal(frame.srcdoc, '<title>second</title>')
  frame.dispatchLoad()
  frame.dispatchLoad()
  assert.deepEqual(calls, ['second'])
  assert.equal(view.pendingFrameLoad, null)
}

function testNavigationWithoutCallbackCancelsPreviousCallback() {
  const frame = createFrame()
  const view = { frame, pendingFrameLoad: null }
  let called = false

  ShellView.prototype.navigate.call(view, '<title>first</title>', () => { called = true })
  ShellView.prototype.navigate.call(view, '<title>closed</title>')
  frame.dispatchLoad()

  assert.equal(called, false)
  assert.equal(frame.listeners.length, 0)
}

testLatestNavigationOwnsLoadCallback()
testNavigationWithoutCallbackCancelsPreviousCallback()
console.log('Shell view navigation tests passed')
