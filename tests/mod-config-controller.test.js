'use strict'

const assert = require('node:assert/strict')

const values = new Map()
global.window = {
  addEventListener() {},
  localStorage: {
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
  },
}
require('../js/kernel/namespace.js')
require('../js/mods/mod-config-store.js')
require('../js/shell/player-controller.js')

async function main() {
  const state = { closed: false, error: '', opened: null, status: '' }
  const view = {
    bind() {},
    closeModConfig() { state.closed = true },
    openModConfig(mod, saved) { state.opened = { mod, saved } },
    renderMods() {},
    setBusy() {},
    setLaunchReady() {},
    setModCount() {},
    setStatus(message) { state.status = message },
    showModConfigError(message) { state.error = message },
  }
  const controller = new window.DCWeb.PlayerController(view, {})
  const schema = {
    fields: [
      { key: 'enabled', type: 'toggle', default: true },
      { key: 'endpoint', type: 'text', required: true },
      { key: 'timeout', type: 'number', default: 30, min: 5, max: 600 },
    ],
  }
  controller.mods = [{
    configName: 'dc_theatre',
    configSchema: schema,
    id: 'dc-theatre',
    name: 'Theatre',
  }]

  controller.configureMod('dc-theatre')
  assert.equal(state.opened.mod.configName, 'dc_theatre')
  assert.deepEqual(state.opened.saved, {})

  await controller.saveModConfig('dc-theatre', {
    enabled: false,
    endpoint: 'https://example.invalid',
    timeout: '999',
  })
  assert.deepEqual(JSON.parse(values.get('mod_config_dc_theatre')), {
    enabled: false,
    endpoint: 'https://example.invalid',
    timeout: 600,
  })
  assert.equal(state.closed, true)
  assert.equal(state.status, '已保存 Theatre 的配置')

  state.error = ''
  await controller.saveModConfig('dc-theatre', { endpoint: '', timeout: '30' })
  assert.equal(state.error, 'endpoint不能为空')
  console.log('Mod config controller tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
