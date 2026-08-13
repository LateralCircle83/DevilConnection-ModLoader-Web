'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')
require('../js/kernel/asar-archive.js')
require('../js/kernel/layered-vfs.js')
require('../js/kernel/object-url-registry.js')
require('../js/kernel/style-processor.js')
require('../js/kernel/asset-resolver.js')
require('../js/kernel/resource-rewriter.js')
require('../js/kernel/browser-runtime.js')

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

async function testPreparedTextIsTheActiveSessionResource() {
  const source = '.hero{background:url("../image/original.png")}'
  const archive = new AsarArchive(
    new Blob([source]),
    {},
    0,
    new Map([entry('data/css/main.css', 0, Buffer.byteLength(source))]),
  )
  const resolver = createResolver(archive)
  const patched = '.hero{color:red}'

  resolver.prepareText('data/css/main.css', patched, 'text/css')
  await resolver.prepareStyles()
  assert.equal(await resolver.readText('data/css/main.css'), patched)
  assert.equal(await resolver.getBlob('data/css/main.css').text(), patched)
  assert.equal(await (await fetch(resolver.getObjectUrl('data/css/main.css'))).text(), patched)
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
  const computedStyle = new StyleDeclaration()
  rawValues.get(computedStyle).backgroundImage = 'url("' + blobUrl + '")'
  style.backgroundImage = 'url("' + logicalUrl + '")'

  assert.equal(rawValues.get(style).backgroundImage, 'url("' + blobUrl + '")')
  assert.equal(style.backgroundImage, 'url("' + logicalUrl + '")')
  assert.equal(style.getPropertyValue('backgroundImage'), 'url("' + logicalUrl + '")')
  assert.equal(computedStyle.backgroundImage, 'url("' + blobUrl + '")')
  assert.equal(computedStyle.getPropertyValue('backgroundImage'), 'url("' + blobUrl + '")')
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
    getObjectUrl(value) {
      const fragment = value.includes('#') ? value.slice(value.indexOf('#')) : ''
      return value.split('#', 1)[0] === logicalUrl ? blobUrl + fragment : value
    },
    has(value) { return value.split('#', 1)[0] === logicalUrl },
    restoreObjectUrls(value) { return String(value).split(blobUrl).join(logicalUrl) },
  }

  loadRuntime().install(target, resolver)
  const style = new DynamicStyleDeclaration()
  style.backgroundImage = 'url("' + logicalUrl + '")'
  style.filter = 'url("' + logicalUrl + '#blur")'
  style.clipPath = 'url("' + logicalUrl + '#clip")'
  style.borderImageSource = 'url("' + logicalUrl + '")'

  assert.equal(rawValues.get(style)['background-image'], 'url("' + blobUrl + '")')
  assert.equal(style.backgroundImage, 'url("' + logicalUrl + '")')
  assert.equal(rawValues.get(style).filter, 'url("' + blobUrl + '#blur")')
  assert.equal(style.filter, 'url("' + logicalUrl + '#blur")')
  assert.equal(rawValues.get(style)['clip-path'], 'url("' + blobUrl + '#clip")')
  assert.equal(style.clipPath, 'url("' + logicalUrl + '#clip")')
  assert.equal(rawValues.get(style)['border-image-source'], 'url("' + blobUrl + '")')
  assert.equal(style.borderImageSource, 'url("' + logicalUrl + '")')
}

function testRuntimeAttributeAndMarkupReadCompatibility() {
  const attributes = new WeakMap()
  const markup = new WeakMap()

  function Element(tag) {
    this.tagName = tag
    attributes.set(this, new Map())
    markup.set(this, { innerHTML: '', outerHTML: '' })
  }
  Element.prototype.setAttribute = function (name, value) { attributes.get(this).set(name, String(value)) }
  Element.prototype.getAttribute = function (name) {
    const values = attributes.get(this)
    return values.has(name) ? values.get(name) : null
  }
  Element.prototype.setAttributeNS = function (namespace, name, value) { this.setAttribute(name, value) }
  Element.prototype.getAttributeNS = function (namespace, name) { return this.getAttribute(name) }
  ;['innerHTML', 'outerHTML'].forEach(function (property) {
    Object.defineProperty(Element.prototype, property, {
      configurable: true,
      enumerable: true,
      get() { return markup.get(this)[property] },
      set(value) { markup.get(this)[property] = String(value) },
    })
  })

  function ImageElement() {
    Element.call(this, 'IMG')
  }
  ImageElement.prototype = Object.create(Element.prototype)
  ImageElement.prototype.constructor = ImageElement
  Object.defineProperty(ImageElement.prototype, 'src', {
    configurable: true,
    enumerable: true,
    get() { return attributes.get(this).get('src') || '' },
    set(value) { attributes.get(this).set('src', String(value)) },
  })

  const logicalUrl = 'data/image/menu_Title/collection__.png'
  const blobUrl = 'blob:http://127.0.0.1:4173/title-attribute'
  const target = { Element, HTMLImageElement: ImageElement }
  const resolver = {
    getObjectUrl(value) { return value === logicalUrl ? blobUrl : value },
    has(value) { return value === logicalUrl },
    restoreObjectUrls(value) { return String(value).split(blobUrl).join(logicalUrl) },
  }

  loadRuntime().install(target, resolver)
  const image = new ImageElement()
  image.src = logicalUrl
  assert.equal(attributes.get(image).get('src'), blobUrl)
  assert.equal(image.getAttribute('src'), logicalUrl)
  assert.equal(image.src, blobUrl)

  const link = new Element('LINK')
  link.setAttribute('href', logicalUrl)
  assert.equal(attributes.get(link).get('href'), blobUrl)
  assert.equal(link.getAttribute('href'), logicalUrl)

  const anchor = new Element('A')
  anchor.setAttribute('href', logicalUrl)
  assert.equal(attributes.get(anchor).get('href'), logicalUrl)

  const svgImage = new Element('image')
  svgImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', logicalUrl)
  assert.equal(attributes.get(svgImage).get('href'), blobUrl)
  assert.equal(svgImage.getAttributeNS('http://www.w3.org/1999/xlink', 'href'), logicalUrl)

  const container = new Element('DIV')
  container.innerHTML = '<img src="' + logicalUrl + '">'
  assert.equal(markup.get(container).innerHTML, '<img src="' + blobUrl + '">')
  assert.equal(container.innerHTML, '<img src="' + logicalUrl + '">')
}

function testJQueryAttributeReadCompatibility() {
  const logicalUrl = 'data/image/menu_Title/collection__.png'
  const blobUrl = 'blob:http://127.0.0.1:4173/jquery-title-attribute'
  const element = { tagName: 'IMG', values: { src: blobUrl } }

  function JQuery(items) {
    this[0] = items[0]
    this.length = items.length
  }
  JQuery.prototype.attr = function (name, value) {
    if (arguments.length === 1) return this[0].values[name]
    this[0].values[name] = value
    return this
  }
  JQuery.prototype.css = function () { return this }
  const $ = function (item) { return new JQuery([item]) }
  $.fn = JQuery.prototype

  const resolver = {
    getObjectUrl(value) { return value === logicalUrl ? blobUrl : value },
    has(value) { return value === logicalUrl },
    restoreObjectUrls(value) { return String(value).split(blobUrl).join(logicalUrl) },
  }
  loadRuntime().installJQuery({ jQuery: $ }, resolver)

  assert.equal($(element).attr('src'), logicalUrl)
  assert.equal($(element).attr('title'), undefined)
}

function testRuntimeInsertionRewritesBeforeNativeCall() {
  const calls = []

  function Element(tag) {
    this.tagName = tag || 'DIV'
    this.nodeType = 1
    this.attributes = new Map()
  }
  Element.prototype.setAttribute = function (name, value) { this.attributes.set(name, String(value)) }
  Element.prototype.getAttribute = function (name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
  Element.prototype.hasAttribute = function (name) { return this.attributes.has(name) }
  Element.prototype.querySelectorAll = function () { return [] }
  Element.prototype.append = function (node) { calls.push(['append', node.attributes.get('src')]) }
  Element.prototype.insertAdjacentElement = function (position, node) {
    calls.push(['insertAdjacentElement', node.attributes.get('src')])
  }

  function Node() {}
  Node.prototype.appendChild = function (node) { calls.push(['appendChild', node.attributes.get('src')]); return node }
  Node.prototype.insertBefore = function (node) { calls.push(['insertBefore', node.attributes.get('src')]); return node }
  Node.prototype.replaceChild = function (node) { calls.push(['replaceChild', node.attributes.get('src')]); return node }

  const logicalUrl = 'data/image/inserted.png'
  const blobUrl = 'blob:http://127.0.0.1:4173/inserted'
  const target = { Element, Node }
  const resolver = {
    getObjectUrl(value) { return value === logicalUrl ? blobUrl : value },
    has(value) { return value === logicalUrl },
    restoreObjectUrls(value) { return String(value).split(blobUrl).join(logicalUrl) },
  }
  loadRuntime().install(target, resolver)

  const parent = new Element('DIV')
  const createImage = function () {
    const image = new Element('IMG')
    image.attributes.set('src', logicalUrl)
    return image
  }
  parent.append(createImage())
  parent.insertAdjacentElement('beforeend', createImage())
  Node.prototype.appendChild.call(parent, createImage())
  Node.prototype.insertBefore.call(parent, createImage(), null)
  Node.prototype.replaceChild.call(parent, createImage(), null)

  assert.deepEqual(calls, [
    ['append', blobUrl],
    ['insertAdjacentElement', blobUrl],
    ['appendChild', blobUrl],
    ['insertBefore', blobUrl],
    ['replaceChild', blobUrl],
  ])
}

function testRuntimeStyleTextRewritesBeforeInsertion() {
  const textContent = new WeakMap()

  function Node() {}
  Object.defineProperty(Node.prototype, 'textContent', {
    configurable: true,
    enumerable: true,
    get() { return textContent.get(this) || '' },
    set(value) { textContent.set(this, String(value)) },
  })
  Node.prototype.appendChild = function (node) { return node }
  Node.prototype.insertBefore = function (node) { return node }

  function Element(tag) {
    this.tagName = tag || 'DIV'
    this.nodeType = 1
  }
  Element.prototype = Object.create(Node.prototype)
  Element.prototype.constructor = Element
  Element.prototype.setAttribute = function () {}
  Element.prototype.getAttribute = function () { return null }
  Element.prototype.hasAttribute = function () { return false }
  Element.prototype.querySelectorAll = function () { return [] }

  const logicalUrl = './data/image/cursor3.png'
  const blobUrl = 'blob:http://127.0.0.1:4173/cursor3'
  const target = { Element, Node }
  const resolver = {
    getObjectUrl(value) { return value === logicalUrl ? blobUrl : value },
    has(value) { return value === logicalUrl },
    restoreObjectUrls(value) { return String(value).split(blobUrl).join(logicalUrl) },
  }

  loadRuntime().install(target, resolver)
  const style = new Element('STYLE')
  style.textContent = '.item{cursor:url("' + logicalUrl + '") 6 1,pointer}'

  assert.equal(
    textContent.get(style),
    '.item{cursor:url("' + blobUrl + '") 6 1,pointer}',
  )
  assert.equal(
    style.textContent,
    '.item{cursor:url("' + logicalUrl + '") 6 1,pointer}',
  )

  const ordinaryNode = new Element('DIV')
  ordinaryNode.textContent = 'blob URLs in ordinary text stay untouched: ' + blobUrl
  assert.equal(ordinaryNode.textContent, 'blob URLs in ordinary text stay untouched: ' + blobUrl)
}

async function main() {
  await testObjectUrlRoundTrip()
  await testFragmentsAndReservedFileNames()
  await testNestedStyles()
  await testPreparedTextIsTheActiveSessionResource()
  testLayerPrecedence()
  testRuntimeRewriters()
  testRuntimeStyleReadCompatibility()
  testRuntimeDynamicStylePropertyCompatibility()
  testRuntimeAttributeAndMarkupReadCompatibility()
  testJQueryAttributeReadCompatibility()
  testRuntimeInsertionRewritesBeforeNativeCall()
  testRuntimeStyleTextRewritesBeforeInsertion()
  testPublicContracts()
  console.log('URL edge-case tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
