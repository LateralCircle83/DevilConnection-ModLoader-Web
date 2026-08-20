'use strict'

const assert = require('node:assert/strict')
const vm = require('node:vm')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')
require('../js/profiles/profile-runner.js')
require('../js/profiles/devil-connection-tap-effect.js')

const patch = window.DCWeb.DevilConnectionTapEffectPatch

function supportedSource() {
  return [
    "      $('body').on('mousedown.tap_effect touchstart.tap_effect', function (e) {",
    '        //e.preventDefault()',
    '        const x = e.clientX || e.targetTouches[0].clientX',
    '        const y = e.clientY || e.targetTouches[0].clientY',
    '        clickEvent(x, y)',
    '      })',
  ].join('\n')
}

function capturePatchedHandler() {
  const transformed = patch.transform(supportedSource())
  let handler = null
  const calls = []
  const sandbox = {
    $: function () {
      return {
        on(type, fn) {
          handler = fn
        },
      }
    },
    clickEvent(x, y) {
      calls.push([x, y])
    },
  }
  vm.runInNewContext(transformed, sandbox, { filename: 'tap-effect-patched.js' })
  assert.ok(handler, 'handler should be bound')
  return { calls, handler }
}

async function testCoordinateGuardBehavior() {
  const { calls, handler } = capturePatchedHandler()

  // Firefox 键盘激活合成的 mousedown：clientX=0，无 targetTouches —— 原来会抛错
  handler({ clientX: 0, clientY: 0 })
  assert.deepEqual(calls[0], [0, 0])

  // 完全没有坐标的合成事件 —— 原来会抛错
  handler({})
  assert.deepEqual(calls[1], [0, 0])

  // 真实触摸：clientX 优先
  handler({ clientX: 10, clientY: 20, targetTouches: [{ clientX: 100, clientY: 200 }] })
  assert.deepEqual(calls[2], [10, 20])

  // 无 clientX 但有触摸坐标：回退触摸坐标
  handler({ targetTouches: [{ clientX: 100, clientY: 200 }] })
  assert.deepEqual(calls[3], [100, 200])
}

async function testStrictProfileTransform() {
  const source = supportedSource()
  let prepared = null
  const exact = await window.DCWeb.ProfileRunner.run({ id: 'tap-effect', patches: [patch] }, {
    resolve(path) { return { kind: 'mod', layerId: 'mod:exact-tap-effect', path } },
    readText() { return Promise.resolve(source) },
    prepareText(path, text, mime) { prepared = { mime, path, text } },
  })
  assert.equal(exact.status, 'ready')
  assert.equal(exact.patches[0].status, 'applied')
  assert.equal(prepared.path, patch.target)
  assert.match(prepared.text, /DCWeb tap-effect coordinate guard/)
  assert.doesNotMatch(prepared.text, /e\.targetTouches\[0\]\.clientX/)
  assert.doesNotMatch(source, /DCWeb tap-effect coordinate guard/)

  const warning = await window.DCWeb.ProfileRunner.run({ id: 'tap-effect-unknown', patches: [patch] }, {
    resolve(path) { return { kind: 'mod', layerId: 'mod:unknown-tap-effect', path } },
    readText() { return Promise.resolve(source.replace('e.clientX', 'e.pageX')) },
  })
  assert.equal(warning.status, 'warning')
  assert.equal(warning.launchAllowed, true)
  assert.equal(warning.patches[0].status, 'unverified')
  assert.match(warning.patches[0].message, /预期 1 处，实际 0 处/)
}

async function main() {
  assert.equal(patch.id, 'devil-connection-tap-effect-coordinate-guard')
  assert.equal(patch.target, 'data/others/plugin/tap_effect/main.js')
  assert.equal(patch.required, true)
  assert.equal(patch.failure, 'warn-and-continue')
  await testCoordinateGuardBehavior()
  await testStrictProfileTransform()
  console.log('Tap effect profile tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
