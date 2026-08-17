'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')
require('../js/profiles/profile-runner.js')
require('../js/profiles/devil-connection-audio-ogg.js')

const patch = window.DCWeb.DevilConnectionAudioOggPatch

function sampleAudioSource() {
  return [
    "  play: function (pm, target) {",
    '    var volume = 1',
    '    volume *= ratio',
    '    var browser = $.getBrowser(),',
    '      storage = pm.storage',
    "    'mp3' != this.kag.config.mediaFormatDefault &&",
    "      (('msie' != browser && 'safari' != browser && 'edge' != browser) ||",
    "        (storage = $.replaceAll(storage, '.ogg', '.m4a')))",
    '    var audio_obj = null',
    '    return storage',
    '  },',
  ].join('\n')
}

function testPatchDeclarations() {
  assert.equal(patch.id, 'devil-connection-audio-ogg-compat')
  assert.equal(patch.target, 'tyrano/plugins/kag/kag.tag_audio.js')
  assert.equal(patch.required, true)
  assert.equal(patch.failure, 'warn-and-continue')
}

function testTransformBothNewlineStylesAndNoop() {
  const lf = patch.transform(sampleAudioSource())
  const crlf = patch.transform(sampleAudioSource().replace(/\n/g, '\r\n'))
  ;[lf, crlf].forEach(function (out) {
    assert.equal(out.split('.m4a').length - 1, 0, 'no m4a rewrite may remain')
    assert.match(out, /\.ogg', '\.ogg'/)
    assert.match(out, /DCWeb keep-ogg/)
    assert.match(out, /'mp3' != this\.kag\.config\.mediaFormatDefault &&/)
  })
  assert.equal(lf.indexOf('\r\n'), -1)
  assert.ok(crlf.indexOf('\r\n') !== -1)

  // 语义：改写动作变成 .ogg -> .ogg，storage 保持不变
  const storage = 'data/bgm/opening.ogg'
  assert.equal(storage.replace('.ogg', '.ogg'), storage)
}

function testTransformRejectsMissingRewriteLine() {
  const broken = sampleAudioSource().replace("'.m4a'", "'.m4a' // custom")
  assert.throws(function () { patch.transform(broken) }, /未匹配/)
}

async function runProfile(readText) {
  let prepared = null
  const result = await window.DCWeb.ProfileRunner.run({
    id: 'audio-ogg-test',
    name: 'Audio OGG test',
    patches: [patch],
  }, {
    resolve(path) { return { kind: 'base', layerId: 'base-game', path } },
    readText: readText,
    prepareText(path, text, mime) { prepared = { mime, path, text } },
  })
  return { prepared, result }
}

async function testProfileRunnerApplied() {
  const { prepared, result } = await runProfile(function () {
    return Promise.resolve(sampleAudioSource())
  })
  assert.equal(result.status, 'ready')
  assert.equal(result.launchAllowed, true)
  assert.equal(result.patches[0].status, 'applied')
  assert.equal(prepared.path, 'tyrano/plugins/kag/kag.tag_audio.js')
  assert.equal(prepared.mime, 'text/javascript;charset=utf-8')
  assert.match(prepared.text, /DCWeb keep-ogg/)
}

async function testUnsupportedSourceWarns() {
  const unsupported = sampleAudioSource().replace(
    "      (('msie' != browser && 'safari' != browser && 'edge' != browser) ||",
    "      (('msie' != browser && 'safari' != browser) ||",
  )
  const { result } = await runProfile(function () {
    return Promise.resolve(unsupported)
  })
  assert.equal(result.status, 'warning')
  assert.equal(result.launchAllowed, true)
  assert.equal(result.patches[0].status, 'unverified')
  assert.match(result.patches[0].message, /预期 1 处，实际 0 处/)
}

async function testMarkerRejectsAlreadyTransformedSource() {
  const transformed = patch.transform(sampleAudioSource())
  const { result } = await runProfile(function () {
    return Promise.resolve(transformed)
  })
  assert.equal(result.status, 'warning')
  assert.equal(result.patches[0].status, 'unverified')
  assert.match(result.patches[0].message, /不受支持/)
}

async function main() {
  testPatchDeclarations()
  testTransformBothNewlineStylesAndNoop()
  testTransformRejectsMissingRewriteLine()
  await testProfileRunnerApplied()
  await testUnsupportedSourceWarns()
  await testMarkerRejectsAlreadyTransformedSource()
  console.log('Audio OGG profile tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
