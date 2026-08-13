'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/kernel/namespace.js')
require('../js/shell/save-manager.js')
require('../js/shell/save-manager-controller.js')

async function main() {
  const state = { busy: [], confirmation: true, downloaded: null, rendered: null, status: null }
  let handlers
  let pageListener
  let refreshCount = 0
  const report = { entryCount: 1, savePointCount: 1, savePoints: [], storageEntries: [], totalBytes: 4 }
  const view = {
    bindSaveManager(value) { handlers = value },
    confirmAction() { return Promise.resolve(state.confirmation) },
    downloadBlob(fileName, blob) { state.downloaded = { fileName, blob } },
    onPageChange(listener) { pageListener = listener },
    renderSaveReport(value) { state.rendered = value },
    setSaveBusy(value) { state.busy.push(value) },
    setSaveStatus(message, type) { state.status = { message, type } },
  }
  const manager = {
    async clear() { return { entryCount: 0, savePointCount: 0, savePoints: [], storageEntries: [], totalBytes: 0 } },
    async createExport() { return { blob: { zip: true }, count: 1, fileName: 'backup.zip' } },
    async importEntries() { return report },
    async inspect() { refreshCount++; return report },
    async parseImport() { return { entries: { DevilConnection_sf: encodeURIComponent('{}') }, ignoredCount: 1 } },
  }
  const player = {
    activeSession: null,
    refreshCount: 0,
    async flushPreparedStorage() {},
    setBusy() {},
    async suspendPreparedSession() {},
    async refreshStorageSession() { this.refreshCount++ },
  }
  const controller = new window.DCWeb.SaveManagerController(view, manager, player)
  controller.bind()
  await pageListener('saves')
  assert.equal(refreshCount, 1)
  assert.equal(state.rendered, report)

  await handlers.exportAll()
  assert.deepEqual(state.downloaded, { fileName: 'backup.zip', blob: { zip: true } })

  await handlers.importFile({ async arrayBuffer() { return new ArrayBuffer(0) } })
  assert.equal(player.refreshCount, 1)
  assert.match(state.status.message, /导入完成/)

  await handlers.clear()
  assert.equal(player.refreshCount, 2)
  assert.match(state.status.message, /已清空/)

  state.confirmation = false
  await handlers.clear()
  assert.equal(player.refreshCount, 2)

  player.activeSession = {}
  state.confirmation = true
  await handlers.clear()
  assert.equal(player.refreshCount, 2)
  console.log('Save manager controller tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
