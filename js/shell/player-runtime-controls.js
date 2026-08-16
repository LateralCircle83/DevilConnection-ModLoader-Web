;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var KEY_SPECS = {}

  function defineKey(id, key, code, keyCode, options) {
    KEY_SPECS[id] = {
      code: code,
      key: key,
      keyCode: keyCode,
      location: options && options.location || 0,
      modifier: Boolean(options && options.modifier),
      shiftedKey: options && options.shiftedKey || '',
    }
  }

  function key(id, label, units, options) {
    return {
      gapBefore: Boolean(options && options.gapBefore),
      id: id,
      label: label,
      modifier: Boolean(KEY_SPECS[id] && KEY_SPECS[id].modifier),
      units: units || 1,
    }
  }

  function spacer(units, options) {
    return { gapBefore: Boolean(options && options.gapBefore), spacer: true, units: units || 1 }
  }

  defineKey('escape', 'Escape', 'Escape', 27)
  for (var functionIndex = 1; functionIndex <= 12; functionIndex++) {
    defineKey('f' + functionIndex, 'F' + functionIndex, 'F' + functionIndex, 111 + functionIndex)
  }
  defineKey('printscreen', 'PrintScreen', 'PrintScreen', 44)
  defineKey('scrolllock', 'ScrollLock', 'ScrollLock', 145)
  defineKey('pause', 'Pause', 'Pause', 19)

  defineKey('backquote', '`', 'Backquote', 192, { shiftedKey: '~' })
  ;['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].forEach(function (digit, index) {
    defineKey('digit' + digit, digit, 'Digit' + digit, index === 9 ? 48 : 49 + index, {
      shiftedKey: ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'][index],
    })
  })
  defineKey('minus', '-', 'Minus', 189, { shiftedKey: '_' })
  defineKey('equal', '=', 'Equal', 187, { shiftedKey: '+' })
  defineKey('backspace', 'Backspace', 'Backspace', 8)
  defineKey('tab', 'Tab', 'Tab', 9)

  'qwertyuiopasdfghjklzxcvbnm'.split('').forEach(function (letter) {
    defineKey('key' + letter, letter, 'Key' + letter.toUpperCase(), letter.toUpperCase().charCodeAt(0), {
      shiftedKey: letter.toUpperCase(),
    })
  })
  defineKey('bracketleft', '[', 'BracketLeft', 219, { shiftedKey: '{' })
  defineKey('bracketright', ']', 'BracketRight', 221, { shiftedKey: '}' })
  defineKey('backslash', '\\', 'Backslash', 220, { shiftedKey: '|' })
  defineKey('capslock', 'CapsLock', 'CapsLock', 20)
  defineKey('semicolon', ';', 'Semicolon', 186, { shiftedKey: ':' })
  defineKey('quote', "'", 'Quote', 222, { shiftedKey: '"' })
  defineKey('enter', 'Enter', 'Enter', 13)
  defineKey('shiftleft', 'Shift', 'ShiftLeft', 16, { location: 1, modifier: true })
  defineKey('comma', ',', 'Comma', 188, { shiftedKey: '<' })
  defineKey('period', '.', 'Period', 190, { shiftedKey: '>' })
  defineKey('slash', '/', 'Slash', 191, { shiftedKey: '?' })
  defineKey('shiftright', 'Shift', 'ShiftRight', 16, { location: 2, modifier: true })
  defineKey('controlleft', 'Control', 'ControlLeft', 17, { location: 1, modifier: true })
  defineKey('metaleft', 'Meta', 'MetaLeft', 91, { location: 1, modifier: true })
  defineKey('altleft', 'Alt', 'AltLeft', 18, { location: 1, modifier: true })
  defineKey('space', ' ', 'Space', 32)
  defineKey('altright', 'Alt', 'AltRight', 18, { location: 2, modifier: true })
  defineKey('contextmenu', 'ContextMenu', 'ContextMenu', 93)
  defineKey('controlright', 'Control', 'ControlRight', 17, { location: 2, modifier: true })
  defineKey('insert', 'Insert', 'Insert', 45)
  defineKey('home', 'Home', 'Home', 36)
  defineKey('pageup', 'PageUp', 'PageUp', 33)
  defineKey('delete', 'Delete', 'Delete', 46)
  defineKey('end', 'End', 'End', 35)
  defineKey('pagedown', 'PageDown', 'PageDown', 34)
  defineKey('arrowup', 'ArrowUp', 'ArrowUp', 38)
  defineKey('arrowleft', 'ArrowLeft', 'ArrowLeft', 37)
  defineKey('arrowdown', 'ArrowDown', 'ArrowDown', 40)
  defineKey('arrowright', 'ArrowRight', 'ArrowRight', 39)

  var KEYBOARD_LAYOUT = [
    [
      key('escape', 'Esc'), key('f1', 'F1', 1, { gapBefore: true }), key('f2', 'F2'), key('f3', 'F3'), key('f4', 'F4'),
      key('f5', 'F5', 1, { gapBefore: true }), key('f6', 'F6'), key('f7', 'F7'), key('f8', 'F8'),
      key('f9', 'F9', 1, { gapBefore: true }), key('f10', 'F10'), key('f11', 'F11'), key('f12', 'F12'),
      key('printscreen', 'PrtSc', 1, { gapBefore: true }), key('scrolllock', 'ScrLk'), key('pause', 'Pause'),
    ],
    [
      key('backquote', '`'), key('digit1', '1'), key('digit2', '2'), key('digit3', '3'), key('digit4', '4'),
      key('digit5', '5'), key('digit6', '6'), key('digit7', '7'), key('digit8', '8'), key('digit9', '9'), key('digit0', '0'),
      key('minus', '-'), key('equal', '='), key('backspace', 'Backspace', 2),
      key('insert', 'Ins', 1, { gapBefore: true }), key('home', 'Home'), key('pageup', 'PgUp'),
    ],
    [
      key('tab', 'Tab', 1.5), key('keyq', 'Q'), key('keyw', 'W'), key('keye', 'E'), key('keyr', 'R'), key('keyt', 'T'),
      key('keyy', 'Y'), key('keyu', 'U'), key('keyi', 'I'), key('keyo', 'O'), key('keyp', 'P'),
      key('bracketleft', '['), key('bracketright', ']'), key('backslash', '\\', 1.5),
      key('delete', 'Del', 1, { gapBefore: true }), key('end', 'End'), key('pagedown', 'PgDn'),
    ],
    [
      key('capslock', 'Caps', 1.8), key('keya', 'A'), key('keys', 'S'), key('keyd', 'D'), key('keyf', 'F'),
      key('keyg', 'G'), key('keyh', 'H'), key('keyj', 'J'), key('keyk', 'K'), key('keyl', 'L'),
      key('semicolon', ';'), key('quote', "'"), key('enter', 'Enter', 2.2),
    ],
    [
      key('shiftleft', 'Shift', 2.3), key('keyz', 'Z'), key('keyx', 'X'), key('keyc', 'C'), key('keyv', 'V'),
      key('keyb', 'B'), key('keyn', 'N'), key('keym', 'M'), key('comma', ','), key('period', '.'), key('slash', '/'),
      key('shiftright', 'Shift', 2.7), spacer(1, { gapBefore: true }), key('arrowup', '\u2191'), spacer(1),
    ],
    [
      key('controlleft', 'Ctrl', 1.5), key('metaleft', 'Meta', 1.25), key('altleft', 'Alt', 1.25), key('space', 'Space', 6),
      key('altright', 'Alt', 1.25), key('contextmenu', 'Menu', 1.25), key('controlright', 'Ctrl', 1.5),
      key('arrowleft', '\u2190', 1, { gapBefore: true }), key('arrowdown', '\u2193'), key('arrowright', '\u2192'),
    ],
  ]

  function emptyDiagnostics(available) {
    return { available: Boolean(available), counts: { error: 0, warn: 0 }, entries: [], limit: 0 }
  }

  function PlayerRuntimeControls(frame) {
    this.frame = frame
    this.pressed = {}
  }

  PlayerRuntimeControls.prototype.dispatchKey = function (id, type) {
    var spec = KEY_SPECS[id]
    var target = this.frame && this.frame.contentWindow
    var doc = target && target.document
    if (!spec || !target || !doc || typeof target.KeyboardEvent !== 'function') return false

    var controlActive = Boolean(this.pressed.controlleft || this.pressed.controlright || (type === 'keydown' && spec.key === 'Control'))
    var shiftActive = Boolean(this.pressed.shiftleft || this.pressed.shiftright || (type === 'keydown' && spec.key === 'Shift'))
    var altActive = Boolean(this.pressed.altleft || this.pressed.altright || (type === 'keydown' && spec.key === 'Alt'))
    var metaActive = Boolean(this.pressed.metaleft || (type === 'keydown' && spec.key === 'Meta'))
    var event
    try {
      event = new target.KeyboardEvent(type, {
        altKey: altActive,
        bubbles: true,
        cancelable: true,
        code: spec.code,
        ctrlKey: controlActive,
        key: shiftActive && spec.shiftedKey ? spec.shiftedKey : spec.key,
        location: spec.location || 0,
        metaKey: metaActive,
        repeat: false,
        shiftKey: shiftActive,
        view: target,
      })
      ;['keyCode', 'which'].forEach(function (property) {
        try {
          Object.defineProperty(event, property, {
            configurable: true,
            get: function () { return spec.keyCode },
          })
        } catch (error) {}
      })
    } catch (error) {
      return false
    }

    var receiver = doc.activeElement && typeof doc.activeElement.dispatchEvent === 'function'
      ? doc.activeElement
      : doc
    if (!receiver || typeof receiver.dispatchEvent !== 'function') return false
    receiver.dispatchEvent(event)
    return true
  }

  PlayerRuntimeControls.prototype.keyDown = function (id) {
    if (!KEY_SPECS[id] || this.pressed[id]) return false
    if (!this.dispatchKey(id, 'keydown')) return false
    this.pressed[id] = true
    return true
  }

  PlayerRuntimeControls.prototype.keyUp = function (id) {
    if (!KEY_SPECS[id] || !this.pressed[id]) return false
    delete this.pressed[id]
    return this.dispatchKey(id, 'keyup')
  }

  PlayerRuntimeControls.prototype.tapKey = function (id) {
    if (!this.keyDown(id)) return false
    this.keyUp(id)
    return true
  }

  PlayerRuntimeControls.prototype.releaseAll = function () {
    Object.keys(this.pressed).forEach(function (id) { this.keyUp(id) }, this)
  }

  PlayerRuntimeControls.prototype.readDiagnostics = function () {
    var target = this.frame && this.frame.contentWindow
    var monitor = target && target.api && target.api.__dcDiagnostics
    if (!monitor || typeof monitor.snapshot !== 'function') return emptyDiagnostics(false)

    try {
      var result = monitor.snapshot() || {}
      var entries = Array.isArray(result.entries) ? result.entries.map(function (entry) {
        return {
          level: entry && entry.level === 'warn' ? 'warn' : 'error',
          message: String(entry && entry.message || '').slice(0, 2400),
          sequence: Number(entry && entry.sequence) || 0,
          source: String(entry && entry.source || 'console').slice(0, 32),
          time: Number(entry && entry.time) || 0,
        }
      }) : []
      var counts = { error: 0, warn: 0 }
      entries.forEach(function (entry) { counts[entry.level]++ })
      return {
        available: true,
        counts: counts,
        entries: entries,
        limit: Number(result.limit) || 0,
      }
    } catch (error) {
      return emptyDiagnostics(false)
    }
  }

  PlayerRuntimeControls.prototype.clearDiagnostics = function () {
    var target = this.frame && this.frame.contentWindow
    var monitor = target && target.api && target.api.__dcDiagnostics
    if (monitor && typeof monitor.clear === 'function') {
      try { monitor.clear() } catch (error) {}
    }
    return this.readDiagnostics()
  }

  PlayerRuntimeControls.keyboardLayout = function () {
    return KEYBOARD_LAYOUT.map(function (row) {
      return row.map(function (item) {
        return {
          gapBefore: Boolean(item.gapBefore),
          id: item.id || '',
          label: item.label || '',
          modifier: Boolean(item.modifier),
          spacer: Boolean(item.spacer),
          units: Number(item.units) || 1,
        }
      })
    })
  }

  DCWeb.PlayerRuntimeControls = PlayerRuntimeControls
})(window)
