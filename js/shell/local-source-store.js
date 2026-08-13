;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var DB_NAME = 'devil_connection_web_sources'
  var STORE_NAME = 'selection'
  var RECORD_KEY = 'current'
  var VERSION = 1
  var ASAR_PICKER_OPTIONS = {
    excludeAcceptAllOption: false,
    types: [{
      accept: { 'application/octet-stream': ['.asar'] },
      description: 'ASAR archive',
    }],
  }

  function create(target) {
    var databasePromise = null

    function openDatabase() {
      if (databasePromise) return databasePromise
      databasePromise = new Promise(function (resolve, reject) {
        if (!target.indexedDB) {
          reject(new Error('IndexedDB is unavailable'))
          return
        }
        var request
        try { request = target.indexedDB.open(DB_NAME, VERSION) } catch (error) {
          reject(error)
          return
        }
        request.onupgradeneeded = function (event) {
          var database = event.target.result
          if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
        }
        request.onsuccess = function () {
          var database = request.result
          database.onversionchange = function () { database.close() }
          resolve(database)
        }
        request.onerror = function () { reject(request.error || new Error('Local source storage could not be opened')) }
        request.onblocked = function () { reject(new Error('Local source storage upgrade was blocked')) }
      })
      return databasePromise
    }

    function readRecord() {
      if (!target.indexedDB) return Promise.resolve(null)
      return openDatabase().then(function (database) {
        return new Promise(function (resolve, reject) {
          var transaction = database.transaction(STORE_NAME, 'readonly')
          var request = transaction.objectStore(STORE_NAME).get(RECORD_KEY)
          request.onsuccess = function () { resolve(request.result || null) }
          request.onerror = function () { reject(request.error || new Error('Local source selection could not be read')) }
        })
      })
    }

    function writeRecord(record) {
      if (!target.indexedDB) return Promise.resolve(false)
      return openDatabase().then(function (database) {
        return new Promise(function (resolve, reject) {
          var transaction = database.transaction(STORE_NAME, 'readwrite')
          transaction.objectStore(STORE_NAME).put(record, RECORD_KEY)
          transaction.oncomplete = function () { resolve(true) }
          transaction.onerror = function () { reject(transaction.error || new Error('Local source selection could not be saved')) }
          transaction.onabort = transaction.onerror
        })
      })
    }

    function clearRecord() {
      if (!target.indexedDB) return Promise.resolve(false)
      return openDatabase().then(function (database) {
        return new Promise(function (resolve, reject) {
          var transaction = database.transaction(STORE_NAME, 'readwrite')
          transaction.objectStore(STORE_NAME).delete(RECORD_KEY)
          transaction.oncomplete = function () { resolve(true) }
          transaction.onerror = function () { reject(transaction.error || new Error('Local source selection could not be cleared')) }
          transaction.onabort = transaction.onerror
        })
      })
    }

    async function permissionFor(handle, requestAccess) {
      if (!handle || typeof handle.getFile !== 'function') return 'denied'
      if (typeof handle.queryPermission !== 'function') return 'granted'
      var state
      try { state = await handle.queryPermission({ mode: 'read' }) } catch (error) { return 'denied' }
      if (state === 'prompt' && requestAccess && typeof handle.requestPermission === 'function') {
        try { state = await handle.requestPermission({ mode: 'read' }) } catch (error) { return 'denied' }
      }
      return state
    }

    return {
      supported: Boolean(target.indexedDB && typeof target.showOpenFilePicker === 'function'),

      clear: clearRecord,
      load: readRecord,
      permissionFor: permissionFor,

      pickCore: async function () {
        var options = Object.assign({ id: 'dc-core-asar', multiple: false }, ASAR_PICKER_OPTIONS)
        var handles = await target.showOpenFilePicker(options)
        return handles && handles[0] ? handles[0] : null
      },

      pickMods: function () {
        return target.showOpenFilePicker(Object.assign({ id: 'dc-mod-asars', multiple: true }, ASAR_PICKER_OPTIONS))
      },

      save: function (coreHandle, mods) {
        if (!coreHandle) return clearRecord()
        return writeRecord({
          core: coreHandle,
          mods: (mods || []).filter(function (mod) { return Boolean(mod && mod.handle) }).map(function (mod) {
            return { enabled: mod.enabled !== false, handle: mod.handle }
          }),
          version: 1,
        })
      },
    }
  }

  DCWeb.LocalSourceStore = {
    create: create,
    databaseName: DB_NAME,
    storeName: STORE_NAME,
  }
})(window)
