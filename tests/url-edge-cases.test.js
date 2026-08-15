'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')
require('../js/kernel/asar-archive.js')
require('../js/kernel/layered-vfs.js')
require('../js/kernel/object-url-registry.js')
require('../js/kernel/style-processor.js')
require('../js/kernel/media-source-fallback.js')
require('../js/kernel/mp4-visual-fallback.js')
require('../js/kernel/asset-resolver.js')
require('../js/kernel/resource-rewriter.js')
require('../js/kernel/resource-readiness.js')
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
  const stats = resolver.getObjectUrlStats()
  assert.equal(stats.count, 1)
  assert.equal(stats.logicalBytes, Buffer.byteLength(bytes))
  assert.equal(stats.peakCount, 1)
  assert.equal(stats.peakLogicalBytes, Buffer.byteLength(bytes))
  assert.deepEqual(Object.keys(stats.categories), ['style', 'image', 'audio', 'video', 'font', 'text', 'binary'])
  assert.deepEqual(stats.categories.image, {
    count: 1,
    logicalBytes: Buffer.byteLength(bytes),
    peakCount: 1,
    peakLogicalBytes: Buffer.byteLength(bytes),
  })
  resolver.release()
  assert.equal(resolver.getObjectUrlStats().count, 0)
  assert.equal(resolver.getObjectUrlStats().categories.image.count, 0)
  assert.equal(resolver.getObjectUrlStats().categories.image.peakCount, 1)
}

async function testNestedStyles() {
  const main = '@import "Theme.css" screen;\n.logo{mask:url("../image/icons.svg#mark")}'
  const theme = '.hero{background:url("../image/hero.png?v=2")}'
  const icon = '<svg></svg>'
  const image = 'png'
  const unused = '.unused{background:url("../image/unused.png")}'
  const unusedImage = 'unused'
  const all = main + theme + icon + image + unused + unusedImage
  const entries = new Map([
    entry('data/css/main.css', 0, Buffer.byteLength(main)),
    entry('data/css/theme.css', Buffer.byteLength(main), Buffer.byteLength(theme)),
    entry('data/image/icons.svg', Buffer.byteLength(main + theme), Buffer.byteLength(icon)),
    entry('data/image/hero.png', Buffer.byteLength(main + theme + icon), Buffer.byteLength(image)),
    entry('data/css/unused.css', Buffer.byteLength(main + theme + icon + image), Buffer.byteLength(unused)),
    entry('data/image/unused.png', Buffer.byteLength(main + theme + icon + image + unused), Buffer.byteLength(unusedImage)),
  ])
  const archive = new AsarArchive(new Blob([all]), {}, 0, entries)

  const resolver = createResolver(archive)
  await resolver.prepareStyles()
  assert.equal(resolver.getObjectUrlStats().count, 0)
  assert.equal(resolver.hasPrepared('data/css/unused.css'), true)
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
  const stats = resolver.getObjectUrlStats()
  assert.equal(stats.count, 4)
  assert.equal(stats.categories.style.count, 2)
  assert.equal(stats.categories.image.count, 2)
  assert.equal(Array.from(resolver.registry.pathsByUrl.values()).includes('data/css/unused.css'), false)
  assert.equal(Array.from(resolver.registry.pathsByUrl.values()).includes('data/image/unused.png'), false)
  resolver.release()
}

async function testCircularStylesDoNotRetainRevokedUrls() {
  const first = '@import "b.css";\n.a{color:red}'
  const second = '@import "a.css";\n.b{color:blue}'
  const archive = new AsarArchive(
    new Blob([first, second]),
    {},
    0,
    new Map([
      entry('data/a.css', 0, Buffer.byteLength(first)),
      entry('data/b.css', Buffer.byteLength(first), Buffer.byteLength(second)),
    ]),
  )
  const resolver = createResolver(archive)

  await resolver.prepareStyles()
  const firstUrl = resolver.getObjectUrl('data/a.css')
  const secondUrl = resolver.getObjectUrl('data/b.css')
  const firstText = await (await fetch(firstUrl)).text()
  const secondText = await (await fetch(secondUrl)).text()

  assert.equal(firstText.includes(secondUrl), true)
  assert.equal(secondText.includes('data:text/css;charset=utf-8,'), true)
  assert.equal(secondText.includes('blob:'), false)
  assert.equal(resolver.getObjectUrlStats().count, 2)
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
  assert.equal(resolver.getObjectUrlStats().count, 0)
  await resolver.prepareStyles()
  assert.equal(resolver.getObjectUrlStats().count, 0)
  assert.equal(await resolver.readText('data/css/main.css'), patched)
  assert.equal(await resolver.getBlob('data/css/main.css').text(), patched)
  assert.equal(await (await fetch(resolver.getObjectUrl('data/css/main.css'))).text(), patched)
  assert.equal(resolver.getObjectUrlStats().count, 1)
  assert.throws(
    () => resolver.prepareText('data/css/main.css', '.hero{color:blue}', 'text/css'),
    /after publishing its object URL/,
  )
  resolver.release()
}

async function testPreparedBinaryIsTheActiveSessionResource() {
  const source = Buffer.from([1, 2, 3, 4])
  const archive = new AsarArchive(
    new Blob([source]),
    {},
    0,
    new Map([entry('data/video/effect.mp4', 0, source.length)]),
  )
  const resolver = createResolver(archive)
  const patched = Uint8Array.from([9, 8, 7, 6])

  resolver.prepareBinary('data/video/effect.mp4', patched, 'video/mp4')
  assert.deepEqual(Array.from(new Uint8Array(await resolver.getBlob('data/video/effect.mp4').arrayBuffer())), Array.from(patched))
  const response = await fetch(resolver.getObjectUrl('data/video/effect.mp4'))
  assert.equal(response.headers.get('content-type'), 'video/mp4')
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), Array.from(patched))
  assert.throws(
    () => resolver.prepareBinary('data/video/effect.mp4', source, 'video/mp4'),
    /after publishing its object URL/,
  )
  resolver.release()
}

async function testXmlHttpRequestUsesLogicalResponseUrl() {
  const source = 'small scenario'
  const archive = new AsarArchive(
    new Blob([source]),
    {},
    0,
    new Map([entry('data/scenario/start.ks', 0, Buffer.byteLength(source))]),
  )
  const resolver = createResolver(archive)

  function Event(type) { this.type = type }
  function NativeXMLHttpRequest() {}
  const target = {
    Blob,
    Event,
    URL,
    XMLHttpRequest: NativeXMLHttpRequest,
    document: {
      baseURI: 'http://127.0.0.1:4173/index.html',
      documentElement: { setAttribute() {} },
    },
    location: { href: 'about:srcdoc' },
  }
  loadRuntime().install(target, resolver)

  const xhr = await new Promise(function (resolve) {
    const request = new target.XMLHttpRequest()
    request.open('GET', 'data/scenario/start.ks?v=4')
    request.addEventListener('loadend', function () { resolve(request) })
    request.send()
  })

  assert.equal(xhr.status, 200)
  assert.equal(xhr.responseText, source)
  assert.equal(xhr.responseURL, 'http://127.0.0.1:4173/data/scenario/start.ks')
  assert.equal(resolver.getObjectUrlStats().count, 0)
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
    ['copyArrayBufferToRealm', 'install', 'installJQuery', 'readArrayBufferInRealm', 'rewriteCssValue', 'rewriteMarkup', 'rewriteSrcset'],
  )
}

async function testRealmLocalArrayBufferReadAvoidsCopyFallback() {
  let blobConstructions = 0
  let copies = 0
  function RealmBlob(parts, options) {
    blobConstructions++
    return new Blob(parts, options)
  }
  function CountingUint8Array(length) {
    copies++
    return new Uint8Array(length)
  }
  const target = {
    ArrayBuffer,
    Blob: RealmBlob,
    Uint8Array: CountingUint8Array,
  }

  const value = await loadRuntime().readArrayBufferInRealm(target, new Blob(['realm bytes']))
  assert.equal(value instanceof target.ArrayBuffer, true)
  assert.equal(Buffer.from(value).toString(), 'realm bytes')
  assert.equal(blobConstructions, 1)
  assert.equal(copies, 0)
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

async function testManagedVideoRetriesOnceThroughMediaSource() {
  const attributes = new WeakMap()
  const rootAttributes = new Map()
  const logicalUrl = 'data/video/title_intro.mp4'
  const visualLogicalUrl = 'data/video/mod-effect.mp4'
  const blobUrl = 'blob:http://127.0.0.1:4173/title-intro'
  const visualBlobUrl = 'blob:http://127.0.0.1:4173/mod-effect'
  const mseUrl = 'blob:http://127.0.0.1:4173/title-intro-mse'
  const visualUrl = 'blob:http://127.0.0.1:4173/mod-effect-visual'
  let createCalls = 0
  let loadCalls = 0
  let releaseCalls = 0
  let visualCalls = 0
  const warnings = []

  function Element(tag) {
    this.tagName = tag || 'DIV'
    this.nodeType = 1
    this.parentNode = null
    attributes.set(this, new Map())
  }
  Element.prototype.setAttribute = function (name, value) { attributes.get(this).set(name, String(value)) }
  Element.prototype.getAttribute = function (name) { return attributes.get(this).get(name) || null }
  Element.prototype.hasAttribute = function (name) { return attributes.get(this).has(name) }
  Element.prototype.querySelectorAll = function () { return [] }

  function MediaElement(tag) {
    Element.call(this, tag)
    this.error = null
    this.networkState = 0
    this.paused = true
    this.readyState = 0
    this.listeners = new Map()
  }
  MediaElement.prototype = Object.create(Element.prototype)
  MediaElement.prototype.constructor = MediaElement
  MediaElement.prototype.addEventListener = function (type, listener) {
    const values = this.listeners.get(type) || []
    values.push(listener)
    this.listeners.set(type, values)
  }
  MediaElement.prototype.removeEventListener = function (type, listener) {
    const values = this.listeners.get(type) || []
    const index = values.indexOf(listener)
    if (index !== -1) values.splice(index, 1)
  }
  MediaElement.prototype.emit = function (type) {
    ;(this.listeners.get(type) || []).slice().forEach((listener) => listener.call(this, { type }))
  }
  MediaElement.prototype.load = function () { loadCalls++ }
  Object.defineProperty(MediaElement.prototype, 'src', {
    configurable: true,
    enumerable: true,
    get() { return attributes.get(this).get('src') || '' },
    set(value) { attributes.get(this).set('src', String(value)) },
  })

  const target = {
    Element,
    HTMLMediaElement: MediaElement,
    Promise,
    console: { warn(message) { warnings.push(String(message)) } },
    document: {
      documentElement: {
        getAttribute(name) { return rootAttributes.get(name) || null },
        setAttribute(name, value) { rootAttributes.set(name, String(value)) },
      },
    },
    setTimeout,
    clearTimeout,
  }
  const resolver = {
    createMediaSourceObjectUrl(source, maxBytes) {
      createCalls++
      assert.equal(maxBytes, window.DCWeb.MediaSourceFallback.MAX_BYTES)
      if (source === visualLogicalUrl) return Promise.resolve(null)
      assert.equal(source, logicalUrl)
      return Promise.resolve({
        mimeType: 'video/mp4; codecs="avc1.640028, mp4a.40.2"',
        ready: Promise.resolve({ ok: true, state: 'buffered' }),
        release() { releaseCalls++; return true },
        url: mseUrl,
      })
    },
    createVisualOnlyMediaObjectUrl(source) {
      visualCalls++
      assert.equal(source, visualLogicalUrl)
      return Promise.resolve({
        audioCodec: 'mp4a.40.2',
        sourceKind: 'mod',
        sourceLayerId: 'mod:unknown-video',
        videoCodec: 'avc1.640028',
        release() { releaseCalls++; return true },
        url: visualUrl,
      })
    },
    getObjectUrl(value) {
      if (value === logicalUrl) return blobUrl
      if (value === visualLogicalUrl) return visualBlobUrl
      return value
    },
    has(value) { return value === logicalUrl || value === visualLogicalUrl },
    restoreObjectUrls(value) {
      if (value === blobUrl || value === mseUrl) return logicalUrl
      if (value === visualBlobUrl || value === visualUrl) return visualLogicalUrl
      return value
    },
  }

  loadRuntime().install(target, resolver)
  const video = new MediaElement('VIDEO')
  video.src = logicalUrl
  assert.equal(attributes.get(video).get('src'), blobUrl)

  video.error = { code: 3, message: 'decode failed' }
  video.emit('error')
  await Promise.resolve()
  assert.equal(createCalls, 0)

  video.error = { code: 4, message: 'PipelineStatus::DEMUXER_ERROR_DETECTED_AAC' }
  video.emit('error')
  video.emit('error')
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(createCalls, 1)
  assert.equal(attributes.get(video).get('src'), mseUrl)
  assert.equal(loadCalls, 1)
  assert.equal(createCalls, 1)

  video.error = null
  video.emit('loadedmetadata')
  assert.equal(rootAttributes.get('data-dc-media-fallback-state'), 'mse-recovered')
  assert.equal(visualCalls, 0)
  assert.deepEqual(warnings, [])
  video.src = 'https://example.com/external.mp4'
  assert.equal(releaseCalls, 1)

  const visualVideo = new MediaElement('VIDEO')
  visualVideo.src = visualLogicalUrl
  assert.equal(attributes.get(visualVideo).get('src'), visualBlobUrl)
  visualVideo.error = { code: 4, message: 'PipelineStatus::DEMUXER_ERROR_DETECTED_AAC' }
  visualVideo.emit('error')
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(createCalls, 2)
  assert.equal(visualCalls, 1)
  assert.equal(attributes.get(visualVideo).get('src'), visualUrl)
  assert.equal(loadCalls, 2)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /Visual-only recovery dropped AAC audio/)
  assert.match(warnings[0], /data\/video\/mod-effect\.mp4/)
  assert.match(warnings[0], /mod:unknown-video/)
  assert.match(warnings[0], /mp4a\.40\.2/)

  visualVideo.error = null
  visualVideo.emit('loadedmetadata')
  assert.equal(rootAttributes.get('data-dc-media-fallback-state'), 'visual-only-recovered')
  visualVideo.src = 'https://example.com/external.mp4'
  assert.equal(releaseCalls, 2)
}

async function main() {
  await testObjectUrlRoundTrip()
  await testFragmentsAndReservedFileNames()
  await testNestedStyles()
  await testCircularStylesDoNotRetainRevokedUrls()
  await testPreparedTextIsTheActiveSessionResource()
  await testPreparedBinaryIsTheActiveSessionResource()
  await testXmlHttpRequestUsesLogicalResponseUrl()
  await testRealmLocalArrayBufferReadAvoidsCopyFallback()
  testLayerPrecedence()
  testRuntimeRewriters()
  testRuntimeStyleReadCompatibility()
  testRuntimeDynamicStylePropertyCompatibility()
  testRuntimeAttributeAndMarkupReadCompatibility()
  testJQueryAttributeReadCompatibility()
  testRuntimeInsertionRewritesBeforeNativeCall()
  testRuntimeStyleTextRewritesBeforeInsertion()
  await testManagedVideoRetriesOnceThroughMediaSource()
  testPublicContracts()
  console.log('URL edge-case tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
