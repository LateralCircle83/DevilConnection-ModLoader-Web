;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var MAX_ENTRIES = 160
  var MAX_MESSAGE_LENGTH = 2400
  var MAX_ITEMS = 12
  var monitors = new WeakMap()

  function clipped(value, limit) {
    var text = String(value || '')
    return text.length > limit ? text.slice(0, limit) + '\u2026' : text
  }

  function summarize(value, depth, seen) {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
    if (typeof value === 'symbol') return String(value)
    if (typeof value === 'function') return '[Function]'

    if (depth >= 2) return Array.isArray(value) ? '[Array]' : '[Object]'
    if (seen.indexOf(value) !== -1) return '[Circular]'
    seen.push(value)

    var descriptors
    try { descriptors = Object.getOwnPropertyDescriptors(value) } catch (error) { descriptors = {} }
    var stack = descriptors.stack && descriptors.stack.value
    var message = descriptors.message && descriptors.message.value
    if (stack || message) {
      seen.pop()
      return String(stack || ('Error: ' + message))
    }

    var result
    if (Array.isArray(value)) {
      var length = descriptors.length && Number(descriptors.length.value) || 0
      var items = []
      for (var index = 0; index < Math.min(length, MAX_ITEMS); index++) {
        var itemDescriptor = descriptors[String(index)]
        items.push(itemDescriptor && Object.prototype.hasOwnProperty.call(itemDescriptor, 'value')
          ? summarize(itemDescriptor.value, depth + 1, seen)
          : itemDescriptor ? '[Accessor]' : '[Empty]')
      }
      result = '[' + items.join(', ') + (length > MAX_ITEMS ? ', \u2026' : '') + ']'
    } else {
      var keys = Object.keys(descriptors).filter(function (key) { return descriptors[key].enumerable })
      result = '{' + keys.slice(0, MAX_ITEMS).map(function (key) {
        var descriptor = descriptors[key]
        var item = Object.prototype.hasOwnProperty.call(descriptor, 'value')
          ? summarize(descriptor.value, depth + 1, seen)
          : '[Accessor]'
        return key + ': ' + item
      }).join(', ') + (keys.length > MAX_ITEMS ? ', \u2026' : '') + '}'
      if (!keys.length) result = '[Object]'
    }

    seen.pop()
    return result
  }

  function formatArguments(args) {
    return clipped(Array.prototype.map.call(args, function (value) {
      return summarize(value, 0, [])
    }).join(' '), MAX_MESSAGE_LENGTH)
  }

  function install(target) {
    if (monitors.has(target)) return monitors.get(target)

    var entries = []
    var nextSequence = 1

    function append(level, source, args) {
      entries.push({
        level: level,
        message: formatArguments(args),
        sequence: nextSequence++,
        source: source,
        time: Date.now(),
      })
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
    }

    var consoleObject = target.console || {}
    ;['warn', 'error'].forEach(function (level) {
      var original = consoleObject[level]
      if (typeof original !== 'function') return
      try {
        consoleObject[level] = function () {
          append(level, 'console', arguments)
          return original.apply(consoleObject, arguments)
        }
      } catch (error) {}
    })

    target.addEventListener('error', function (event) {
      append('error', 'window', [event && (event.error || event.message) || 'Unknown window error'])
    })
    target.addEventListener('unhandledrejection', function (event) {
      append('error', 'promise', [event && event.reason || 'Unknown promise rejection'])
    })

    var monitor = {
      clear: function () { entries.length = 0 },
      snapshot: function () {
        var counts = { error: 0, warn: 0 }
        var copy = entries.map(function (entry) {
          counts[entry.level]++
          return {
            level: entry.level,
            message: entry.message,
            sequence: entry.sequence,
            source: entry.source,
            time: entry.time,
          }
        })
        return { counts: counts, entries: copy, limit: MAX_ENTRIES }
      },
    }
    monitors.set(target, monitor)
    return monitor
  }

  DCWeb.ConsoleMonitor = { install: install }
})(window)
