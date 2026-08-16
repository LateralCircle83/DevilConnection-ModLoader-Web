'use strict'

const assert = require('node:assert/strict')
const vm = require('node:vm')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')
require('../js/profiles/profile-runner.js')
require('../js/profiles/devil-connection-collection-scroll.js')

const patch = window.DCWeb.DevilConnectionCollectionScrollPatch

function supportedSource() {
  return [
    'TYRANO.kag.ftag.master_tag.collection_menu = {',
    "  pm: { name: '' },",
    '  start: function ({ name }) {',
    '    const freeLayer = TYRANO.kag.layer.getFreeLayer()',
    '    const collectionMenu = $(',
    '      `<div id="collection_menu" class="${name}" tabindex="-1">`',
    "    ).css('opacity', 0)",
    '    freeLayer.append(collectionMenu)',
    '    TYRANO.kag.ftag.nextOrder()',
    '  },',
    '}',
  ].join('\n')
}

function testRuntimeBoundary() {
  const handlers = new Map()
  const listenerOptions = new Map()
  const collectionElement = {
    addEventListener(name, handler, options) {
      handlers.set(name, handler)
      listenerOptions.set(name, options)
    },
  }
  const collectionMenu = {
    css() { return this },
    get(index) { return index === 0 ? collectionElement : undefined },
  }
  const appended = []
  const context = {
    $() { return collectionMenu },
    TYRANO: {
      kag: {
        ftag: { master_tag: {}, nextOrder() {} },
        layer: { getFreeLayer() { return { append(node) { appended.push(node) } } } },
      },
    },
  }

  vm.runInNewContext(patch.transform(supportedSource()), context)
  context.TYRANO.kag.ftag.master_tag.collection_menu.start({ name: 'character' })
  assert.deepEqual(appended, [collectionMenu])
  assert.equal(handlers.has('touchmove'), true)
  assert.equal(listenerOptions.get('touchmove').passive, true)

  let propagationStopped = 0
  let defaultPrevented = 0
  handlers.get('touchmove')({
    preventDefault() { defaultPrevented += 1 },
    stopPropagation() { propagationStopped += 1 },
  })
  assert.equal(propagationStopped, 1)
  assert.equal(defaultPrevented, 0)
}

async function testStrictProfileTransform() {
  let prepared = null
  const result = await window.DCWeb.ProfileRunner.run({ id: 'collection', patches: [patch] }, {
    resolve(path) { return { kind: 'base', layerId: 'base-game', path } },
    readText() { return Promise.resolve(supportedSource()) },
    prepareText(path, text, mime) { prepared = { mime, path, text } },
  })
  assert.equal(result.status, 'ready')
  assert.equal(result.patches[0].status, 'applied')
  assert.equal(prepared.path, patch.target)
  assert.equal(prepared.mime, 'text/javascript;charset=utf-8')
  assert.match(prepared.text, /function dcCollectionScroll/)
  assert.match(prepared.text, /passive:\s*true/)
  assert.match(prepared.text, /event\.stopPropagation\(\)/)
  assert.doesNotMatch(prepared.text, /event\.preventDefault\(\)/)

  const warning = await window.DCWeb.ProfileRunner.run({ id: 'unsupported', patches: [patch] }, {
    resolve(path) { return { kind: 'base', layerId: 'base-game', path } },
    readText() { return Promise.resolve(supportedSource().replace('tabindex="-1"', 'tabindex="0"')) },
  })
  assert.equal(warning.status, 'warning')
  assert.equal(warning.launchAllowed, true)
  assert.equal(warning.patches[0].status, 'unverified')
  assert.match(warning.patches[0].message, /预期 1 处，实际 0 处/)
}

async function main() {
  assert.equal(patch.id, 'devil-connection-collection-mobile-scroll')
  assert.equal(patch.target, 'data/others/plugin/collection_menu/main.js')
  assert.equal(patch.required, true)
  assert.equal(patch.failure, 'warn-and-continue')
  testRuntimeBoundary()
  await testStrictProfileTransform()
  console.log('Collection scroll profile tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
