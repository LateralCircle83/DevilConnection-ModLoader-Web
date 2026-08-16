'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
window.DCWeb.ProfileRunner = {
  createReport(profile) {
    return { patches: [{ id: 'patch', required: true, status: 'pending' }], profileId: profile.id, status: 'checking' }
  },
}
require('../js/shell/compatibility-controller.js')

const events = []
const shellView = { showPage(page) { events.push(['page', page]) } }
const view = {
  bind(handlers) { this.handlers = handlers },
  download(name, value) { events.push(['download', name, value]) },
  render(report, context) { events.push(['render', report.status, context.gameVersion || '']) },
}
const controller = new window.DCWeb.CompatibilityController(shellView, view, { id: 'game', name: 'Game' })
controller.bind()
controller.checking({ gameVersion: '1.0.0' })
controller.ready({ patches: [], status: 'ready' }, { gameVersion: '1.0.0' })
controller.ready({ patches: [{ status: 'unverified' }], status: 'warning' }, { gameVersion: '1.1.0' })
controller.failed({ compatibility: { patches: [], status: 'failed' } }, { gameVersion: '2.0.0' })
view.handlers.exportReport()

assert.deepEqual(events.slice(0, 7), [
  ['render', 'idle', ''],
  ['render', 'checking', '1.0.0'],
  ['render', 'ready', '1.0.0'],
  ['render', 'warning', '1.1.0'],
  ['page', 'compatibility'],
  ['render', 'failed', '2.0.0'],
  ['page', 'compatibility'],
])
assert.equal(events[7][0], 'download')
assert.equal(events[7][1], 'devil-connection-compatibility.json')
assert.equal(events[7][2].schemaVersion, 1)
assert.equal(events[7][2].context.gameVersion, '2.0.0')
console.log('Compatibility controller tests passed')
