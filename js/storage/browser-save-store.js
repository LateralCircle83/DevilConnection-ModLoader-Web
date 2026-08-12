;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var DB_NAME = 'devil_connection_web_shell'
  var STORE_NAME = 'saves'
  var VERSION = 1
  var LOCAL_PREFIX = 'dc-shell:'

  function create(target) {
    function reportError(error) {
      var message = String(error && error.message || error || 'Unknown storage error')
      target.console.error('[DC storage]', error)
      var root = target.document && target.document.documentElement
      if (root) root.setAttribute('data-dc-storage-error', message.slice(0, 500))
      try {
        target.dispatchEvent(new target.CustomEvent('dc-storage-error', { detail: { message: message } }))
      } catch (dispatchError) {}
    }

    function safeLocalGet(key) {
      try { return target.localStorage.getItem(LOCAL_PREFIX + key) } catch (error) { return null }
    }

    function safeLocalSet(key, value) {
      try { target.localStorage.setItem(LOCAL_PREFIX + key, value) } catch (error) {}
    }

    function localSet(key, value) {
      target.localStorage.setItem(LOCAL_PREFIX + key, value)
    }

    function safeLocalRemove(key) {
      try { target.localStorage.removeItem(LOCAL_PREFIX + key) } catch (error) {}
    }

    function readLocalEntries() {
      var entries = {}
      try {
        for (var index = 0; index < target.localStorage.length; index++) {
          var storageKey = target.localStorage.key(index)
          if (!storageKey || storageKey.indexOf(LOCAL_PREFIX) !== 0) continue
          var key = storageKey.slice(LOCAL_PREFIX.length)
          var value = target.localStorage.getItem(storageKey)
          if (value !== null) entries[key] = value
        }
      } catch (error) {}
      return entries
    }

    function clearLocalEntries(entries) {
      Object.keys(entries || readLocalEntries()).forEach(safeLocalRemove)
    }

    function cloneEntries(entries) {
      var clone = {}
      Object.keys(entries || {}).forEach(function (key) { clone[key] = String(entries[key]) })
      return clone
    }

    var storage = {
      cache: {},
      pending: {},
      db: null,
      ready: null,
      flushTimer: null,
      useIndexedDB: Boolean(target.indexedDB),

      loadLocalFallback: function () {
        var entries = readLocalEntries()
        var that = this
        Object.keys(entries).forEach(function (key) {
          if (!Object.prototype.hasOwnProperty.call(that.cache, key)) that.cache[key] = entries[key]
        })
      },

      migrateLocalFallback: function () {
        var entries = readLocalEntries()
        var keys = Object.keys(entries)
        if (!keys.length || !this.db) return Promise.resolve()

        var that = this
        var missingKeys = keys.filter(function (key) {
          return !Object.prototype.hasOwnProperty.call(that.cache, key)
        })
        missingKeys.forEach(function (key) { that.cache[key] = entries[key] })
        if (!missingKeys.length) {
          clearLocalEntries(entries)
          return Promise.resolve()
        }

        return new Promise(function (resolve, reject) {
          var transaction = that.db.transaction(STORE_NAME, 'readwrite')
          var store = transaction.objectStore(STORE_NAME)
          missingKeys.forEach(function (key) { store.put(entries[key], key) })
          var settled = false
          function fail() {
            if (settled) return
            settled = true
            reject(transaction.error || new Error('Failed to migrate local save data to IndexedDB'))
          }
          transaction.oncomplete = function () {
            if (settled) return
            settled = true
            clearLocalEntries(entries)
            resolve()
          }
          transaction.onerror = fail
          transaction.onabort = fail
        })
      },

      init: function () {
        if (this.ready) return this.ready
        var that = this
        this.ready = new Promise(function (resolve) {
          if (!that.useIndexedDB) {
            that.loadLocalFallback()
            resolve(false)
            return
          }

          var request
          try {
            request = target.indexedDB.open(DB_NAME, VERSION)
          } catch (error) {
            that.useIndexedDB = false
            that.loadLocalFallback()
            reportError(error)
            resolve(false)
            return
          }

          request.onupgradeneeded = function (event) {
            var db = event.target.result
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
          }
          request.onerror = function () {
            that.useIndexedDB = false
            that.loadLocalFallback()
            reportError(request.error || new Error('IndexedDB could not be opened'))
            resolve(false)
          }
          request.onsuccess = function () {
            that.db = request.result
            that.db.onversionchange = function () { that.db.close() }
            var transaction = that.db.transaction(STORE_NAME, 'readonly')
            var cursorRequest = transaction.objectStore(STORE_NAME).openCursor()
            cursorRequest.onsuccess = function (event) {
              var cursor = event.target.result
              if (cursor) {
                that.cache[cursor.key] = cursor.value
                cursor.continue()
              }
            }
            transaction.oncomplete = function () {
              that.migrateLocalFallback().then(
                function () { resolve(true) },
                function (error) { reportError(error); resolve(true) },
              )
            }
            transaction.onerror = function () {
              that.useIndexedDB = false
              that.loadLocalFallback()
              reportError(transaction.error || new Error('IndexedDB saves could not be read'))
              resolve(false)
            }
          }
        })
        return this.ready
      },

      getItem: function (key) {
        if (Object.prototype.hasOwnProperty.call(this.cache, key)) return this.cache[key]
        var fallback = safeLocalGet(key)
        return fallback === null ? null : fallback
      },

      setItem: function (key, value) {
        this.cache[key] = String(value)
        if (this.useIndexedDB) {
          this.pending[key] = true
          this.scheduleFlush()
        } else safeLocalSet(key, String(value))
      },

      removeItem: function (key) {
        delete this.cache[key]
        if (this.useIndexedDB) {
          this.pending[key] = true
          this.scheduleFlush()
        } else safeLocalRemove(key)
      },

      clear: function () {
        var that = this
        return this.replaceEntries({}).catch(function (error) {
          reportError(error)
        })
      },

      readEntries: function () {
        var that = this
        return this.flush().then(function () { return that.ready }).then(function () {
          if (!that.useIndexedDB || !that.db) {
            that.cache = readLocalEntries()
            return cloneEntries(that.cache)
          }
          return new Promise(function (resolve, reject) {
            var entries = {}
            var transaction = that.db.transaction(STORE_NAME, 'readonly')
            var request = transaction.objectStore(STORE_NAME).openCursor()
            request.onsuccess = function (event) {
              var cursor = event.target.result
              if (!cursor) return
              entries[String(cursor.key)] = String(cursor.value)
              cursor.continue()
            }
            transaction.oncomplete = function () {
              var fallback = readLocalEntries()
              Object.keys(fallback).forEach(function (key) {
                if (!Object.prototype.hasOwnProperty.call(entries, key)) entries[key] = fallback[key]
              })
              that.cache = cloneEntries(entries)
              resolve(cloneEntries(entries))
            }
            transaction.onerror = function () {
              reject(transaction.error || new Error('IndexedDB saves could not be read'))
            }
            transaction.onabort = transaction.onerror
          })
        }).catch(function (error) {
          reportError(error)
          throw error
        })
      },

      replaceEntries: function (entries) {
        var nextEntries = cloneEntries(entries)
        var previousCache = cloneEntries(this.cache)
        var previousLocal = readLocalEntries()
        var that = this
        if (this.flushTimer) {
          target.clearTimeout(this.flushTimer)
          this.flushTimer = null
        }
        this.pending = {}

        return this.ready.then(function () {
          if (!that.useIndexedDB || !that.db) {
            try {
              clearLocalEntries()
              Object.keys(nextEntries).forEach(function (key) { localSet(key, nextEntries[key]) })
              that.cache = cloneEntries(nextEntries)
              return
            } catch (error) {
              clearLocalEntries()
              Object.keys(previousLocal).forEach(function (key) {
                try { localSet(key, previousLocal[key]) } catch (restoreError) {}
              })
              that.cache = previousCache
              throw error
            }
          }

          return new Promise(function (resolve, reject) {
            var transaction = that.db.transaction(STORE_NAME, 'readwrite')
            var store = transaction.objectStore(STORE_NAME)
            store.clear()
            Object.keys(nextEntries).forEach(function (key) { store.put(nextEntries[key], key) })
            var settled = false
            function fail() {
              if (settled) return
              settled = true
              that.cache = previousCache
              reject(transaction.error || new Error('IndexedDB saves could not be replaced'))
            }
            transaction.oncomplete = function () {
              if (settled) return
              settled = true
              clearLocalEntries()
              that.cache = cloneEntries(nextEntries)
              resolve()
            }
            transaction.onerror = fail
            transaction.onabort = fail
          })
        }).catch(function (error) {
          reportError(error)
          throw error
        })
      },

      updateEntries: function (entries) {
        var updates = cloneEntries(entries)
        var keys = Object.keys(updates)
        var previousCache = cloneEntries(this.cache)
        var previousLocal = readLocalEntries()
        var that = this

        return this.flush().then(function () { return that.ready }).then(function () {
          if (!that.useIndexedDB || !that.db) {
            try {
              keys.forEach(function (key) { localSet(key, updates[key]) })
              keys.forEach(function (key) { that.cache[key] = updates[key] })
              return
            } catch (error) {
              keys.forEach(function (key) {
                if (Object.prototype.hasOwnProperty.call(previousLocal, key)) {
                  try { localSet(key, previousLocal[key]) } catch (restoreError) {}
                } else safeLocalRemove(key)
              })
              that.cache = previousCache
              throw error
            }
          }

          return new Promise(function (resolve, reject) {
            var transaction = that.db.transaction(STORE_NAME, 'readwrite')
            var store = transaction.objectStore(STORE_NAME)
            keys.forEach(function (key) { store.put(updates[key], key) })
            var settled = false
            function fail() {
              if (settled) return
              settled = true
              that.cache = previousCache
              reject(transaction.error || new Error('IndexedDB saves could not be updated'))
            }
            transaction.oncomplete = function () {
              if (settled) return
              settled = true
              keys.forEach(function (key) {
                safeLocalRemove(key)
                that.cache[key] = updates[key]
              })
              resolve()
            }
            transaction.onerror = fail
            transaction.onabort = fail
          })
        }).catch(function (error) {
          reportError(error)
          throw error
        })
      },

      removeEntries: function (keys) {
        var normalizedKeys = Array.from(new Set((keys || []).map(String)))
        var previousCache = cloneEntries(this.cache)
        var previousLocal = readLocalEntries()
        var that = this

        return this.flush().then(function () { return that.ready }).then(function () {
          if (!that.useIndexedDB || !that.db) {
            try {
              normalizedKeys.forEach(function (key) {
                target.localStorage.removeItem(LOCAL_PREFIX + key)
                delete that.cache[key]
              })
              return
            } catch (error) {
              normalizedKeys.forEach(function (key) {
                if (Object.prototype.hasOwnProperty.call(previousLocal, key)) {
                  try { localSet(key, previousLocal[key]) } catch (restoreError) {}
                }
              })
              that.cache = previousCache
              throw error
            }
          }

          return new Promise(function (resolve, reject) {
            var transaction = that.db.transaction(STORE_NAME, 'readwrite')
            var store = transaction.objectStore(STORE_NAME)
            normalizedKeys.forEach(function (key) { store.delete(key) })
            var settled = false
            function fail() {
              if (settled) return
              settled = true
              that.cache = previousCache
              reject(transaction.error || new Error('IndexedDB saves could not be removed'))
            }
            transaction.oncomplete = function () {
              if (settled) return
              settled = true
              normalizedKeys.forEach(function (key) {
                safeLocalRemove(key)
                delete that.cache[key]
              })
              resolve()
            }
            transaction.onerror = fail
            transaction.onabort = fail
          })
        }).catch(function (error) {
          reportError(error)
          throw error
        })
      },

      scheduleFlush: function () {
        if (this.flushTimer) return
        var that = this
        this.flushTimer = target.setTimeout(function () {
          that.flushTimer = null
          that.flush().catch(function () {})
        }, 60)
      },

      flush: function () {
        var that = this
        var keys = Object.keys(this.pending)
        this.pending = {}
        if (!keys.length) return Promise.resolve()
        return this.ready.then(function () {
          if (!that.useIndexedDB || !that.db) {
            keys.forEach(function (key) {
              if (Object.prototype.hasOwnProperty.call(that.cache, key)) safeLocalSet(key, that.cache[key])
              else safeLocalRemove(key)
            })
            return
          }
          return new Promise(function (resolve, reject) {
            var transaction = that.db.transaction(STORE_NAME, 'readwrite')
            var store = transaction.objectStore(STORE_NAME)
            keys.forEach(function (key) {
              if (Object.prototype.hasOwnProperty.call(that.cache, key)) store.put(that.cache[key], key)
              else store.delete(key)
            })
            var settled = false
            function fail() {
              if (settled) return
              settled = true
              reject(transaction.error || new Error('IndexedDB save transaction failed'))
            }
            transaction.oncomplete = function () {
              if (settled) return
              settled = true
              var root = target.document && target.document.documentElement
              if (root) root.removeAttribute('data-dc-storage-error')
              resolve()
            }
            transaction.onerror = fail
            transaction.onabort = fail
          })
        }).catch(function (error) {
          keys.forEach(function (key) { that.pending[key] = true })
          reportError(error)
          throw error
        })
      },
    }

    storage.init()
    target.addEventListener('pagehide', function () { storage.flush().catch(function () {}) })
    target.document.addEventListener('visibilitychange', function () {
      if (target.document.visibilityState === 'hidden') storage.flush().catch(function () {})
    })
    return storage
  }

  DCWeb.BrowserSaveStore = {
    create: create,
    databaseName: DB_NAME,
    storeName: STORE_NAME,
  }
})(window)
