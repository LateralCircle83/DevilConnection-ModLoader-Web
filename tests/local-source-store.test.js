'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/core/namespace.js')
require('../js/storage/local-source-store.js')

function createIndexedDB() {
  const values = new Map()
  const database = {
    objectStoreNames: { contains() { return true } },
    close() {},
    createObjectStore() {},
    transaction() {
      const transaction = {
        error: null,
        objectStore() {
          return {
            delete(key) {
              values.delete(key)
              setImmediate(function () { if (transaction.oncomplete) transaction.oncomplete() })
            },
            get(key) {
              const request = { result: values.get(key) }
              setImmediate(function () { if (request.onsuccess) request.onsuccess() })
              return request
            },
            put(value, key) {
              values.set(key, value)
              setImmediate(function () { if (transaction.oncomplete) transaction.oncomplete() })
            },
          }
        },
      }
      return transaction
    },
  }
  return {
    open() {
      const request = { result: database }
      setImmediate(function () { if (request.onsuccess) request.onsuccess() })
      return request
    },
  }
}

async function main() {
  const coreHandle = { getFile() {}, queryPermission: async () => 'granted' }
  let requested = false
  const modHandle = {
    getFile() {},
    queryPermission: async () => 'prompt',
    requestPermission: async () => { requested = true; return 'granted' },
  }
  const pickerCalls = []
  const target = {
    indexedDB: createIndexedDB(),
    async showOpenFilePicker(options) {
      pickerCalls.push(options)
      return options.multiple ? [modHandle] : [coreHandle]
    },
  }
  const store = window.DCWeb.LocalSourceStore.create(target)

  assert.equal(store.supported, true)
  assert.equal(await store.pickCore(), coreHandle)
  assert.deepEqual(await store.pickMods(), [modHandle])
  assert.equal(pickerCalls[0].multiple, false)
  assert.equal(pickerCalls[0].id, 'dc-core-asar')
  assert.equal(pickerCalls[1].multiple, true)
  assert.equal(pickerCalls[1].id, 'dc-mod-asars')

  await store.save(coreHandle, [{ enabled: false, handle: modHandle }])
  const record = await store.load()
  assert.equal(record.core, coreHandle)
  assert.equal(record.mods[0].handle, modHandle)
  assert.equal(record.mods[0].enabled, false)

  assert.equal(await store.permissionFor(modHandle, false), 'prompt')
  assert.equal(requested, false)
  assert.equal(await store.permissionFor(modHandle, true), 'granted')
  assert.equal(requested, true)

  await store.clear()
  assert.equal(await store.load(), null)
  console.log('Local source store tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
