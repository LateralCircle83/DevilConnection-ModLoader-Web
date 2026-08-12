'use strict'

const assert = require('node:assert/strict')

global.Blob = global.Blob || require('node:buffer').Blob
global.window = {}
require('../js/core/namespace.js')
require('../js/storage/save-manager.js')
const JSZip = require('../js/vendor/jszip.min.js')
const LZString = require('../js/vendor/lz-string.min.js')

async function main() {
  const manual = encodeURIComponent(JSON.stringify({
    data: [
      { save_date: '', title: 'empty' },
      { save_date: '2026/08/13 09:30', title: 'Chapter 1', stat: { current_scenario: 'Chapter1.ks' } },
    ],
  }))
  const auto = encodeURIComponent(JSON.stringify({
    save_date: '2026/08/13 09:35',
    title: 'Auto save',
    stat: { current_scenario: 'Chapter2.ks' },
  }))
  const entries = {
    DevilConnection_sf: encodeURIComponent(JSON.stringify({ route: 1 })),
    DevilConnection_tyrano_auto_save: auto,
    DevilConnection_tyrano_data: manual,
    NEO: encodeURIComponent(JSON.stringify('blessing')),
    'file:plugins/example.json': '{"enabled":true}',
  }

  const inspected = window.DCWeb.SaveManager.inspectEntries(entries)
  assert.equal(inspected.entryCount, 5)
  assert.equal(inspected.savePointCount, 2)
  assert.equal(inspected.savePoints[0].kind, '自动存档')
  assert.equal(inspected.savePoints[1].kind, '手动存档')
  assert.equal(inspected.savePoints[1].scenario, 'Chapter1.ks')

  assert.equal(inspected.storageEntries.find((entry) => entry.key === 'NEO').kind, '独立进度')
  assert.deepEqual(window.DCWeb.SaveManager.compatibleEntries(entries), {
    DevilConnection_sf: entries.DevilConnection_sf,
    DevilConnection_tyrano_auto_save: entries.DevilConnection_tyrano_auto_save,
    DevilConnection_tyrano_data: entries.DevilConnection_tyrano_data,
    NEO: entries.NEO,
  })
  assert.equal(window.DCWeb.SaveManager.decodeSaveData(escape(JSON.stringify({ legacy: true })), LZString).parsed.legacy, true)
  assert.equal(window.DCWeb.SaveManager.decodeSaveData(LZString.compress(encodeURIComponent(JSON.stringify({ compressed: true }))), LZString).parsed.compressed, true)
  assert.throws(function () {
    window.DCWeb.SaveManager.validateImportEntries({ DevilConnection_sf: 'broken' }, LZString)
  }, /无效或已损坏/)

  let stored = Object.assign({}, entries)
  const fakeStore = {
    async readEntries() { return Object.assign({}, stored) },
    async removeEntries(keys) { keys.forEach((key) => { delete stored[key] }) },
    async updateEntries(next) { stored = Object.assign({}, stored, next) },
  }
  const manager = new window.DCWeb.SaveManager({ JSZip, LZString }, fakeStore)
  const exported = await manager.createExport()
  assert.equal(exported.count, 4)
  assert.equal(exported.fileName, 'DevilConnection_saves.zip')
  const archive = await JSZip.loadAsync(await exported.blob.arrayBuffer(), { checkCRC32: true })
  assert.deepEqual(Object.keys(archive.files).sort(), [
    'DevilConnection_sf.sav',
    'DevilConnection_tyrano_auto_save.sav',
    'DevilConnection_tyrano_data.sav',
    'NEO.sav',
  ])
  assert.equal(await archive.file('DevilConnection_tyrano_data.sav').async('string'), manual)

  const importedZip = new JSZip()
  const importedManual = encodeURIComponent(JSON.stringify({ data: [{ save_date: '2026/08/13 10:00', title: 'Imported' }] }))
  importedZip.file('DevilConnection_tyrano_data.sav', importedManual)
  importedZip.file('NEO.sav', escape(JSON.stringify('legacy-compatible')))
  importedZip.file('mod_config_fake.sav', JSON.stringify({ ignored: true }))
  const preview = await manager.parseImport(await importedZip.generateAsync({ type: 'uint8array' }))
  assert.equal(preview.ignoredCount, 1)
  assert.equal(preview.entries.DevilConnection_tyrano_data, importedManual)
  await manager.importEntries(preview.entries)
  assert.equal(stored.DevilConnection_tyrano_data, importedManual)
  assert.equal(stored.NEO, encodeURIComponent(JSON.stringify('legacy-compatible')))
  assert.equal(stored.DevilConnection_sf, entries.DevilConnection_sf)
  assert.equal(stored['file:plugins/example.json'], entries['file:plugins/example.json'])

  const brokenZip = new JSZip()
  brokenZip.file('DevilConnection_sf.sav', 'broken')
  await assert.rejects(
    manager.parseImport(await brokenZip.generateAsync({ type: 'uint8array' })),
    /无效或已损坏/,
  )

  const duplicateZip = new JSZip()
  duplicateZip.file('NEO.sav', encodeURIComponent(JSON.stringify('first')))
  duplicateZip.file('%4E%45%4F.sav', encodeURIComponent(JSON.stringify('second')))
  await assert.rejects(
    manager.parseImport(await duplicateZip.generateAsync({ type: 'uint8array' })),
    /重复存档键/,
  )

  await manager.clear()
  assert.deepEqual(stored, { 'file:plugins/example.json': entries['file:plugins/example.json'] })
  console.log('Save manager tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
