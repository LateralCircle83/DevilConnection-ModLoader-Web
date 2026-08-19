'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')
require('../js/profiles/profile-runner.js')
require('../js/profiles/devil-connection-tap-repeat.js')

const neoPatch = window.DCWeb.DevilConnectionNeoTapPatch
const yumePatch = window.DCWeb.DevilConnectionYumeKupyaTapPatch
const root = path.join(__dirname, '..')

function sampleNeoSource() {
  return [
    '[clickable  storage="Chapter4_2kuitomeru.ks"  x="190"  y="5"  width="902"  height="709"  target="*da"  cm="false"  _clickable_img=""  ]',
    '[s  ]',
    '*da',
    '',
    '[eval exp="tf.da()"]',
    '',
    '[jump  target="*cleared"  storage="Chapter4_2kuitomeru.ks"  cond="f.neoCount<=0"  ]',
    '[s  ]',
  ].join('\n')
}

function sampleYumeSource() {
  return [
    '[clickable  storage="omake_yume_kupya.ks"  width="650"  height="708"  x="323"  y="6"  target="*da"  cm="false"  _clickable_img=""  ]',
    '[s  ]',
    '*da',
    '',
    '[eval exp="tf.count--"]',
    '',
    '[jump  target="*success"  storage="omake_yume_kupya.ks"  cond="tf.count<=0"  ]',
    '[s  ]',
  ].join('\n')
}

function testPatchDeclarations() {
  assert.equal(neoPatch.id, 'devil-connection-neo-tap-repeat')
  assert.equal(neoPatch.target, 'data/scenario/Chapter4_2kuitomeru.ks')
  assert.equal(neoPatch.required, true)
  assert.equal(neoPatch.failure, 'warn-and-continue')
  assert.equal(yumePatch.id, 'devil-connection-yume-kupya-tap-repeat')
  assert.equal(yumePatch.target, 'data/scenario/omake_yume_kupya.ks')
  assert.equal(yumePatch.required, true)
  assert.equal(yumePatch.failure, 'warn-and-continue')
}

function testTransformBothNewlineStyles() {
  ;[sampleNeoSource(), sampleYumeSource()].forEach(function (sample) {
    const patch = sample.includes('omake') ? yumePatch : neoPatch
    const lf = patch.transform(sample)
    const crlf = patch.transform(sample.replace(/\n/g, '\r\n'))
    ;[lf, crlf].forEach(function (out) {
      assert.match(out, /\[iscript\]/)
      assert.match(out, /\[endscript\]/)
      assert.match(out, /DCWeb tap-repeat/)
      assert.match(out, /addEventListener\('touchend'/)
      assert.match(out, /event\.preventDefault\(\)/)
      assert.match(out, /button\.trigger\('click'\)/)
      assert.equal(out.split('DCWeb tap-repeat').length - 1, 1, 'marker must appear exactly once')
    })
    assert.equal(lf.indexOf('\r\n'), -1, 'LF source keeps LF output')
    assert.ok(crlf.indexOf('\r\n') !== -1, 'CRLF source keeps CRLF output')
  })
}

function testInsertedScriptLinesNeverStartWithSemicolon() {
  // 游戏场景解析器把以 ';' 开头的行一律当注释跳过（即使在 [iscript] 内），
  // 因此插入的脚本任何一行都不能以 ';' 开头，否则 IIFE 会被拆坏产生
  // SyntaxError: Illegal return statement。
  const neoOut = neoPatch.transform(sampleNeoSource())
  const yumeOut = yumePatch.transform(sampleYumeSource())
  ;[neoOut, yumeOut].forEach(function (out) {
    const inScript = out.split(/\[iscript\]|\[endscript\]/)
    const scriptBlock = inScript[1] || ''
    scriptBlock.split(/\r?\n/).forEach(function (line) {
      assert.ok(
        !line.trim().startsWith(';'),
        'iscript line must not start with ";": ' + JSON.stringify(line),
      )
    })
  })
}

function testInsertedScriptSurvivesEngineSemicolonSkip() {
  // 引擎侧回归：kag.parser 把 [iscript] 内以 ';' 开头的行当注释跳过，
  // 累积出的脚本必须仍是合法 JavaScript（不能变成顶层 return）。
  function engineBuffer(source) {
    const rows = source.split('\n')
    let inScript = false
    let buff = ''
    const parts = []
    for (const raw of rows) {
      const line = raw.trim()
      if (line.indexOf('endscript') !== -1) { inScript = false; parts.push(buff); buff = ''; continue }
      if (line.indexOf('iscript') !== -1) { inScript = true; buff = ''; continue }
      if (!inScript) continue
      if (line.startsWith(';')) continue
      buff += raw + '\n'
    }
    return parts
  }
  ;[neoPatch.transform(sampleNeoSource()), yumePatch.transform(sampleYumeSource())].forEach(function (out) {
    const segments = engineBuffer(out)
    const tapSegment = segments.find(function (s) { return s.indexOf('DCWeb tap-repeat') !== -1 })
    assert.ok(tapSegment, 'tap segment must exist after engine buffering')
    // 用 DOM 桩执行真实脚本：button 应有 touchend 监听，触发后 preventDefault 并 trigger click
    let clickFired = 0
    let prevented = false
    const button = {
      addEventListener(type, fn) { this.handler = fn },
    }
    const free = {
      children() {
        return {
          last() {
            return { length: 1, 0: button, trigger() { clickFired++ } }
          },
        }
      },
    }
    const fakeTyrano = { kag: { layer: { getFreeLayer() { return free } } } }
    assert.doesNotThrow(function () {
      // 以函数体执行等价于引擎 eval（顶层 return 合法），但脚本本体必须完整成块
      const runner = new Function('TYRANO', tapSegment)
      runner(fakeTyrano)
    }, SyntaxError, 'buffered tap segment must be valid JavaScript')
    assert.equal(typeof button.handler, 'function', 'touchend handler must be bound')
    button.handler({
      cancelable: true,
      preventDefault() { prevented = true },
    })
    assert.equal(prevented, true, 'touchend default must be canceled')
    assert.equal(clickFired, 1, 'click must fire once per touchend')
  })
}

function testTransformRejectsMissingClickableLine() {
  const broken = sampleNeoSource().replace('target="*da"', 'target="*other"')
  assert.throws(function () { neoPatch.transform(broken) }, /未匹配/)
}

function testIndexHtmlLoadsProfileBeforeAggregator() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  const tapRepeatIndex = html.indexOf('js/profiles/devil-connection-tap-repeat.js')
  const aggregatorIndex = html.indexOf('js/profiles/devil-connection.js')
  assert.ok(tapRepeatIndex !== -1, 'tap-repeat profile script must be loaded from index.html')
  assert.ok(aggregatorIndex !== -1, 'devil-connection.js aggregator script must be present')
  assert.ok(
    tapRepeatIndex < aggregatorIndex,
    'tap-repeat profile script must load before devil-connection.js so its patches exist',
  )
}

async function runProfile(patch, readText) {
  let prepared = null
  const result = await window.DCWeb.ProfileRunner.run({
    id: 'tap-repeat-test',
    name: 'Tap repeat test',
    patches: [patch],
  }, {
    resolve(path) { return { kind: 'base', layerId: 'base-game', path } },
    readText: readText,
    prepareText(path, text, mime) { prepared = { mime, path, text } },
  })
  return { prepared, result }
}

async function testProfileRunnerApplied() {
  const neo = await runProfile(neoPatch, function () { return Promise.resolve(sampleNeoSource()) })
  assert.equal(neo.result.status, 'ready')
  assert.equal(neo.result.launchAllowed, true)
  assert.equal(neo.result.patches[0].status, 'applied')
  assert.equal(neo.prepared.path, 'data/scenario/Chapter4_2kuitomeru.ks')
  assert.equal(neo.prepared.mime, 'text/plain;charset=utf-8')
  assert.match(neo.prepared.text, /DCWeb tap-repeat/)

  const yume = await runProfile(yumePatch, function () { return Promise.resolve(sampleYumeSource()) })
  assert.equal(yume.result.status, 'ready')
  assert.equal(yume.result.launchAllowed, true)
  assert.equal(yume.result.patches[0].status, 'applied')
  assert.equal(yume.prepared.path, 'data/scenario/omake_yume_kupya.ks')
  assert.equal(yume.prepared.mime, 'text/plain;charset=utf-8')
  assert.match(yume.prepared.text, /DCWeb tap-repeat/)
}

async function testUnsupportedSourceWarns() {
  const unsupported = sampleYumeSource().replace('x="323"', 'x="300"')
  const { result } = await runProfile(yumePatch, function () { return Promise.resolve(unsupported) })
  assert.equal(result.status, 'warning')
  assert.equal(result.launchAllowed, true)
  assert.equal(result.patches[0].status, 'unverified')
  assert.match(result.patches[0].message, /预期 1 处，实际 0 处/)
}

async function testMarkerRejectsAlreadyTransformedSource() {
  const transformed = neoPatch.transform(sampleNeoSource())
  const { result } = await runProfile(neoPatch, function () { return Promise.resolve(transformed) })
  assert.equal(result.status, 'warning')
  assert.equal(result.patches[0].status, 'unverified')
  assert.match(result.patches[0].message, /不受支持/)
}

async function main() {
  testPatchDeclarations()
  testTransformBothNewlineStyles()
  testInsertedScriptLinesNeverStartWithSemicolon()
  testTransformRejectsMissingClickableLine()
  testIndexHtmlLoadsProfileBeforeAggregator()
  await testProfileRunnerApplied()
  await testUnsupportedSourceWarns()
  await testMarkerRejectsAlreadyTransformedSource()
  console.log('Devil Connection tap repeat profile tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
