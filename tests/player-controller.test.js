'use strict'

const assert = require('node:assert/strict')

let messageHandler
const windowTimers = []
global.window = {
  addEventListener(type, handler) {
    if (type === 'message') messageHandler = handler
  },
  setTimeout(callback) {
    windowTimers.push(callback)
    return callback
  },
}
require('../js/kernel/namespace.js')
require('../js/shell/player-controller.js')

function createView() {
  const state = { gameTitle: '', ready: false, status: '', statusState: '' }
  return {
    state,
    frame: { contentWindow: { __dcStartGame() {} } },
    bind() {},
    renderMods() {},
    setModCount() {},
    setProgress() {},
    setStatus(value, statusState) { state.status = value; state.statusState = statusState || '' },
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
assert.equal(view.state.statusState, 'ready')

controller.start()
assert.equal(view.state.gameTitle, 'Title from Config.tjs')

const warningView = createView()
const warningController = new window.DCWeb.PlayerController(warningView, {})
warningController.bind()
warningController.preparedSession = {
  compatibility: { status: 'warning' },
  launchId: 8,
  launchToken: 'warning-token',
  ready: false,
}
messageHandler({
  source: {},
  data: { type: 'dc-player-ready', launchId: 8, launchToken: 'warning-token' },
})
assert.equal(warningView.state.ready, true)
assert.equal(warningView.state.status, '部分兼容补丁未应用，仍可尝试开始游戏')
assert.equal(warningView.state.statusState, 'warning')

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

function testDisabledAndRemovedModsReleaseRuntimeCache() {
  const modView = createView()
  const modController = new window.DCWeb.PlayerController(modView, {})
  let releaseCount = 0
  modController.mods = [{
    enabled: true,
    id: 'cache-test',
    releaseRuntimeCache() { releaseCount++ },
  }]
  modController.updateModSelection = function (change) { return change() }

  modController.toggleMod('cache-test', false)
  assert.equal(releaseCount, 1)
  assert.equal(modController.mods[0].enabled, false)

  modController.removeMod('cache-test')
  assert.equal(releaseCount, 2)
  assert.equal(modController.mods.length, 0)
}

function createReloadController() {
  const reloadView = createView()
  const navigations = []
  reloadView.navigate = function (html, onLoad) { navigations.push({ html, onLoad }) }
  reloadView.showManager = function () {}
  const reloadController = new window.DCWeb.PlayerController(reloadView, {})
  const session = {
    baseGame: { file: { name: 'app.asar' }, packageJson: { version: '1.0.0' } },
    html: '<title>game</title>',
    launchId: 7,
    launchToken: 'original-token',
    modPlan: { metadata: [] },
    resolver: { release() {} },
    restartWhenReady: false,
  }
  reloadController.activeSession = session
  return { navigations, reloadController, session }
}

function testRepeatedReloadOnlyUsesLatestNavigation() {
  windowTimers.length = 0
  const { navigations, reloadController, session } = createReloadController()

  reloadController.reload()
  const first = navigations[0]
  const firstToken = session.launchToken
  reloadController.reload()
  const second = navigations[1]

  assert.notEqual(session.launchToken, firstToken)
  first.onLoad()
  assert.equal(windowTimers.length, 0)
  second.onLoad()
  assert.equal(windowTimers.length, 1)
  windowTimers.shift()()
  assert.equal(navigations.length, 3)
  assert.equal(navigations[2].html, session.html)
}

function testCloseInvalidatesPendingReload() {
  windowTimers.length = 0
  const { navigations, reloadController, session } = createReloadController()

  reloadController.reload()
  const pendingReload = navigations[0]
  reloadController.close()
  pendingReload.onLoad()
  windowTimers.splice(0).forEach((callback) => callback())

  assert.equal(reloadController.activeSession, null)
  assert.equal(session.restartWhenReady, false)
  assert.equal(navigations.length, 2)
  assert.match(navigations[1].html, /Closed/)
}

function testSupersededSessionsReleaseTogether() {
  const releaseView = createView()
  const releaseController = new window.DCWeb.PlayerController(releaseView, {})
  const releases = []
  const first = { released: false, resolver: { release() { releases.push('first') } } }
  const second = { released: false, resolver: { release() { releases.push('second') } } }

  releaseController.queueSessionRelease(first)
  releaseController.queueSessionRelease(second)
  releaseController.releasePendingSessions()
  releaseController.releasePendingSessions()

  assert.deepEqual(releases, ['first', 'second'])
  assert.equal(releaseController.pendingReleaseSessions.size, 0)
}

testPreparedStorageSuspension().then(function () {
  testDisabledAndRemovedModsReleaseRuntimeCache()
  testRepeatedReloadOnlyUsesLatestNavigation()
  testCloseInvalidatesPendingReload()
  testSupersededSessionsReleaseTogether()
  console.log('Player controller tests passed')
}).catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
