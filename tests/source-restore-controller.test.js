'use strict'

const assert = require('node:assert/strict')

global.window = { addEventListener() {}, console }
require('../js/kernel/namespace.js')
require('../js/shell/player-controller.js')

async function main() {
  const coreFile = { name: 'app.asar' }
  const modFiles = [{ name: 'first.asar' }, { name: 'second.asar' }]
  const handles = [
    { async getFile() { return coreFile } },
    { async getFile() { return modFiles[0] } },
    { async getFile() { return modFiles[1] } },
  ]
  const record = {
    core: handles[0],
    mods: [
      { enabled: false, handle: handles[1] },
      { enabled: true, handle: handles[2] },
    ],
  }
  let saved
  const sourceStore = {
    supported: true,
    async load() { return record },
    async permissionFor() { return 'granted' },
    async save(core, mods) { saved = { core, mods }; return true },
  }
  const state = { busy: [], hidden: 0, page: '', prepared: 0, rendered: 0, status: '' }
  const view = {
    clearError() {},
    hideSourceRestore() { state.hidden++ },
    renderMods() { state.rendered++ },
    setBusy(value) { state.busy.push(value) },
    setLaunchReady() {},
    setModCount() {},
    showPage(page) { state.page = page },
    setStatus(value) { state.status = value },
    showError(error) { throw error },
  }
  const controller = new window.DCWeb.PlayerController(view, {}, sourceStore)
  controller.loadCore = async function (file, handle, deferPrepare) {
    assert.equal(file, coreFile)
    assert.equal(handle, handles[0])
    assert.equal(deferPrepare, true)
    this.baseGame = { file }
    this.coreHandle = handle
    return true
  }
  controller.addMods = async function (files, modHandles, deferPrepare) {
    assert.deepEqual(files, modFiles)
    assert.deepEqual(modHandles, handles.slice(1))
    assert.equal(deferPrepare, true)
    this.mods = files.map(function (file, index) {
      return {
        enabled: true,
        sourceHandle: modHandles[index],
        toViewModel() { return { enabled: this.enabled } },
      }
    })
    return true
  }
  controller.prepareLaunch = async function () { state.prepared++ }

  await controller.restoreSources(false)
  assert.deepEqual(controller.mods.map(function (mod) { return mod.enabled }), [false, true])
  assert.equal(saved.core, handles[0])
  assert.deepEqual(saved.mods.map(function (mod) { return mod.enabled }), [false, true])
  assert.equal(state.prepared, 1)
  assert.equal(state.page, 'launch')
  assert.equal(state.rendered, 1)
  assert.deepEqual(state.busy, [true, false])
  assert.match(state.status, /已恢复上次选择/)

  var reads = 0
  var promptState = { shown: 0, status: '' }
  var promptView = {
    clearError() {},
    hideSourceRestore() {},
    renderMods() {},
    setBusy() {},
    setLaunchReady() {},
    setModCount() {},
    setStatus(value) { promptState.status = value },
    showSourceRestore(count) { promptState.shown = count },
  }
  var promptHandle = { async getFile() { reads++; return coreFile } }
  var promptController = new window.DCWeb.PlayerController(promptView, {}, {
    supported: true,
    async load() { return { core: promptHandle, mods: [] } },
    async permissionFor() { return 'prompt' },
  })
  await promptController.restoreSources(false)
  assert.equal(reads, 0)
  assert.equal(promptState.shown, 1)
  assert.match(promptState.status, /恢复上次选择/)
  console.log('Source restore controller tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
