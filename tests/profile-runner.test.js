'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')
require('../js/profiles/profile-runner.js')

function createResolver(initial) {
  let current = initial
  return {
    get current() { return current },
    prepareText(path, text) { current = text },
    readText() { return Promise.resolve(current) },
    resolve(path) { return { kind: 'mod', layerId: 'mod:test', path } },
  }
}

async function main() {
  const profile = {
    id: 'test-game',
    name: 'Test Game',
    patches: [
      {
        id: 'first',
        failure: 'abort-session',
        name: 'First',
        required: true,
        signatures: [{ count: 1, text: 'alpha' }],
        target: 'engine.js',
        transform(source) { return source.replace('alpha', 'beta') },
      },
      {
        id: 'second',
        failure: 'abort-session',
        name: 'Second',
        required: true,
        signatures: [{ count: 1, text: 'beta' }],
        target: 'engine.js',
        transform(source) { return source + ':ready' },
      },
    ],
  }
  const resolver = createResolver('alpha')
  const report = await window.DCWeb.ProfileRunner.run(profile, resolver)
  assert.equal(resolver.current, 'beta:ready')
  assert.equal(report.status, 'ready')
  assert.deepEqual(report.patches.map((patch) => patch.status), ['applied', 'applied'])
  assert.deepEqual(report.patches.map((patch) => patch.sourceLayerId), ['mod:test', 'mod:test'])

  await assert.rejects(
    window.DCWeb.ProfileRunner.run(profile, createResolver('unsupported')),
    function (error) {
      assert.equal(error.name, 'ProfileCompatibilityError')
      assert.equal(error.compatibility.status, 'failed')
      assert.equal(error.compatibility.patches[0].status, 'unsupported')
      assert.equal(error.compatibility.patches[1].status, 'pending')
      return true
    },
  )

  await assert.rejects(
    window.DCWeb.ProfileRunner.run({
      id: 'invalid-profile',
      patches: [{ id: 'loose', failure: 'abort-session', required: true, target: 'engine.js', transform(source) { return source } }],
    }, createResolver('alpha')),
    /requires strict source signatures/,
  )
  console.log('Profile runner tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
