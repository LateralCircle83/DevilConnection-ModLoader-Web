'use strict'

const assert = require('node:assert/strict')

let messageHandler
global.window = {
  addEventListener(type, handler) {
    if (type === 'message') messageHandler = handler
  },
}
require('../js/kernel/namespace.js')
require('../js/shell/player-controller.js')

function createView() {
  const state = { gameTitle: '', ready: false, status: '' }
  return {
    state,
    frame: { contentWindow: { __dcStartGame() {} } },
    bind() {},
    renderMods() {},
    setModCount() {},
    setProgress() {},
    setStatus(value) { state.status = value },
    setLaunchReady(value) { state.ready = value },
    showPlayer(file, version, modCount, gameTitle) { state.gameTitle = gameTitle },
    showError(error) { throw error },
  }
}

const view = createView()
const controller = new window.DCWeb.PlayerController(view, {})
controller.bind()
controller.preparedSession = {
  baseGame: { file: { name: 'app.asar' }, packageJson: { version: '1.0.0' } },
  gameTitle: 'Title from Config.tjs',
  launchId: 7,
  launchToken: 'trusted-token',
  modPlan: { metadata: [] },
  ready: false,
}

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

controller.start()
assert.equal(view.state.gameTitle, 'Title from Config.tjs')

async function testPreparedStorageSuspension() {
  const events = []
  const suspendView = createView()
  suspendView.frame = {
    contentWindow: {
      api: { storage: { async flush() { events.push('flush') } } },
    },
  }
  suspendView.navigate = function (html, onLoad) {
    events.push(html.indexOf('Closed') !== -1 ? 'navigate-closed' : 'navigate-other')
    onLoad()
  }
  const suspendController = new window.DCWeb.PlayerController(suspendView, {})
  suspendController.preparedSession = {
    released: false,
    resolver: { release() { events.push('release') } },
  }
  await suspendController.suspendPreparedSession()
  assert.deepEqual(events, ['flush', 'navigate-closed', 'release'])
  assert.equal(suspendController.preparedSession, null)
}

testPreparedStorageSuspension().then(function () {
  console.log('Player controller tests passed')
}).catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
