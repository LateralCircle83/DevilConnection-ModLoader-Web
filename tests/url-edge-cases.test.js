'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/core/namespace.js')
require('../js/core/resource-path.js')
require('../js/archive/asar-archive.js')
require('../js/vfs/layered-vfs.js')
require('../js/assets/object-url-registry.js')
require('../js/assets/style-processor.js')
require('../js/assets/asset-resolver.js')
require('../js/runtime/resource-rewriter.js')
require('../js/runtime/browser-runtime.js')

const { AsarArchive, AssetResolver, LayeredVfs, ResourcePath } = window.DCWeb

function createResolver(archive, id = 'base-game') {
  return new AssetResolver(new LayeredVfs([{ id, source: archive }]))
}

function entry(path, offset, size) {
  return [path, { path, offset, size, unpacked: false }]
}

function loadRuntime() {
  return window.DCWeb.Runtime
}

async function testObjectUrlRoundTrip() {
  const path = 'data/image/hero & 100%.png'
  const canonical = 'data/image/hero%20%26%20100%25.png'
  const blobUrl = 'blob:http://127.0.0.1:4173/12345678-1234-1234-1234-123456789abc'
  const resolver = createResolver(new AsarArchive(null, {}, 0, new Map()))
  resolver.registry.pathsByUrl.set(blobUrl, path)

  assert.equal(resolver.restoreObjectUrls(blobUrl), canonical)
  assert.equal(resolver.restoreObjectUrls(blobUrl + '?v=1&theme=dark#portrait'), canonical + '?v=1&theme=dark#portrait')
  assert.equal(resolver.restoreObjectUrls('url(&quot;' + blobUrl + '&quot;)'), 'url(&quot;' + canonical + '&quot;)')
  assert.equal(resolver.restoreObjectUrls(blobUrl + ', ' + blobUrl + '#second'), canonical + ', ' + canonical + '#second')

  const encoded = encodeURIComponent(blobUrl + '?v=1&theme=dark')
  assert.equal(decodeURIComponent(resolver.restoreObjectUrls(encoded)), canonical + '?v=1&theme=dark')

  const doubleEncoded = encodeURIComponent(encoded)
  assert.equal(
    decodeURIComponent(decodeURIComponent(resolver.restoreObjectUrls(doubleEncoded))),
    canonical + '?v=1&theme=dark',
  )
}

async function testFragmentsAndReservedFileNames() {
  const path = 'data/image/icon#100%.svg'
  const bytes = '<svg></svg>'
  const archive = new AsarArchive(
    new Blob([bytes]),
    {},
    0,
    new Map([entry(path, 0, Buffer.byteLength(bytes))]),
  )

  assert.equal(archive.findPath('data/image/icon%23100%25.svg'), path)
  assert.equal(ResourcePath.normalize('/shared/a.png', 'data/css/main.css'), 'shared/a.png')
  assert.equal(archive.getBlob('data/image/icon%23100%25.svg').type, 'image/svg+xml')

  const resolver = createResolver(archive)
  const objectUrl = resolver.getObjectUrl('data/image/icon%23100%25.svg?v=4#symbol')
  assert.match(objectUrl, /^blob:/)
  assert.equal(objectUrl.endsWith('#symbol'), true)
  assert.equal(objectUrl.includes('?v=4'), false)
  assert.equal(resolver.restoreObjectUrls(objectUrl), 'data/image/icon%23100%25.svg#symbol')
  resolver.release()
}

async function testNestedStyles() {
  const main = '@import "Theme.css" screen;\n.logo{mask:url("../image/icons.svg#mark")}'
  const theme = '.hero{background:url("../image/hero.png?v=2")}'
  const icon = '<svg></svg>'
  const image = 'png'
  const all = main + theme + icon + image
  const entries = new Map([
    entry('data/css/main.css', 0, Buffer.byteLength(main)),
    entry('data/css/theme.css', Buffer.byteLength(main), Buffer.byteLength(theme)),
    entry('data/image/icons.svg', Buffer.byteLength(main + theme), Buffer.byteLength(icon)),
    entry('data/image/hero.png', Buffer.byteLength(main + theme + icon), Buffer.byteLength(image)),
  ])
  const archive = new AsarArchive(new Blob([all]), {}, 0, entries)

  const resolver = createResolver(archive)
  await resolver.prepareStyles()
  const mainUrl = resolver.getObjectUrl('data/css/main.css')
  const themeUrl = resolver.getObjectUrl('data/css/theme.css')
  const mainText = await (await fetch(mainUrl)).text()
  const themeText = await (await fetch(themeUrl)).text()

  assert.equal(mainText.includes(themeUrl), true)
  assert.equal(resolver.hasPrepared('data/css/main.css'), true)
  assert.equal(resolver.hasPrepared('data/css/theme.css'), true)
  assert.match(mainText, /blob:[^"')]+#mark/)
  assert.match(themeText, /url\("blob:[^"')]+"\)/)
  assert.equal(themeText.includes('?v=2'), false)
  resolver.release()
}

function testLayerPrecedence() {
  const base = new AsarArchive(
    new Blob(['base-onlybase']),
    {},
    0,
    new Map([
      entry('data/shared.txt', 0, 4),
      entry('data/base.txt', 4, 8),
    ]),
  )
  const mod = new AsarArchive(
    new Blob(['mod']),
    {},
    0,
    new Map([entry('data/shared.txt', 0, 3)]),
  )
  const vfs = new LayeredVfs([
    { id: 'base-game', kind: 'base', source: base },
    { id: 'mod:example', kind: 'mod', source: mod },
  ])

  assert.equal(vfs.resolve('data/shared.txt').layerId, 'mod:example')
  assert.equal(vfs.resolve('data/base.txt').layerId, 'base-game')
  assert.deepEqual(vfs.list('.txt').sort(), ['data/base.txt', 'data/shared.txt'])
}

function testPublicContracts() {
  assert.equal(window.DCWeb.AsarArchive, AsarArchive)
  assert.equal(window.DCAsar, undefined)
  assert.equal(window.DCVfsRuntime, undefined)
  assert.equal(window.DCCompat, undefined)
  assert.deepEqual(
    Object.keys(window.DCWeb.Runtime).sort(),
    ['copyArrayBufferToRealm', 'install', 'installJQuery', 'rewriteCssValue', 'rewriteMarkup', 'rewriteSrcset'],
  )
}

function testRuntimeRewriters() {
  const runtime = loadRuntime()
  const replacements = {
    'data/image/a.png': 'blob:test/a',
    'data/image/b.png': 'blob:test/b',
    'data/css/theme.css': 'blob:test/theme',
  }
  const resolve = (value) => replacements[value] || value
  const resolveWithQuery = (value) => replacements[value.split(/[?#]/, 1)[0]] || value

  assert.equal(
    runtime.rewriteSrcset('data:image/png;base64,AAAA 1x, data/image/a.png 2x, data/image/b.png 3x', resolve),
    'data:image/png;base64,AAAA 1x, blob:test/a 2x, blob:test/b 3x',
  )
  assert.equal(
    runtime.rewriteSrcset('data/image/a.png?v=1,2 1x, data/image/b.png 2x', resolveWithQuery),
    'blob:test/a 1x, blob:test/b 2x',
  )
  assert.equal(
    runtime.rewriteCssValue('@import "data/css/theme.css";x{background:url(data/image/a.png)}', resolve),
    '@import "blob:test/theme";x{background:url("blob:test/a")}',
  )
  assert.equal(
    runtime.rewriteMarkup('<source srcset="data/image/a.png 1x, data/image/b.png 2x">', resolve),
    '<source srcset="blob:test/a 1x, blob:test/b 2x">',
  )
}

function testRuntimeStyleReadCompatibility() {
  const rawValues = new WeakMap()

  function StyleDeclaration() {
    rawValues.set(this, {})
  }
  function defineStyleProperty(name) {
    Object.defineProperty(StyleDeclaration.prototype, name, {
      configurable: true,
      enumerable: true,
      get() { return rawValues.get(this)[name] || '' },
      set(value) { rawValues.get(this)[name] = value },
    })
  }
  ;[
    'background',
    'backgroundImage',
    'borderImage',
    'content',
    'cssText',
    'cursor',
    'listStyle',
    'listStyleImage',
    'mask',
    'maskImage',
  ].forEach(defineStyleProperty)
  StyleDeclaration.prototype.setProperty = function (name, value) { rawValues.get(this)[name] = value }
  StyleDeclaration.prototype.getPropertyValue = function (name) { return rawValues.get(this)[name] || '' }

  function Element() {}
  Element.prototype.setAttribute = function () {}

  const logicalUrl = 'data/image/menu_Title/collection__.png'
  const blobUrl = 'blob:http://127.0.0.1:4173/title-button'
  const target = { CSSStyleDeclaration: StyleDeclaration, Element }
  const resolver = {
    getObjectUrl(value) { return value === logicalUrl ? blobUrl : value },
    has(value) { return value === logicalUrl },
    restoreObjectUrls(value) { return String(value).split(blobUrl).join(logicalUrl) },
  }

  loadRuntime().install(target, resolver)
  const style = new StyleDeclaration()
  style.backgroundImage = 'url("' + logicalUrl + '")'

  assert.equal(rawValues.get(style).backgroundImage, 'url("' + blobUrl + '")')
  assert.equal(style.backgroundImage, 'url("' + logicalUrl + '")')
  assert.equal(style.getPropertyValue('backgroundImage'), 'url("' + logicalUrl + '")')
}

function testRuntimeDynamicStylePropertyCompatibility() {
  const rawValues = new WeakMap()

  function DynamicStyleDeclaration() {
    rawValues.set(this, {})
  }
  DynamicStyleDeclaration.prototype.setProperty = function (name, value) { rawValues.get(this)[name] = value }
  DynamicStyleDeclaration.prototype.getPropertyValue = function (name) { return rawValues.get(this)[name] || '' }

  function Element() {}
  Element.prototype.setAttribute = function () {}

  const logicalUrl = 'data/image/menu_Title/collection__.png'
  const blobUrl = 'blob:http://127.0.0.1:4173/dynamic-title-button'
  const target = { CSSStyleDeclaration: DynamicStyleDeclaration, Element }
  const resolver = {
    getObjectUrl(value) { return value === logicalUrl ? blobUrl : value },
    has(value) { return value === logicalUrl },
    restoreObjectUrls(value) { return String(value).split(blobUrl).join(logicalUrl) },
  }

  loadRuntime().install(target, resolver)
  const style = new DynamicStyleDeclaration()
  style.backgroundImage = 'url("' + logicalUrl + '")'

  assert.equal(rawValues.get(style)['background-image'], 'url("' + blobUrl + '")')
  assert.equal(style.backgroundImage, 'url("' + logicalUrl + '")')
}

async function main() {
  await testObjectUrlRoundTrip()
  await testFragmentsAndReservedFileNames()
  await testNestedStyles()
  testLayerPrecedence()
  testRuntimeRewriters()
  testRuntimeStyleReadCompatibility()
  testRuntimeDynamicStylePropertyCompatibility()
  testPublicContracts()
  console.log('URL edge-case tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
