'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/asar.js')
const { AsarArchive, normalizePath } = window.DCAsar

function entry(path, offset, size) {
  return [path, { path, offset, size, unpacked: false }]
}

function loadRuntime() {
  global.window = {}
  delete require.cache[require.resolve('../js/vfs-runtime.js')]
  require('../js/vfs-runtime.js')
  return window.DCVfsRuntime
}

async function testObjectUrlRoundTrip() {
  const path = 'data/image/hero & 100%.png'
  const canonical = 'data/image/hero%20%26%20100%25.png'
  const blobUrl = 'blob:http://127.0.0.1:4173/12345678-1234-1234-1234-123456789abc'
  const archive = new AsarArchive(null, {}, 0, new Map())
  archive.pathsByObjectUrl.set(blobUrl, path)

  assert.equal(archive.restoreObjectUrls(blobUrl), canonical)
  assert.equal(archive.restoreObjectUrls(blobUrl + '?v=1&theme=dark#portrait'), canonical + '?v=1&theme=dark#portrait')
  assert.equal(archive.restoreObjectUrls('url(&quot;' + blobUrl + '&quot;)'), 'url(&quot;' + canonical + '&quot;)')
  assert.equal(archive.restoreObjectUrls(blobUrl + ', ' + blobUrl + '#second'), canonical + ', ' + canonical + '#second')

  const encoded = encodeURIComponent(blobUrl + '?v=1&theme=dark')
  assert.equal(decodeURIComponent(archive.restoreObjectUrls(encoded)), canonical + '?v=1&theme=dark')

  const doubleEncoded = encodeURIComponent(encoded)
  assert.equal(
    decodeURIComponent(decodeURIComponent(archive.restoreObjectUrls(doubleEncoded))),
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
  assert.equal(normalizePath('/shared/a.png', 'data/css/main.css'), 'shared/a.png')
  assert.equal(archive.getBlob('data/image/icon%23100%25.svg').type, 'image/svg+xml')

  const objectUrl = archive.getObjectUrl('data/image/icon%23100%25.svg?v=4#symbol')
  assert.match(objectUrl, /^blob:/)
  assert.equal(objectUrl.endsWith('#symbol'), true)
  assert.equal(objectUrl.includes('?v=4'), false)
  assert.equal(archive.restoreObjectUrls(objectUrl), 'data/image/icon%23100%25.svg#symbol')
  archive.release()
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

  await archive.prepareStyles()
  const mainText = await (await fetch(archive.preparedUrls.get('data/css/main.css'))).text()
  const themeText = await (await fetch(archive.preparedUrls.get('data/css/theme.css'))).text()

  assert.equal(mainText.includes(archive.preparedUrls.get('data/css/theme.css')), true)
  assert.deepEqual(Array.from(archive.preparedUrls.keys()).sort(), ['data/css/main.css', 'data/css/theme.css'])
  assert.match(mainText, /blob:[^"')]+#mark/)
  assert.match(themeText, /url\("blob:[^"')]+"\)/)
  assert.equal(themeText.includes('?v=2'), false)
  archive.release()
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

async function main() {
  await testObjectUrlRoundTrip()
  await testFragmentsAndReservedFileNames()
  await testNestedStyles()
  testRuntimeRewriters()
  console.log('URL edge-case tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
