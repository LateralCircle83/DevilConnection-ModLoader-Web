'use strict'

const assert = require('node:assert/strict')

function createLocalStorage() {
  const values = new Map()
  return {
    get length() { return values.size },
    getItem(key) { return values.has(key) ? values.get(key) : null },
    key(index) { return Array.from(values.keys())[index] || null },
    removeItem(key) { values.delete(key) },
    setItem(key, value) { values.set(key, String(value)) },
    values,
  }
}

function createIndexedDB() {
  const values = new Map()
  function complete(transaction) {
    setImmediate(function () { if (transaction.oncomplete) transaction.oncomplete() })
  }
  const database = {
    objectStoreNames: { contains() { return true } },
    close() {},
    createObjectStore() {},
    transaction() {
      const transaction = {
        error: null,
        objectStore() {
          return {
            clear() { values.clear(); complete(transaction) },
            delete(key) { values.delete(key); complete(transaction) },
            openCursor() {
              const request = {}
              const entries = Array.from(values.entries())
              let index = 0
              function emit() {
                const entry = entries[index++]
                const cursor = entry ? {
                  key: entry[0],
                  value: entry[1],
                  continue() { setImmediate(emit) },
                } : null
                if (request.onsuccess) request.onsuccess({ target: { result: cursor } })
                if (!cursor) complete(transaction)
              }
              setImmediate(emit)
              return request
            },
            put(value, key) { values.set(key, value); complete(transaction) },
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
    values,
  }
}

function createTarget(indexedDB) {
  const listeners = {}
  return {
    CustomEvent: function CustomEvent() {},
    addEventListener(type, handler) { listeners[type] = handler },
    clearTimeout,
    console,
    document: {
      addEventListener(type, handler) { listeners[type] = handler },
      documentElement: { removeAttribute() {}, setAttribute() {} },
      visibilityState: 'visible',
    },
    dispatchEvent() {},
    indexedDB,
    localStorage: createLocalStorage(),
    setTimeout,
  }
}

global.window = {}
require('../js/core/namespace.js')
require('../js/storage/browser-save-store.js')

async function main() {
  const indexedDB = createIndexedDB()
  const target = createTarget(indexedDB)
  const store = window.DCWeb.BrowserSaveStore.create(target)
  await store.ready
  await store.replaceEntries({ alpha: '1', beta: '2' })
  assert.deepEqual(await store.readEntries(), { alpha: '1', beta: '2' })
  await store.replaceEntries({ gamma: '3' })
  assert.deepEqual(await store.readEntries(), { gamma: '3' })
  assert.deepEqual(Object.fromEntries(indexedDB.values), { gamma: '3' })
  await store.updateEntries({ gamma: 'updated', delta: '4' })
  assert.deepEqual(await store.readEntries(), { gamma: 'updated', delta: '4' })
  await store.removeEntries(['gamma'])
  assert.deepEqual(await store.readEntries(), { delta: '4' })

  const fallbackTarget = createTarget(null)
  const fallback = window.DCWeb.BrowserSaveStore.create(fallbackTarget)
  await fallback.ready
  await fallback.replaceEntries({ save: 'value' })
  assert.deepEqual(await fallback.readEntries(), { save: 'value' })
  assert.equal(fallbackTarget.localStorage.getItem('dc-shell:save'), 'value')
  await fallback.updateEntries({ save: 'updated', extra: 'kept' })
  assert.deepEqual(await fallback.readEntries(), { save: 'updated', extra: 'kept' })
  await fallback.removeEntries(['save'])
  assert.deepEqual(await fallback.readEntries(), { extra: 'kept' })
  await fallback.replaceEntries({})
  assert.deepEqual(await fallback.readEntries(), {})
  console.log('Browser save store tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
