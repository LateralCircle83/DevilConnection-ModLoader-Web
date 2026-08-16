'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')
require('../js/profiles/profile-runner.js')
require('../js/profiles/devil-connection-apng.js')
require('../js/profiles/devil-connection-silent-videos.js')
require('../js/profiles/devil-connection-remodal.js')
require('../js/profiles/devil-connection-collection-scroll.js')
require('../js/profiles/devil-connection.js')

const profile = window.DCWeb.DevilConnectionProfile

function apngSource() {
  const resultSignature = 'return new APNG().load(blob).then(([frames, iterations]) => {'
  return [
    resultSignature,
    resultSignature,
    'const bytes = new Uint8Array(blob.buffer)',
    'function playAPNG(apng, canvas, x, y, w, h, reversed, onFinish, onTick) {',
    '  return apng',
    '}',
  ].join('\n')
}

assert.equal(
  profile.parseGameTitle(';System.title=恶魔连结 - 简体中文 Ver1.01'),
  '恶魔连结 - 简体中文 Ver1.01',
)
assert.equal(profile.parseGameTitle('System.title="Devil Connection"'), 'Devil Connection')
assert.equal(profile.parseGameTitle("System.title='Devil Connection Web'"), 'Devil Connection Web')
assert.equal(profile.parseGameTitle(';projectID=DevilConnection'), '')
assert.equal(profile.patches[0].id, 'devil-connection-apng-browser-compat')
assert.equal(profile.patches[0].required, true)
assert.equal(profile.patches[0].failure, 'warn-and-continue')
assert.equal(profile.patches[0].target, 'tyrano/libs/apng.js')
assert.equal(profile.patches[1].id, 'devil-connection-kiri-video-android-compat')
assert.equal(profile.patches[1].target, 'data/video/kiri2.mp4')
assert.equal(profile.patches[1].format, 'binary')
assert.equal(profile.patches[2].id, 'devil-connection-effect-video-android-compat')
assert.equal(profile.patches[2].target, 'data/video/effect.mp4')
assert.equal(profile.patches[2].format, 'binary')
assert.equal(profile.patches[3].id, 'devil-connection-remodal-browser-scale')
assert.equal(profile.patches[3].target, 'index.html')
assert.equal(profile.patches[4].id, 'devil-connection-collection-mobile-scroll')
assert.equal(profile.patches[4].target, 'data/others/plugin/collection_menu/main.js')

async function testApngPatch() {
  let prepared = null
  const preparedText = new Map()
  const resolver = {
    resolve(path) { return path === 'tyrano/libs/apng.js' ? { kind: 'mod', layerId: 'mod:safe-apng', path } : null },
    readText() { return Promise.resolve(apngSource()) },
    prepareText(path, text, mime) { prepared = { mime, path, text }; preparedText.set(path, text) },
  }
  const apngProfile = { id: profile.id, name: profile.name, patches: [profile.patches[0]] }
  const result = await window.DCWeb.ProfileRunner.run(apngProfile, resolver)
  assert.equal(result.status, 'ready')
  assert.equal(result.patches[0].status, 'applied')
  assert.equal(result.patches[0].sourceLayerId, 'mod:safe-apng')
  assert.equal(prepared.path, 'tyrano/libs/apng.js')
  assert.equal(prepared.mime, 'text/javascript;charset=utf-8')
  assert.match(prepared.text, /ArrayBuffer\.isView\(blob\)/)
  assert.match(prepared.text, /if \(!apng \|\| !apng\.images/)

  const warning = await window.DCWeb.ProfileRunner.run(apngProfile, {
    resolve(path) { return { kind: 'base', layerId: 'base-game', path } },
    readText() { return Promise.resolve(apngSource().replace('const bytes = new Uint8Array(blob.buffer)', 'const bytes = blob')) },
  })
  assert.equal(warning.status, 'warning')
  assert.equal(warning.launchAllowed, true)
  assert.equal(warning.patches[0].status, 'unverified')
  assert.match(warning.patches[0].message, /预期 1 处，实际 0 处/)
}

Promise.all([testApngPatch(), profile.readTitle({
  readText(path) {
    assert.equal(path, 'data/system/Config.tjs')
    return Promise.resolve(';System.title=Loaded from VFS')
  },
})]).then(function (values) {
  const title = values[1]
  assert.equal(title, 'Loaded from VFS')
  console.log('Game profile tests passed')
}).catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
