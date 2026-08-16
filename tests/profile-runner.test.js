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
  assert.equal(report.compatible, true)
  assert.equal(report.launchAllowed, true)
  assert.deepEqual(report.patches.map((patch) => patch.status), ['applied', 'applied'])
  assert.deepEqual(report.patches.map((patch) => patch.sourceLayerId), ['mod:test', 'mod:test'])

  const binarySource = Uint8Array.from([1, 2, 3, 4])
  const binaryDigest = require('node:crypto').createHash('sha256').update(binarySource).digest('hex')
  let preparedBinary = null
  const binaryResolver = {
    getBlob() { return new Blob([binarySource]) },
    prepareBinary(path, value, mime) { preparedBinary = { mime, path, value: new Uint8Array(value) } },
    resolve(path) { return { kind: 'base', layerId: 'base-game', path } },
  }
  const binaryProfile = {
    id: 'binary-game',
    patches: [{
      failure: 'abort-session',
      format: 'binary',
      id: 'binary',
      maxBytes: 16,
      required: true,
      signatures: [{ size: 4 }, { sha256: binaryDigest }],
      target: 'movie.mp4',
      transform(buffer) {
        const output = new Uint8Array(buffer.slice(0))
        output[0] = 9
        return output
      },
    }],
  }
  const binaryReport = await window.DCWeb.ProfileRunner.run(binaryProfile, binaryResolver)
  assert.equal(binaryReport.patches[0].status, 'applied')
  assert.deepEqual(Array.from(preparedBinary.value), [9, 2, 3, 4])
  assert.equal(preparedBinary.mime, 'video/mp4')

  preparedBinary = null
  const delegatedProfile = {
    id: 'delegated-mod-video',
    patches: [{
      ...binaryProfile.patches[0],
      signatures: [{ size: 5 }],
      unsupportedMod: 'delegate-to-runtime',
    }],
  }
  const delegatedReport = await window.DCWeb.ProfileRunner.run(delegatedProfile, {
    getBlob() { return new Blob([binarySource]) },
    prepareBinary() { throw new Error('delegated patches must not prepare content') },
    resolve(path) { return { kind: 'mod', layerId: 'mod:unknown-video', path } },
  })
  assert.equal(delegatedReport.status, 'ready')
  assert.equal(delegatedReport.patches[0].status, 'delegated')
  assert.equal(delegatedReport.patches[0].sourceLayerId, 'mod:unknown-video')
  assert.match(delegatedReport.patches[0].message, /已交由运行时兼容层/)
  assert.equal(preparedBinary, null)

  const oversizedDelegatedReport = await window.DCWeb.ProfileRunner.run({
    id: 'oversized-mod-video',
    patches: [{ ...binaryProfile.patches[0], maxBytes: 3, unsupportedMod: 'delegate-to-runtime' }],
  }, {
    getBlob() {
      return {
        size: 4,
        arrayBuffer() { throw new Error('oversized delegated mods must not be read') },
      }
    },
    resolve(path) { return { kind: 'mod', layerId: 'mod:oversized-video', path } },
  })
  assert.equal(oversizedDelegatedReport.patches[0].status, 'delegated')

  const exactModReport = await window.DCWeb.ProfileRunner.run({
    id: 'known-mod-video',
    patches: [{ ...binaryProfile.patches[0], unsupportedMod: 'delegate-to-runtime' }],
  }, {
    getBlob() { return new Blob([binarySource]) },
    prepareBinary(path, value, mime) { preparedBinary = { mime, path, value: new Uint8Array(value) } },
    resolve(path) { return { kind: 'mod', layerId: 'mod:known-video', path } },
  })
  assert.equal(exactModReport.patches[0].status, 'applied')
  assert.deepEqual(Array.from(preparedBinary.value), [9, 2, 3, 4])

  await assert.rejects(
    window.DCWeb.ProfileRunner.run({
      id: 'unsupported-binary',
      patches: [{ ...binaryProfile.patches[0], signatures: [{ sha256: '0'.repeat(64) }] }],
    }, binaryResolver),
    function (error) {
      assert.equal(error.name, 'ProfileCompatibilityError')
      assert.equal(error.compatibility.patches[0].status, 'unsupported')
      return true
    },
  )

  let warningPrepared = false
  const warningReport = await window.DCWeb.ProfileRunner.run({
    id: 'unknown-base-video',
    patches: [{
      ...binaryProfile.patches[0],
      failure: 'warn-and-continue',
      signatures: [{ sha256: '0'.repeat(64) }],
    }],
  }, {
    getBlob() { return new Blob([binarySource]) },
    prepareBinary() { warningPrepared = true },
    resolve(path) { return { kind: 'base', layerId: 'base-game', path } },
  })
  assert.equal(warningReport.status, 'warning')
  assert.equal(warningReport.compatible, false)
  assert.equal(warningReport.launchAllowed, true)
  assert.equal(warningReport.patches[0].status, 'unverified')
  assert.match(warningReport.patches[0].message, /未执行此转换，仍可尝试启动/)
  assert.equal(warningPrepared, false)

  const continued = { value: 'alpha' }
  const continuedReport = await window.DCWeb.ProfileRunner.run({
    id: 'continued-profile',
    patches: [
      {
        failure: 'warn-and-continue',
        id: 'missing',
        required: true,
        signatures: [{ count: 1, text: 'unused' }],
        target: 'missing.js',
        transform() { throw new Error('missing transforms must not run') },
      },
      {
        failure: 'abort-session',
        id: 'following',
        required: true,
        signatures: [{ count: 1, text: 'alpha' }],
        target: 'engine.js',
        transform(source) { return source.replace('alpha', 'continued') },
      },
    ],
  }, {
    prepareText(path, text) { continued.value = text },
    readText() { return Promise.resolve(continued.value) },
    resolve(path) { return path === 'engine.js' ? { kind: 'base', layerId: 'base-game', path } : null },
  })
  assert.equal(continuedReport.status, 'warning')
  assert.deepEqual(continuedReport.patches.map((patch) => patch.status), ['unverified', 'applied'])
  assert.equal(continued.value, 'continued')

  const failedButLaunchable = await window.DCWeb.ProfileRunner.run({
    id: 'failed-but-launchable',
    patches: [{
      failure: 'warn-and-continue',
      id: 'read-failure',
      required: true,
      signatures: [{ count: 1, text: 'alpha' }],
      target: 'engine.js',
      transform(source) { return source },
    }],
  }, {
    readText() { return Promise.reject(new Error('read failed')) },
    resolve(path) { return { kind: 'base', layerId: 'base-game', path } },
  })
  assert.equal(failedButLaunchable.status, 'warning')
  assert.equal(failedButLaunchable.launchAllowed, true)
  assert.equal(failedButLaunchable.patches[0].status, 'failed')

  let transformFailurePrepared = false
  const transformFailure = await window.DCWeb.ProfileRunner.run({
    id: 'transform-failure',
    patches: [{
      failure: 'warn-and-continue',
      id: 'broken-transform',
      required: true,
      signatures: [{ count: 1, text: 'alpha' }],
      target: 'engine.js',
      transform() { throw new Error('transform failed') },
    }],
  }, {
    prepareText() { transformFailurePrepared = true },
    readText() { return Promise.resolve('alpha') },
    resolve(path) { return { kind: 'base', layerId: 'base-game', path } },
  })
  assert.equal(transformFailure.status, 'warning')
  assert.equal(transformFailure.patches[0].status, 'failed')
  assert.equal(transformFailurePrepared, false)

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
  await assert.rejects(
    window.DCWeb.ProfileRunner.run({
      id: 'invalid-failure-policy',
      patches: [{ ...profile.patches[0], failure: 'ignore' }],
    }, createResolver('alpha')),
    /invalid failure policy/,
  )
  console.log('Profile runner tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
