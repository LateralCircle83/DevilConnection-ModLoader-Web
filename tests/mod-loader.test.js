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
require('../js/mods/mod-config-store.js')
require('../js/mods/mod-package.js')
require('../js/mods/mod-plan.js')
require('../js/mods/mod-runtime.js')

const {
  AsarArchive,
  AssetResolver,
  LayeredVfs,
  ModPackage,
  ModPlan,
  ModRuntime,
  ResourcePath,
} = window.DCWeb

function align4(value) {
  return value + ((4 - (value % 4)) % 4)
}

function buildHeader(files) {
  const root = { files: {} }
  let offset = 0
  Object.entries(files).forEach(([path, value]) => {
    const parts = path.replace(/\\/g, '/').split('/')
    let branch = root
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        const size = Buffer.byteLength(value)
        branch.files[part] = { offset: String(offset), size }
        offset += size
      } else {
        branch.files[part] ||= { files: {} }
        branch = branch.files[part]
      }
    })
  })
  return root
}

function createAsar(files, name, layout = 'standard') {
  const headerJson = Buffer.from(JSON.stringify(buildHeader(files)))
  const dataOffset = 16 + align4(headerJson.length)
  const header = Buffer.alloc(dataOffset)
  header.writeUInt32LE(4, 0)
  if (layout === 'legacy') {
    header.writeUInt32LE(dataOffset, 4)
    header.writeUInt32LE(0, 8)
  } else {
    const headerSize = dataOffset - 8
    header.writeUInt32LE(headerSize, 4)
    header.writeUInt32LE(headerSize - 4, 8)
  }
  header.writeUInt32LE(headerJson.length, 12)
  headerJson.copy(header, 16)

  const blob = new Blob([header].concat(Object.values(files)))
  Object.defineProperty(blob, 'name', { configurable: true, value: name })
  return blob
}

async function testHeaderLayouts() {
  for (const layout of ['standard', 'legacy']) {
    const file = createAsar({ 'data/layout.txt': layout }, layout + '.asar', layout)
    const archive = await AsarArchive.open(file)
    assert.equal(await archive.readText('data/layout.txt'), layout)
  }
}

async function testPackageMetadata() {
  const described = createAsar({
    'mods.json': '\uFEFF' + JSON.stringify({
      id: 'DC Example',
      name: 'Example Mod',
      description: 'Metadata is read without unpacking',
      version: '1.2.3',
    }),
    'hook.js': 'window.exampleHook = true',
    'config.schema.json': JSON.stringify({
      title: 'Example config',
      fields: [{ key: 'enabled', type: 'toggle', default: true }],
    }),
  }, 'described.asar')
  const packageWithManifest = await ModPackage.open(described, 1)
  assert.equal(packageWithManifest.id, 'dc-example')
  assert.equal(packageWithManifest.name, 'Example Mod')
  assert.equal(packageWithManifest.hasHook, true)
  assert.equal(packageWithManifest.hasConfig, true)
  assert.equal(packageWithManifest.configName, 'described')
  assert.equal(packageWithManifest.configSchema.fields[0].key, 'enabled')

  const fallback = await ModPackage.open(createAsar({ 'data/value.txt': 'ok' }, 'Fallback Name.asar'), 2)
  assert.equal(fallback.id, 'fallback-name')
  const ordered = await ModPackage.open(createAsar({
    'config.schema.json': JSON.stringify({ fields: [] }),
  }, '005_dc_theatre.asar'), 3)
  assert.equal(ordered.configName, 'dc_theatre')

  const invalidSchema = await ModPackage.open(createAsar({
    'config.schema.json': '{invalid',
    'data/value.txt': 'still loads',
  }, 'invalid-schema.asar'), 4)
  assert.equal(invalidSchema.hasConfig, false)
  assert.equal(fallback.name, 'Fallback Name')
}

async function testLoadOrderAndHooks() {
  const first = await ModPackage.open(createAsar({
    'mods.json': JSON.stringify({ id: 'first', name: 'First' }),
    'hook.js': 'window.hooks.push("first")',
    'data/shared.txt': 'first',
  }, 'first.asar'), 1)
  const second = await ModPackage.open(createAsar({
    'mods.json': JSON.stringify({ id: 'second', name: 'Second' }),
    'hook.js': 'window.hooks.push("second")',
    'data/shared.txt': 'second',
  }, 'second.asar', 'legacy'), 2)

  const plan = await ModPlan.create([first, second])
  assert.deepEqual(plan.layers.map((layer) => layer.id), ['mod:first', 'mod:second'])
  assert.deepEqual(plan.hooks.map((hook) => hook.id), ['first', 'second'])
  assert.equal(plan.filePaths.get('data/shared.txt'), 'data/shared.txt')
  assert.equal(plan.textFiles.get('data/shared.txt'), 'second')

  const base = await AsarArchive.open(createAsar({ 'data/base-only.txt': 'base' }, 'base.asar'))
  const resolver = new AssetResolver(new LayeredVfs([
    { id: 'base-game', kind: 'base', source: base },
  ].concat(plan.layers)))
  const stored = new Map()
  const target = {
    Function,
    TextEncoder,
    Uint8Array,
    atob,
    console,
    document: { documentElement: { setAttribute() {} } },
    localStorage: {
      getItem(key) { return stored.has(key) ? stored.get(key) : null },
      setItem(key, value) { stored.set(key, String(value)) },
    },
    location: { href: 'http://127.0.0.1:4173/' },
    process: {},
  }
  const loader = ModRuntime.install(target, Object.assign({}, plan, { hooks: [] }), resolver)
  await loader.ready
  assert.equal(loader.hasFile('data/shared.txt'), true)
  assert.equal(loader.hasFile('data/base-only.txt'), false)
  assert.equal(loader.getFileIndex().has('data/base-only.txt'), false)
  assert.match(loader.resolveURL('data/shared.txt'), /^blob:/)
  assert.equal(loader.resolveURL('data/base-only.txt'), 'data/base-only.txt')
  assert.equal(typeof target.Buffer, 'function')
  assert.doesNotThrow(() => new ArrayBuffer(1) instanceof target.Buffer)
  assert.equal(target.Buffer.isBuffer(target.Buffer.from('b2s=', 'base64')), true)
  loader.setModConfig('first', { active: true })
  assert.deepEqual(loader.getModConfig('first'), { active: true })
  assert.equal(target.electronAPI.readFileSync('plugins/config/first.json'), '{"active":true}')
  target.electronAPI.writeFileSync('C:\\game\\plugins\\config\\first.json', '{"active":false}')
  assert.deepEqual(loader.getModConfig('first'), { active: false })
  resolver.release()
}

async function testHooksWaitForDocumentBody() {
  let onDocumentReady
  let appended = 0
  const attributes = new Map()
  const target = {
    Function,
    TextEncoder,
    Uint8Array,
    atob,
    console,
    document: {
      body: null,
      readyState: 'loading',
      addEventListener(type, listener) {
        if (type === 'DOMContentLoaded') onDocumentReady = listener
      },
      documentElement: {
        setAttribute(name, value) { attributes.set(name, String(value)) },
      },
    },
    localStorage: { getItem() { return null }, setItem() {} },
    location: { href: 'http://127.0.0.1:4173/' },
    process: {},
  }
  const plan = {
    filePaths: new Map(),
    hooks: [{ id: 'body-hook', name: 'Body Hook', source: 'this.document.body.appendChild({})' }],
    metadata: [{ id: 'body-hook' }],
    packages: [],
    textFiles: new Map(),
  }
  const resolver = { has() { return false }, resolve() { return null } }
  const loader = ModRuntime.install(target, plan, resolver)
  assert.equal(attributes.get('data-dc-mod-hook-state'), 'waiting')

  target.document.body = { appendChild() { appended++ } }
  target.document.readyState = 'interactive'
  onDocumentReady()
  await loader.ready

  assert.equal(appended, 1)
  assert.equal(attributes.get('data-dc-mod-hook-errors'), '0')
  assert.equal(attributes.get('data-dc-mod-hook-state'), 'ready')
}

async function testModBlobSaveRoundTrip() {
  const path = 'data/image/mod choice & 100%.png'
  const base = await AsarArchive.open(createAsar({ [path]: 'base' }, 'base.asar'))
  const mod = await AsarArchive.open(createAsar({ [path]: 'mod' }, 'mod.asar', 'legacy'))
  const vfs = new LayeredVfs([
    { id: 'base-game', kind: 'base', source: base },
    { id: 'mod:override', kind: 'mod', source: mod },
  ])
  const resolver = new AssetResolver(vfs)

  assert.equal(resolver.resolve(path).layerId, 'mod:override')
  const objectUrl = resolver.getObjectUrl(path + '?variant=active#portrait')
  assert.equal(await (await fetch(objectUrl)).text(), 'mod')
  assert.equal(
    resolver.restoreObjectUrls('<img src="' + objectUrl + '">'),
    '<img src="' + ResourcePath.encode(path) + '#portrait">',
  )

  const encodedObjectUrl = encodeURIComponent(objectUrl)
  assert.equal(
    decodeURIComponent(resolver.restoreObjectUrls(encodedObjectUrl)),
    ResourcePath.encode(path) + '#portrait',
  )
  resolver.release()
}

async function main() {
  await testHeaderLayouts()
  await testPackageMetadata()
  await testLoadOrderAndHooks()
  await testHooksWaitForDocumentBody()
  await testModBlobSaveRoundTrip()
  console.log('Mod loader tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
