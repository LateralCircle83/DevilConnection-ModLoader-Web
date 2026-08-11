'use strict'

const assert = require('node:assert/strict')

let messageHandler
global.window = {
  addEventListener(type, handler) {
    if (type === 'message') messageHandler = handler
  },
}
require('../js/core/namespace.js')
require('../js/player/player-controller.js')

function createView() {
  const state = { ready: false, status: '' }
  return {
    state,
    frame: { contentWindow: {} },
    bind() {},
    renderMods() {},
    setModCount() {},
    setProgress() {},
    setStatus(value) { state.status = value },
    setLaunchReady(value) { state.ready = value },
  }
}

const view = createView()
const controller = new window.DCWeb.PlayerController(view, {})
controller.bind()
controller.preparedSession = { launchId: 7, launchToken: 'trusted-token', ready: false }

messageHandler({
  source: {},
  data: { type: 'dc-player-ready', launchId: 7, launchToken: 'wrong-token' },
})
assert.equal(controller.preparedSession.ready, false)

messageHandler({
  source: {},
  data: { type: 'dc-player-ready', launchId: 7, launchToken: 'trusted-token' },
})
assert.equal(controller.preparedSession.ready, true)
assert.equal(view.state.ready, true)
assert.equal(view.state.status, '启动环境已就绪，可以开始游戏')

console.log('Player controller tests passed')
