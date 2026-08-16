'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

global.window = { URL }
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')
require('../js/kernel/asar-archive.js')
require('../js/shell/recommended-mods-controller.js')

const root = path.join(__dirname, '..')
const recommendedRoot = path.join(root, 'recommended-mods')
const catalogPath = path.join(recommendedRoot, 'catalog.json')
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8')
const Catalog = window.DCWeb.RecommendedModsCatalog
const RecommendedModsController = window.DCWeb.RecommendedModsController
const staticServer = require('../tools/static-server.js')

function sampleCatalog() {
  return {
    schemaVersion: 1,
    mods: [{
      author: 'Example author',
      description: 'A verified example mod',
      file: 'example_mod.asar',
      id: 'example_mod',
      name: 'Example mod',
      size: 1234,
      version: '1.0.0',
    }],
  }
}

function testCatalogValidation() {
  const normalized = Catalog.normalize(sampleCatalog(), 'http://127.0.0.1:4173/', URL)
  assert.equal(normalized.length, 1)
  assert.equal(normalized[0].downloadUrl, 'http://127.0.0.1:4173/recommended-mods/example_mod.asar')
  assert.equal(normalized[0].external, false)
  assert.equal(Object.isFrozen(normalized), true)
  assert.equal(Object.isFrozen(normalized[0]), true)

  const traversal = sampleCatalog()
  traversal.mods[0].file = '../app.asar'
  assert.throws(() => Catalog.normalize(traversal, 'http://127.0.0.1:4173/', URL), /file 无效/)

  const external = sampleCatalog()
  external.mods[0].file = 'https://github.com/example/project/releases/download/v1.0.0/example_mod.asar'
  const normalizedExternal = Catalog.normalize(external, 'http://127.0.0.1:4173/', URL)
  assert.equal(normalizedExternal[0].fileName, 'example_mod.asar')
  assert.equal(normalizedExternal[0].downloadUrl, external.mods[0].file)
  assert.equal(normalizedExternal[0].external, true)

  const insecure = sampleCatalog()
  insecure.mods[0].file = 'http://github.com/example/project/releases/download/v1.0.0/example_mod.asar'
  assert.throws(() => Catalog.normalize(insecure, 'http://127.0.0.1:4173/', URL), /file 无效/)

  const unsupportedHost = sampleCatalog()
  unsupportedHost.mods[0].file = 'https://example.com/example_mod.asar'
  assert.throws(() => Catalog.normalize(unsupportedHost, 'http://127.0.0.1:4173/', URL), /file 无效/)

  const externalQuery = sampleCatalog()
  externalQuery.mods[0].file = 'https://github.com/example/project/releases/download/v1.0.0/example_mod.asar?raw=1'
  assert.throws(() => Catalog.normalize(externalQuery, 'http://127.0.0.1:4173/', URL), /file 无效/)

  const duplicate = sampleCatalog()
  duplicate.mods.push(Object.assign({}, duplicate.mods[0]))
  assert.throws(() => Catalog.normalize(duplicate, 'http://127.0.0.1:4173/', URL), /重复 id/)

  const minimal = Catalog.normalize({
    schemaVersion: 1,
    mods: [{ id: 'minimal', name: 'Minimal', file: 'minimal.asar' }],
  }, 'http://127.0.0.1:4173/', URL)
  assert.equal(minimal[0].description, '')
  assert.equal(minimal[0].size, 0)
}

async function testControllerLoadsOnceAndRetries() {
  let requestCount = 0
  let listener = null
  const renders = []
  const target = {
    URL,
    console: { warn() {} },
    document: { baseURI: 'http://127.0.0.1:4173/' },
    async fetch(url, options) {
      requestCount += 1
      assert.equal(url, './recommended-mods/catalog.json')
      assert.equal(options.cache, 'no-store')
      assert.equal(options.credentials, 'same-origin')
      return { ok: true, status: 200, async json() { return sampleCatalog() } }
    },
  }
  const view = {
    onRecommendedModsRequested(callback) { listener = callback },
    renderRecommendedMods(value) { renders.push(value) },
  }
  const controller = new RecommendedModsController(target, view)
  controller.bind()
  assert.equal(typeof listener, 'function')
  await controller.load(false)
  assert.deepEqual(renders.map((entry) => entry.state), ['loading', 'ready'])
  assert.equal(requestCount, 1)
  await controller.load(false)
  assert.equal(requestCount, 1)
  await controller.load(true)
  assert.equal(requestCount, 2)
}

async function testRepositoryCatalog() {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  const normalized = Catalog.normalize(catalog, 'http://127.0.0.1:4173/', URL)
  const localMods = normalized.filter((mod) => !mod.external)
  const externalMods = normalized.filter((mod) => mod.external)
  const catalogFiles = localMods.map((mod) => mod.fileName).sort()
  const directoryFiles = fs.readdirSync(recommendedRoot).filter((file) => file.endsWith('.asar')).sort()

  assert.deepEqual(catalogFiles, directoryFiles)
  assert.deepEqual(externalMods.map((mod) => mod.id).sort(), [
    'dc_doeru_plus',
    'dc_kupya_plus',
    'dc_modworkshop',
    'dc_theatre',
    'dc_translate_zh_cn',
  ])

  for (const mod of localMods) {
    const filePath = path.join(recommendedRoot, mod.fileName)
    const stats = fs.statSync(filePath)
    assert.equal(stats.isFile(), true)
    assert.equal(stats.size, mod.size)
  }
  for (const mod of externalMods) {
    assert.equal(fs.existsSync(path.join(recommendedRoot, mod.fileName)), false)
    assert.match(mod.downloadUrl, /^https:\/\/(?:github\.com|raw\.githubusercontent\.com)\//)
  }
}

async function testToolboxPackage() {
  const packagePath = path.join(recommendedRoot, 'dc_toolbox.asar')
  const packageBlob = new Blob([fs.readFileSync(packagePath)])
  Object.defineProperty(packageBlob, 'name', { configurable: true, value: 'dc_toolbox.asar' })
  const archive = await window.DCWeb.AsarArchive.open(packageBlob)
  const hook = await archive.readText('hook.js')
  const manifest = JSON.parse(await archive.readText('mods.json'))

  assert.deepEqual(archive.list(), ['hook.js', 'mods.json'])
  assert.match(hook, /e\.key === 'F9'/)
  assert.doesNotMatch(hook, /dct-float-btn|浮动按钮/)
  assert.equal(manifest.version, 102)
  assert.equal(manifest.displayVersion, '1.0.2')
  assert.match(manifest.description, /F9/)
}

function testStaticServerBoundary() {
  const packagePath = staticServer.resolvePublicFile('/recommended-mods/example_mod.asar', new Set(['example_mod.asar']))
  assert.match(packagePath, /recommended-mods[\\/]example_mod\.asar$/)
  assert.match(staticServer.resolvePublicFile('/recommended-mods/catalog.json'), /recommended-mods[\\/]catalog\.json$/)
  assert.match(staticServer.resolvePublicFile('/recommended-mods/dc_debug.asar'), /recommended-mods[\\/]dc_debug\.asar$/)
  assert.equal(staticServer.resolvePublicFile('/recommended-mods/dc_translate_zh_cn.asar'), null)
  assert.equal(staticServer.resolvePublicFile('/recommended-mods/dc_theatre.asar'), null)
  assert.equal(staticServer.resolvePublicFile('/recommended-mods/example_mod.asar'), null)
  assert.equal(staticServer.resolvePublicFile('/app.asar'), null)
  assert.equal(staticServer.resolvePublicFile('/mods/example_mod.asar'), null)
  assert.equal(staticServer.resolvePublicFile('/recommended-mods/nested/example_mod.asar'), null)
  assert.equal(staticServer.resolvePublicFile('/recommended-mods/example_mod.asar?download=1'), null)
  assert.equal(staticServer.resolvePublicFile('/recommended-mods/example_mod.asar#fragment'), null)
  assert.equal(staticServer.resolvePublicFile('/recommended-mods/example_mod.asar.unpacked/file'), null)

  const packageHeaders = staticServer.createResponseHeaders(packagePath, 1234)
  assert.equal(packageHeaders['Content-Type'], 'application/octet-stream')
  assert.equal(packageHeaders['Content-Disposition'], 'attachment; filename="example_mod.asar"')
  const indexHeaders = staticServer.createResponseHeaders(path.join(root, 'index.html'), 100)
  assert.equal(indexHeaders['Content-Disposition'], undefined)
}

function testManagerMarkupAndResponsiveLayout() {
  assert.match(html, /recommended-mods-controller\.js/)
  assert.match(html, /id="mods-view-installed"[\s\S]*?data-mod-view="installed"/)
  assert.match(html, /id="mods-view-recommended"[\s\S]*?data-mod-view="recommended"/)
  assert.match(html, /id="mods-panel-recommended"[\s\S]*?data-mod-panel="recommended"/)
  assert.match(html, /id="recommended-mod-list"/)
  const mobileCss = css.slice(css.indexOf('@media (max-width: 640px)'))
  assert.match(mobileCss, /\.mods-view-switch\s*\{[\s\S]*?width:\s*100%/)
  assert.match(mobileCss, /\.recommended-mod-item\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.match(mobileCss, /\.recommended-mod-download\s*\{[\s\S]*?width:\s*100%/)
}

async function main() {
  testCatalogValidation()
  await testControllerLoadsOnceAndRetries()
  await testRepositoryCatalog()
  await testToolboxPackage()
  testStaticServerBoundary()
  testManagerMarkupAndResponsiveLayout()
  console.log('Recommended mods tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
