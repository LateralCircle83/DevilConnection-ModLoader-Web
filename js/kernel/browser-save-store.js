;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var DB_NAME = 'devil_connection_web_shell'
  var STORE_NAME = 'saves'
  var VERSION = 1
  var LOCAL_PREFIX = 'dc-shell:'
  var JOURNAL_KEY = LOCAL_PREFIX + '__dc_pending_v1__'
  var JOURNAL_VERSION = 1

  function create(target) {
    var ownerDocument = target.document

    function reportError(error) {
      var message = String(error && error.message || error || 'Unknown storage error')
      target.console.error('[DC storage]', error)
      var root = ownerDocument && ownerDocument.documentElement
      if (root) root.setAttribute('data-dc-storage-error', message.slice(0, 500))
      try {
        target.dispatchEvent(new target.CustomEvent('dc-storage-error', { detail: { message: message } }))
      } catch (dispatchError) {}
    }

    function emptyJournal(revision) {
      return {
        operations: [],
        reset: false,
        revision: Number.isSafeInteger(revision) ? revision : 0,
        version: JOURNAL_VERSION,
      }
    }

    function cloneJournal(value) {
      var clone = emptyJournal(value && value.revision)
      clone.reset = Boolean(value && value.reset)
      clone.operations = (value && value.operations || []).map(function (operation) {
        return operation.type === 'set'
          ? { key: operation.key, type: 'set', value: operation.value }
          : { key: operation.key, type: 'remove' }
      })
      return clone
    }

    function readJournal() {
      var raw
      try { raw = target.localStorage.getItem(JOURNAL_KEY) } catch (error) { return emptyJournal() }
      if (!raw) return emptyJournal()
      try {
        var parsed = JSON.parse(raw)
        if (!parsed || parsed.version !== JOURNAL_VERSION || !Array.isArray(parsed.operations)) {
          throw new Error('Unsupported save journal format')
        }
        var journal = emptyJournal(Number.isSafeInteger(parsed.revision) && parsed.revision >= 0 ? parsed.revision : 0)
        journal.reset = Boolean(parsed.reset)
        parsed.operations.forEach(function (operation) {
          if (!operation || typeof operation.key !== 'string' || (operation.type !== 'set' && operation.type !== 'remove')) return
          var existing = journal.operations.findIndex(function (item) { return item.key === operation.key })
          var normalized = operation.type === 'set'
            ? { key: operation.key, type: 'set', value: String(operation.value) }
            : { key: operation.key, type: 'remove' }
          if (existing === -1) journal.operations.push(normalized)
          else journal.operations[existing] = normalized
        })
        return journal
      } catch (error) {
        reportError(new Error('无法读取本地存档恢复日志：' + error.message))
        return emptyJournal()
      }
    }

    var journal = readJournal()

    function journalHasWork(value) {
      return Boolean(value.reset || value.operations.length)
    }

    function refreshJournal() {
      var persisted = readJournal()
      if (persisted.revision >= journal.revision) journal = persisted
      return journal
    }

    function publishJournalState() {
      var root = ownerDocument && ownerDocument.documentElement
      if (!root) return
      root.setAttribute('data-dc-storage-pending', String(journal.operations.length + (journal.reset ? 1 : 0)))
    }

    function persistJournal() {
      publishJournalState()
      try {
        target.localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal))
        return true
      } catch (error) {
        reportError(new Error('无法写入本地存档恢复日志：' + String(error && error.message || error)))
        return false
      }
    }

    function replaceJournal(value) {
      journal = cloneJournal(value)
      persistJournal()
    }

    function recordOperations(entries, removedKeys, reset) {
      refreshJournal()
      var next = cloneJournal(journal)
      next.revision++
      if (reset) {
        next.reset = true
        next.operations = []
      }
      ;(removedKeys || []).forEach(function (key) {
        var normalizedKey = String(key)
        var existing = next.operations.findIndex(function (item) { return item.key === normalizedKey })
        var operation = { key: normalizedKey, type: 'remove' }
        if (existing === -1) next.operations.push(operation)
        else next.operations[existing] = operation
      })
      Object.keys(entries || {}).forEach(function (key) {
        var existing = next.operations.findIndex(function (item) { return item.key === key })
        var operation = { key: key, type: 'set', value: String(entries[key]) }
        if (existing === -1) next.operations.push(operation)
        else next.operations[existing] = operation
      })
      replaceJournal(next)
      return cloneJournal(next)
    }

    function mergeRecovery(entries, fallback, value) {
      var result = value.reset ? {} : cloneEntries(entries)
      Object.keys(fallback || {}).forEach(function (key) { result[key] = String(fallback[key]) })
      value.operations.forEach(function (operation) {
        if (operation.type === 'set') result[operation.key] = operation.value
        else delete result[operation.key]
      })
      return result
    }

    function clearCommittedJournal(snapshot) {
      refreshJournal()
      if (journal.revision !== snapshot.revision) return false
      journal = emptyJournal(snapshot.revision)
      persistJournal()
      return true
    }

    function discardFallbackSets(snapshot) {
      refreshJournal()
      if (journal.revision !== snapshot.revision) return
      if (!journal.operations.some(function (operation) { return operation.type === 'set' })) return
      var next = cloneJournal(journal)
      next.operations = next.operations.filter(function (operation) { return operation.type === 'remove' })
      next.revision++
      replaceJournal(next)
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
          if (!storageKey || storageKey === JOURNAL_KEY || storageKey.indexOf(LOCAL_PREFIX) !== 0) continue
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
      db: null,
      closePromise: null,
      flushChain: Promise.resolve(),
      ready: null,
      flushTimer: null,
      useIndexedDB: Boolean(target.indexedDB),

      loadLocalFallback: function () {
        var entries = readLocalEntries()
        this.cache = mergeRecovery(this.cache, entries, journal)
      },

      migrateLocalFallback: function () {
        refreshJournal()
        var entries = readLocalEntries()
        var snapshot = cloneJournal(journal)
        var keys = Object.keys(entries)
        if ((!keys.length && !journalHasWork(snapshot)) || !this.db) return Promise.resolve()

        var that = this
        this.cache = mergeRecovery(this.cache, entries, snapshot)

        return new Promise(function (resolve, reject) {
          var transaction = that.db.transaction(STORE_NAME, 'readwrite')
          var store = transaction.objectStore(STORE_NAME)
          if (snapshot.reset) store.clear()
          keys.forEach(function (key) { store.put(entries[key], key) })
          snapshot.operations.forEach(function (operation) {
            if (operation.type === 'set') store.put(operation.value, operation.key)
            else store.delete(operation.key)
          })
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
            clearCommittedJournal(snapshot)
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
            var database = request.result
            that.db = database
            database.onversionchange = function () {
              database.close()
              if (that.db === database) that.db = null
            }
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
        for (var index = journal.operations.length - 1; index >= 0; index--) {
          if (journal.operations[index].key !== String(key)) continue
          return journal.operations[index].type === 'set' ? journal.operations[index].value : null
        }
        if (journal.reset) return null
        var fallback = safeLocalGet(key)
        return fallback === null ? null : fallback
      },

      setItem: function (key, value) {
        var normalizedKey = String(key)
        var normalizedValue = String(value)
        this.cache[normalizedKey] = normalizedValue
        if (this.useIndexedDB) {
          var entries = {}
          entries[normalizedKey] = normalizedValue
          recordOperations(entries, [], false)
          this.scheduleFlush()
        } else {
          try { localSet(normalizedKey, normalizedValue) } catch (error) { reportError(error) }
          refreshJournal()
          var existing = journal.operations.findIndex(function (operation) { return operation.key === normalizedKey })
          if (existing !== -1) {
            var next = cloneJournal(journal)
            next.operations.splice(existing, 1)
            next.revision++
            replaceJournal(next)
          }
        }
      },

      removeItem: function (key) {
        var normalizedKey = String(key)
        delete this.cache[normalizedKey]
        if (this.useIndexedDB) {
          recordOperations({}, [normalizedKey], false)
          this.scheduleFlush()
        } else {
          try { target.localStorage.removeItem(LOCAL_PREFIX + normalizedKey) } catch (error) { reportError(error) }
          recordOperations({}, [normalizedKey], false)
        }
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
            that.cache = mergeRecovery({}, readLocalEntries(), journal)
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
              that.cache = mergeRecovery(entries, fallback, journal)
              resolve(cloneEntries(that.cache))
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
        var that = this
        if (this.flushTimer) {
          target.clearTimeout(this.flushTimer)
          this.flushTimer = null
        }

        return this.flush().then(function () { return that.ready }).then(function () {
          var previousCache = cloneEntries(that.cache)
          var previousLocal = readLocalEntries()
          var previousJournal = cloneJournal(journal)
          var snapshot = recordOperations(nextEntries, [], true)
          that.cache = cloneEntries(nextEntries)

          if (!that.useIndexedDB || !that.db) {
            try {
              clearLocalEntries()
              Object.keys(nextEntries).forEach(function (key) { localSet(key, nextEntries[key]) })
              return
            } catch (error) {
              clearLocalEntries()
              Object.keys(previousLocal).forEach(function (key) {
                try { localSet(key, previousLocal[key]) } catch (restoreError) {}
              })
              that.cache = previousCache
              replaceJournal(previousJournal)
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
              replaceJournal(previousJournal)
              reject(transaction.error || new Error('IndexedDB saves could not be replaced'))
            }
            transaction.oncomplete = function () {
              if (settled) return
              settled = true
              clearLocalEntries()
              clearCommittedJournal(snapshot)
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
        var that = this

        return this.flush().then(function () { return that.ready }).then(function () {
          var previousCache = cloneEntries(that.cache)
          var previousLocal = readLocalEntries()
          var previousJournal = cloneJournal(journal)
          var snapshot = recordOperations(updates, [], false)
          keys.forEach(function (key) { that.cache[key] = updates[key] })

          if (!that.useIndexedDB || !that.db) {
            try {
              keys.forEach(function (key) { localSet(key, updates[key]) })
              discardFallbackSets(snapshot)
              return
            } catch (error) {
              keys.forEach(function (key) {
                if (Object.prototype.hasOwnProperty.call(previousLocal, key)) {
                  try { localSet(key, previousLocal[key]) } catch (restoreError) {}
                } else safeLocalRemove(key)
              })
              that.cache = previousCache
              replaceJournal(previousJournal)
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
              replaceJournal(previousJournal)
              reject(transaction.error || new Error('IndexedDB saves could not be updated'))
            }
            transaction.oncomplete = function () {
              if (settled) return
              settled = true
              keys.forEach(safeLocalRemove)
              clearCommittedJournal(snapshot)
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
        var that = this

        return this.flush().then(function () { return that.ready }).then(function () {
          var previousCache = cloneEntries(that.cache)
          var previousLocal = readLocalEntries()
          var previousJournal = cloneJournal(journal)
          var snapshot = recordOperations({}, normalizedKeys, false)
          normalizedKeys.forEach(function (key) { delete that.cache[key] })

          if (!that.useIndexedDB || !that.db) {
            try {
              normalizedKeys.forEach(function (key) { target.localStorage.removeItem(LOCAL_PREFIX + key) })
              return
            } catch (error) {
              normalizedKeys.forEach(function (key) {
                if (Object.prototype.hasOwnProperty.call(previousLocal, key)) {
                  try { localSet(key, previousLocal[key]) } catch (restoreError) {}
                }
              })
              that.cache = previousCache
              replaceJournal(previousJournal)
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
              replaceJournal(previousJournal)
              reject(transaction.error || new Error('IndexedDB saves could not be removed'))
            }
            transaction.oncomplete = function () {
              if (settled) return
              settled = true
              normalizedKeys.forEach(safeLocalRemove)
              clearCommittedJournal(snapshot)
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

      flushPending: function () {
        var that = this
        refreshJournal()
        var snapshot = cloneJournal(journal)
        if (!journalHasWork(snapshot)) return Promise.resolve()
        return this.ready.then(function () {
          if (!that.useIndexedDB || !that.db) {
            snapshot.operations.forEach(function (operation) {
              if (operation.type === 'set') localSet(operation.key, operation.value)
              else target.localStorage.removeItem(LOCAL_PREFIX + operation.key)
            })
            that.cache = mergeRecovery({}, readLocalEntries(), snapshot)
            discardFallbackSets(snapshot)
            return
          }
          return new Promise(function (resolve, reject) {
            var transaction = that.db.transaction(STORE_NAME, 'readwrite')
            var store = transaction.objectStore(STORE_NAME)
            if (snapshot.reset) store.clear()
            snapshot.operations.forEach(function (operation) {
              if (operation.type === 'set') store.put(operation.value, operation.key)
              else store.delete(operation.key)
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
              var root = ownerDocument && ownerDocument.documentElement
              if (root) root.removeAttribute('data-dc-storage-error')
              if (snapshot.reset) clearLocalEntries()
              else snapshot.operations.forEach(function (operation) { safeLocalRemove(operation.key) })
              clearCommittedJournal(snapshot)
              if (journalHasWork(journal)) that.scheduleFlush()
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

      flush: function () {
        if (this.flushTimer) {
          target.clearTimeout(this.flushTimer)
          this.flushTimer = null
        }
        var that = this
        function run() { return that.flushPending() }
        this.flushChain = this.flushChain.then(run, run)
        return this.flushChain
      },

      close: function () {
        if (this.closePromise) return this.closePromise
        var that = this
        function closeDatabase() {
          var database = that.db
          that.db = null
          if (database) database.close()
        }
        this.closePromise = Promise.resolve(this.ready).then(function () {
          return that.flush()
        }).then(function () {
          closeDatabase()
        }, function (error) {
          closeDatabase()
          throw error
        })
        return this.closePromise
      },
    }

    publishJournalState()
    storage.init()
    target.addEventListener('pagehide', function () { storage.close().catch(function () {}) }, { once: true })
    ownerDocument.addEventListener('visibilitychange', function () {
      if (ownerDocument.visibilityState === 'hidden') storage.flush().catch(function () {})
    })
    return storage
  }

  DCWeb.BrowserSaveStore = {
    create: create,
    databaseName: DB_NAME,
    journalKey: JOURNAL_KEY,
    storeName: STORE_NAME,
  }
})(window)
