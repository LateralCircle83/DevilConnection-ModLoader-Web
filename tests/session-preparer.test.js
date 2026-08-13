'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')

const events = []
const resolver = {
  async prepareStyles() { events.push('styles') },
  release() { events.push('release') },
}

window.DCWeb.ModPlan = {
  async create(mods) {
    events.push('mods')
    assert.deepEqual(mods, ['mod'])
    return { layers: [{ id: 'mod:one', source: {} }] }
  },
}
window.DCWeb.LayeredVfs = function (layers) {
  events.push('vfs')
  assert.deepEqual(layers.map((layer) => layer.id), ['base-game', 'mod:one'])
}
window.DCWeb.AssetResolver = function () {
  events.push('resolver')
  return resolver
}
window.DCWeb.ProfileRunner = {
  async run(profile, value) {
    assert.equal(value, resolver)
    events.push('profile')
    return profile.patches || []
  },
}
window.DCWeb.GameDocument = {
  async build(value) {
    assert.equal(value, resolver)
    events.push('document')
    return '<!doctype html>'
  },
}
require('../js/shell/session-preparer.js')

async function main() {
  const result = await window.DCWeb.SessionPreparer.prepare({
    baseGame: { archive: {} },
    mods: ['mod'],
    profile: {
      patches: [{ id: 'patch', status: 'applied' }],
      async readTitle() {
        events.push('title')
        return 'Layered title'
      },
    },
  })
  assert.deepEqual(events, ['mods', 'vfs', 'resolver', 'profile', 'styles', 'title', 'document'])
  assert.equal(result.gameTitle, 'Layered title')
  assert.deepEqual(result.compatibility, [{ id: 'patch', status: 'applied' }])

  events.length = 0
  window.DCWeb.GameDocument.build = async function () { throw new Error('entry failed') }
  await assert.rejects(
    window.DCWeb.SessionPreparer.prepare({ baseGame: { archive: {} }, mods: ['mod'], profile: {} }),
    /entry failed/,
  )
  assert.equal(events.at(-1), 'release')
  console.log('Session preparer tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
