'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/resource-path.js')
require('../js/mods/mod-config-store.js')

window.DCWeb.BrowserSaveStore = {
  create() {
    const values = new Map()
    return {
      ready: Promise.resolve(),
      getItem(key) { return values.has(key) ? values.get(key) : null },
      setItem(key, value) { values.set(key, String(value)) },
      removeItem(key) { values.delete(key) },
    }
  },
}
require('../js/kernel/browser-api.js')
require('../js/mods/mod-runtime.js')

function createStorage() {
  const values = new Map()
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
  }
}

function createTarget(storage) {
  return {
    addEventListener() {},
    Function,
    TextEncoder,
    Uint8Array,
    atob,
    console,
    document: {
      addEventListener() {},
      documentElement: { setAttribute() {} },
    },
    localStorage: storage,
    location: { href: 'http://127.0.0.1:4173/' },
    parent: { postMessage() {} },
    setTimeout,
  }
}

function testPathMapping() {
  const store = window.DCWeb.ModConfigStore
  assert.equal(store.bareName('dc_theatre.asar'), 'dc_theatre')
  assert.equal(store.bareName('005_dc_theatre.asar'), 'dc_theatre')
  assert.equal(store.bareName('C:\\mods\\dc_translate_zh_cn.asar'), 'dc_translate_zh_cn')
  assert.equal(store.nameFromPath('plugins/config/dc_theatre.json'), 'dc_theatre')
  assert.equal(store.nameFromPath('plugins/config/dc_theatre.json?reload=1#config'), 'dc_theatre')
  assert.equal(store.nameFromPath('C:\\game\\plugins\\config\\dc_translate_zh_cn.json'), 'dc_translate_zh_cn')
  assert.equal(store.nameFromPath('plugins/config/nested/value.json'), '')
}

function testBrowserApiSharesConfigStorage() {
  const storage = createStorage()
  const target = createTarget(storage)
  const api = window.DCWeb.BrowserApi.install(target, { getBlob() { return null } }, 'token')
  const loader = window.DCWeb.ModRuntime.install(target, {
    filePaths: new Map(), hooks: [], metadata: [], packages: [], textFiles: new Map(),
  }, { has() { return false }, resolve() { return null } })
  const theatrePath = 'plugins/config/dc_theatre.json'
  const translationPath = 'C:\\game\\plugins\\config\\dc_translate_zh_cn.json'

  api.writeFile(theatrePath, '{"model":"deepseek-chat"}')
  assert.equal(storage.values.get('mod_config_dc_theatre'), '{"model":"deepseek-chat"}')
  assert.equal(api.existFile(theatrePath), true)
  assert.equal(api.readFile(theatrePath), '{"model":"deepseek-chat"}')
  assert.equal(target.electronAPI.readFileSync(theatrePath), '{"model":"deepseek-chat"}')

  loader.setModConfig('dc_translate_zh_cn', { showReadme: false })
  assert.equal(api.readFile(translationPath), '{"showReadme":false}')
  target.electronAPI.writeFileSync(translationPath, '{"showReadme":true}')
  assert.deepEqual(loader.getModConfig('dc_translate_zh_cn'), { showReadme: true })
  api.rm(translationPath)
  assert.equal(api.existFile(translationPath), false)
}

testPathMapping()
testBrowserApiSharesConfigStorage()
console.log('Mod config tests passed')
