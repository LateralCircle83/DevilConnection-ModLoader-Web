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

function createIndexedDB(initialEntries) {
  const values = new Map(initialEntries || [])
  let failNextWrite = false
  let holdNextWrite = false
  let heldWrite = null
  let resolveHeldWrite = null
  const database = {
    objectStoreNames: { contains() { return true } },
    close() {},
    createObjectStore() {},
    transaction(_storeName, mode) {
      const operations = []
      let completionScheduled = false
      const transaction = {
        error: null,
        objectStore() {
          return {
            clear() { operations.push({ type: 'clear' }); scheduleCompletion() },
            delete(key) { operations.push({ key, type: 'delete' }); scheduleCompletion() },
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
                if (!cursor && transaction.oncomplete) transaction.oncomplete()
              }
              setImmediate(emit)
              return request
            },
            put(value, key) { operations.push({ key, type: 'put', value }); scheduleCompletion() },
          }
        },
      }

      function scheduleCompletion() {
        if (mode !== 'readwrite' || completionScheduled) return
        completionScheduled = true
        setImmediate(function () {
          if (holdNextWrite) {
            holdNextWrite = false
            heldWrite = finish
            if (resolveHeldWrite) resolveHeldWrite()
            resolveHeldWrite = null
            return
          }
          finish()
        })

        function finish() {
          if (failNextWrite) {
            failNextWrite = false
            transaction.error = new Error('Injected IndexedDB transaction failure')
            if (transaction.onerror) transaction.onerror()
            return
          }
          operations.forEach(function (operation) {
            if (operation.type === 'clear') values.clear()
            if (operation.type === 'delete') values.delete(operation.key)
            if (operation.type === 'put') values.set(operation.key, operation.value)
          })
          if (transaction.oncomplete) transaction.oncomplete()
        }
      }

      if (mode === 'readwrite') scheduleCompletion()
      return transaction
    },
  }
  return {
    failNextWrite() { failNextWrite = true },
    holdNextWrite() {
      holdNextWrite = true
      return new Promise((resolve) => { resolveHeldWrite = resolve })
    },
    open() {
      const request = { result: database }
      setImmediate(function () { if (request.onsuccess) request.onsuccess() })
      return request
    },
    releaseWrite() {
      if (!heldWrite) throw new Error('No held IndexedDB transaction')
      const finish = heldWrite
      heldWrite = null
      finish()
    },
    values,
  }
}

function createTarget(indexedDB, localStorage) {
  const listeners = {}
  const rootAttributes = new Map()
  return {
    CustomEvent: function CustomEvent() {},
    addEventListener(type, handler) { listeners[type] = handler },
    clearTimeout,
    console: { error() {} },
    document: {
      addEventListener(type, handler) { listeners[type] = handler },
      documentElement: {
        getAttribute(name) { return rootAttributes.get(name) || null },
        removeAttribute(name) { rootAttributes.delete(name) },
        setAttribute(name, value) { rootAttributes.set(name, String(value)) },
      },
      visibilityState: 'visible',
    },
    dispatchEvent() {},
    indexedDB,
    localStorage: localStorage || createLocalStorage(),
    setTimeout,
  }
}

global.window = {}
require('../js/kernel/namespace.js')
require('../js/kernel/browser-save-store.js')

const BrowserSaveStore = window.DCWeb.BrowserSaveStore

function assertJournalCleared(localStorage) {
  const journal = JSON.parse(localStorage.getItem(BrowserSaveStore.journalKey))
  assert.equal(journal.reset, false)
  assert.deepEqual(journal.operations, [])
}

async function testWriteAheadRetry() {
  const indexedDB = createIndexedDB([['save', 'old']])
  const target = createTarget(indexedDB)
  const store = BrowserSaveStore.create(target)
  await store.ready

  store.setItem('save', 'new')
  const pending = JSON.parse(target.localStorage.getItem(BrowserSaveStore.journalKey))
  assert.deepEqual(pending.operations, [{ key: 'save', type: 'set', value: 'new' }])

  indexedDB.failNextWrite()
  await assert.rejects(store.flush(), /Injected IndexedDB transaction failure/)
  assert.equal(indexedDB.values.get('save'), 'old')
  assert.equal(store.getItem('save'), 'new')
  assert.notEqual(target.localStorage.getItem(BrowserSaveStore.journalKey), null)
  assert.match(target.document.documentElement.getAttribute('data-dc-storage-error'), /Injected IndexedDB transaction failure/)

  await store.flush()
  assert.equal(indexedDB.values.get('save'), 'new')
  assertJournalCleared(target.localStorage)
  assert.equal(target.document.documentElement.getAttribute('data-dc-storage-pending'), '0')
  assert.equal(target.document.documentElement.getAttribute('data-dc-storage-error'), null)
}

async function testFallbackOverridesStaleIndexedDb() {
  const localStorage = createLocalStorage()
  localStorage.setItem('dc-shell:save', 'newer-fallback')
  const indexedDB = createIndexedDB([['save', 'stale-indexeddb']])
  const store = BrowserSaveStore.create(createTarget(indexedDB, localStorage))
  await store.ready

  assert.equal(store.getItem('save'), 'newer-fallback')
  assert.equal(indexedDB.values.get('save'), 'newer-fallback')
  assert.equal(localStorage.getItem('dc-shell:save'), null)
}

async function testJournalRecoversAfterReload() {
  const localStorage = createLocalStorage()
  const indexedDB = createIndexedDB([['save', 'old']])
  const first = BrowserSaveStore.create(createTarget(indexedDB, localStorage))
  await first.ready
  first.setItem('save', 'new-before-reload')
  clearTimeout(first.flushTimer)
  first.flushTimer = null

  const recovered = BrowserSaveStore.create(createTarget(indexedDB, localStorage))
  await recovered.ready
  assert.equal(recovered.getItem('save'), 'new-before-reload')
  assert.equal(indexedDB.values.get('save'), 'new-before-reload')
  assertJournalCleared(localStorage)
}

async function testNewWriteSurvivesOlderTransactionCompletion() {
  const indexedDB = createIndexedDB()
  const store = BrowserSaveStore.create(createTarget(indexedDB))
  await store.ready
  store.setItem('save', 'first')
  const writeHeld = indexedDB.holdNextWrite()
  const firstFlush = store.flush()
  await writeHeld

  store.setItem('save', 'second')
  indexedDB.releaseWrite()
  await firstFlush
  assert.notEqual(store.flushTimer, null)
  await store.flush()

  assert.equal(indexedDB.values.get('save'), 'second')
  assert.equal(store.getItem('save'), 'second')
}

async function testHostStoreSeesIframeJournal() {
  const localStorage = createLocalStorage()
  const indexedDB = createIndexedDB([['save', 'old']])
  const hostStore = BrowserSaveStore.create(createTarget(indexedDB, localStorage))
  const frameStore = BrowserSaveStore.create(createTarget(indexedDB, localStorage))
  await Promise.all([hostStore.ready, frameStore.ready])

  frameStore.setItem('save', 'from-frame')
  clearTimeout(frameStore.flushTimer)
  frameStore.flushTimer = null
  assert.equal(hostStore.getItem('save'), 'old')

  assert.deepEqual(await hostStore.readEntries(), { save: 'from-frame' })
  assert.equal(indexedDB.values.get('save'), 'from-frame')
  assertJournalCleared(localStorage)
}

async function testCommittedNewerJournalSupersedesStaleStore() {
  const localStorage = createLocalStorage()
  const indexedDB = createIndexedDB()
  const staleStore = BrowserSaveStore.create(createTarget(indexedDB, localStorage))
  await staleStore.ready
  staleStore.setItem('save', 'stale')
  indexedDB.failNextWrite()
  await assert.rejects(staleStore.flush(), /Injected IndexedDB transaction failure/)

  const currentStore = BrowserSaveStore.create(createTarget(indexedDB, localStorage))
  await currentStore.ready
  currentStore.setItem('save', 'current')
  await currentStore.flush()
  assert.equal(indexedDB.values.get('save'), 'current')

  await staleStore.flush()
  assert.equal(indexedDB.values.get('save'), 'current')
  assertJournalCleared(localStorage)
}

async function testFallbackDeleteDoesNotResurrect() {
  const localStorage = createLocalStorage()
  const fallback = BrowserSaveStore.create(createTarget(null, localStorage))
  await fallback.ready
  fallback.removeItem('save')
  assert.notEqual(localStorage.getItem(BrowserSaveStore.journalKey), null)

  const indexedDB = createIndexedDB([['save', 'stale-indexeddb']])
  const recovered = BrowserSaveStore.create(createTarget(indexedDB, localStorage))
  await recovered.ready

  assert.equal(recovered.getItem('save'), null)
  assert.equal(indexedDB.values.has('save'), false)
  assertJournalCleared(localStorage)
}

async function testFallbackReplacementDoesNotRestoreRemovedKeys() {
  const localStorage = createLocalStorage()
  const fallback = BrowserSaveStore.create(createTarget(null, localStorage))
  await fallback.ready
  await fallback.replaceEntries({ keep: 'new' })

  const indexedDB = createIndexedDB([['keep', 'old'], ['remove', 'stale']])
  const recovered = BrowserSaveStore.create(createTarget(indexedDB, localStorage))
  await recovered.ready

  assert.deepEqual(await recovered.readEntries(), { keep: 'new' })
  assert.deepEqual(Object.fromEntries(indexedDB.values), { keep: 'new' })
  assertJournalCleared(localStorage)
}

async function testFailedReplacementDoesNotReplay() {
  const localStorage = createLocalStorage()
  const indexedDB = createIndexedDB([['save', 'original']])
  const target = createTarget(indexedDB, localStorage)
  const store = BrowserSaveStore.create(target)
  await store.ready

  indexedDB.failNextWrite()
  await assert.rejects(store.replaceEntries({ replacement: 'rejected' }), /Injected IndexedDB transaction failure/)
  assert.deepEqual(Object.fromEntries(indexedDB.values), { save: 'original' })
  assert.equal(store.getItem('save'), 'original')
  assert.equal(store.getItem('replacement'), null)
  assertJournalCleared(localStorage)
}

async function main() {
  const indexedDB = createIndexedDB()
  const target = createTarget(indexedDB)
  const store = BrowserSaveStore.create(target)
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
  const fallback = BrowserSaveStore.create(fallbackTarget)
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

  await testWriteAheadRetry()
  await testFallbackOverridesStaleIndexedDb()
  await testJournalRecoversAfterReload()
  await testNewWriteSurvivesOlderTransactionCompletion()
  await testHostStoreSeesIframeJournal()
  await testCommittedNewerJournalSupersedesStaleStore()
  await testFallbackDeleteDoesNotResurrect()
  await testFallbackReplacementDoesNotRestoreRemovedKeys()
  await testFailedReplacementDoesNotReplay()
  console.log('Browser save store tests passed')
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
