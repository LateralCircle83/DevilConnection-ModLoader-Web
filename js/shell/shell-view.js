;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb

  function formatBytes(bytes) {
    var units = ['B', 'KB', 'MB', 'GB', 'TB']
    var value = bytes
    var unit = 0
    while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++ }
    return value.toFixed(unit > 1 ? 2 : 0) + ' ' + units[unit]
  }

  function formatConsoleTime(value) {
    if (!value) return '--:--:--'
    var date = new Date(value)
    if (Number.isNaN(date.getTime())) return '--:--:--'
    return [date.getHours(), date.getMinutes(), date.getSeconds()].map(function (part) {
      return String(part).padStart(2, '0')
    }).join(':')
  }

  function createElement(doc, tag, className, text) {
    var element = doc.createElement(tag)
    if (className) element.className = className
    if (text !== undefined) element.textContent = text
    return element
  }

  function ShellView(doc) {
    this.doc = doc
    this.loaderView = doc.getElementById('loader-view')
    this.playerView = doc.getElementById('player-view')
    this.frame = doc.getElementById('game-frame')
    this.coreInput = doc.getElementById('core-asar-input')
    this.loadCoreButton = doc.getElementById('load-core-game')
    this.startButton = doc.getElementById('start-game')
    this.restoreSourcesButton = doc.getElementById('restore-sources')
    this.restoreSourcesDetail = doc.getElementById('restore-sources-detail')
    this.modInput = doc.getElementById('mod-asar-input')
    this.addModsButton = doc.getElementById('add-mods')
    this.modList = doc.getElementById('mod-list')
    this.modViewTabs = Array.prototype.slice.call(doc.querySelectorAll('[data-mod-view]'))
    this.modViewPanels = Array.prototype.slice.call(doc.querySelectorAll('[data-mod-panel]'))
    this.recommendedModList = doc.getElementById('recommended-mod-list')
    this.recommendedModListeners = []
    this.configDialog = doc.getElementById('mod-config-dialog')
    this.configForm = doc.getElementById('mod-config-form')
    this.configTitle = doc.getElementById('mod-config-title')
    this.configDescription = doc.getElementById('mod-config-description')
    this.configFields = doc.getElementById('mod-config-fields')
    this.configError = doc.getElementById('mod-config-error')
    this.configCloseButton = doc.getElementById('close-mod-config')
    this.configCancelButton = doc.getElementById('cancel-mod-config')
    this.confirmDialog = doc.getElementById('confirm-dialog')
    this.confirmTitle = doc.getElementById('confirm-dialog-title')
    this.confirmMessage = doc.getElementById('confirm-dialog-message')
    this.confirmAcceptButton = doc.getElementById('accept-confirm')
    this.confirmCancelButton = doc.getElementById('cancel-confirm')
    this.tabs = Array.prototype.slice.call(doc.querySelectorAll('.manager-tab'))
    this.pages = Array.prototype.slice.call(doc.querySelectorAll('.manager-page'))
    this.pageListeners = []
    this.statusCopy = doc.getElementById('mount-status')
    this.progressRow = doc.getElementById('progress-row')
    this.progressFill = doc.getElementById('progress-fill')
    this.progressLabel = doc.getElementById('progress-label')
    this.errorDetails = doc.getElementById('error-details')
    this.errorOutput = doc.getElementById('error-output')
    this.coreDetails = doc.getElementById('core-details')
    this.coreFile = doc.getElementById('core-file')
    this.coreVersion = doc.getElementById('core-version')
    this.coreSize = doc.getElementById('core-size')
    this.selectedModCount = doc.getElementById('selected-mod-count')
    this.savePointCount = doc.getElementById('save-point-count')
    this.saveEntryCount = doc.getElementById('save-entry-count')
    this.saveTotalSize = doc.getElementById('save-total-size')
    this.savePointList = doc.getElementById('save-point-list')
    this.saveStorageList = doc.getElementById('save-storage-list')
    this.saveStatus = doc.getElementById('save-operation-status')
    this.saveRefreshButton = doc.getElementById('refresh-saves')
    this.saveExportButton = doc.getElementById('export-saves')
    this.saveImportButton = doc.getElementById('import-saves')
    this.saveClearButton = doc.getElementById('clear-saves')
    this.saveImportInput = doc.getElementById('import-saves-input')
    this.readmeView = new DCWeb.ReadmeView(global, doc.getElementById('about-readme'))
    this.menu = doc.getElementById('player-menu')
    this.menuButton = doc.getElementById('open-player-menu')
    this.menuCloseButton = doc.getElementById('close-player-menu')
    this.virtualKeyboard = doc.getElementById('virtual-keyboard')
    this.playerConsoleList = doc.getElementById('player-console-list')
    this.playerConsoleSummary = doc.getElementById('player-console-summary')
    this.playerConsoleCountAll = doc.getElementById('player-console-count-all')
    this.playerConsoleCountWarn = doc.getElementById('player-console-count-warn')
    this.playerConsoleCountError = doc.getElementById('player-console-count-error')
    this.playerConsoleFilters = Array.prototype.slice.call(doc.querySelectorAll('[data-console-filter]'))
    this.playerConsoleRefreshButton = doc.getElementById('refresh-player-console')
    this.playerConsoleCopyButton = doc.getElementById('copy-player-console')
    this.playerConsoleClearButton = doc.getElementById('clear-player-console')
    this.playerConsoleCopyStatus = doc.getElementById('player-console-copy-status')
    this.mountedFile = doc.getElementById('mounted-file')
    this.mountedSize = doc.getElementById('mounted-size')
    this.mountedVersion = doc.getElementById('mounted-version')
    this.mountedMods = doc.getElementById('mounted-mods')
    this.closeButton = doc.getElementById('close-game')
    this.reloadButton = doc.getElementById('reload-game')
    this.launchReady = false
    this.busy = false
    this.menuReturnFocus = null
    this.playerConsoleFilter = 'all'
    this.playerConsoleSnapshot = { available: false, counts: { error: 0, warn: 0 }, entries: [], limit: 0 }
    this.configReturnFocus = null
    this.configModId = ''
    this.confirmReturnFocus = null
    this.confirmResolver = null
    this.pendingFrameLoad = null
    if (DCWeb.PlayerRuntimeControls && typeof DCWeb.PlayerRuntimeControls.keyboardLayout === 'function') {
      this.renderVirtualKeyboard(DCWeb.PlayerRuntimeControls.keyboardLayout())
    }
  }

  ShellView.prototype.renderVirtualKeyboard = function (layout) {
    this.virtualKeyboard.replaceChildren()
    var surface = createElement(this.doc, 'div', 'virtual-keyboard-layout')
    ;(layout || []).forEach(function (items, rowIndex) {
      var row = createElement(this.doc, 'div', 'virtual-key-row' + (rowIndex === 0 ? ' is-function-row' : ''))
      items.forEach(function (item) {
        var width = Math.round(item.units * 34 + Math.max(0, item.units - 1) * 4)
        if (item.spacer) {
          var space = createElement(this.doc, 'span', 'virtual-key-spacer' + (item.gapBefore ? ' has-gap-before' : ''))
          space.style.setProperty('--virtual-key-width', width + 'px')
          row.append(space)
          return
        }
        var button = createElement(this.doc, 'button', 'virtual-key' + (item.modifier ? ' is-modifier' : '') + (item.gapBefore ? ' has-gap-before' : ''), item.label)
        button.type = 'button'
        button.dataset.virtualKey = item.id
        if (item.modifier) button.dataset.virtualModifier = 'true'
        button.setAttribute('aria-label', item.label)
        button.setAttribute('aria-pressed', 'false')
        button.style.setProperty('--virtual-key-width', width + 'px')
        row.append(button)
      }, this)
      surface.append(row)
    }, this)
    this.virtualKeyboard.append(surface)
  }

  ShellView.prototype.bind = function (handlers) {
    var view = this
    function releaseVirtualKeys() {
      view.virtualKeyboard.querySelectorAll('[data-virtual-key]').forEach(function (button) {
        button.setAttribute('aria-pressed', 'false')
        delete button.dataset.pointerActive
        delete button.dataset.suppressClickUntil
      })
      handlers.releaseVirtualKeys()
    }
    function closePlayerMenu(restoreFocus) {
      releaseVirtualKeys()
      view.closeMenu(restoreFocus)
    }
    this.loadCoreButton.addEventListener('click', function () {
      if (!handlers.isBusy()) handlers.selectCore()
    })
    this.coreInput.addEventListener('change', function () {
      handlers.loadCore(view.coreInput.files && view.coreInput.files[0])
    })
    this.startButton.addEventListener('click', function () { handlers.start() })
    this.restoreSourcesButton.addEventListener('click', function () { handlers.restoreSources(true) })
    this.addModsButton.addEventListener('click', function () {
      if (!handlers.isBusy()) handlers.selectMods()
    })
    this.modInput.addEventListener('change', function () {
      handlers.addMods(Array.prototype.slice.call(view.modInput.files || []))
    })
    this.tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { view.showPage(tab.dataset.page) })
    })
    this.modList.addEventListener('change', function (event) {
      var control = event.target.closest('[data-action="toggle"]')
      var row = event.target.closest('[data-mod-id]')
      if (control && row) handlers.toggleMod(row.dataset.modId, control.checked)
    })
    this.modList.addEventListener('click', function (event) {
      var control = event.target.closest('button[data-action]')
      var row = event.target.closest('[data-mod-id]')
      if (!control || !row) return
      if (control.dataset.action === 'config') handlers.configureMod(row.dataset.modId)
      if (control.dataset.action === 'up') handlers.moveMod(row.dataset.modId, -1)
      if (control.dataset.action === 'down') handlers.moveMod(row.dataset.modId, 1)
      if (control.dataset.action === 'remove') handlers.removeMod(row.dataset.modId)
    })
    this.modViewTabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () { view.showModView(tab.dataset.modView) })
      tab.addEventListener('keydown', function (event) {
        var targetIndex = -1
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') targetIndex = (index + view.modViewTabs.length - 1) % view.modViewTabs.length
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') targetIndex = (index + 1) % view.modViewTabs.length
        if (event.key === 'Home') targetIndex = 0
        if (event.key === 'End') targetIndex = view.modViewTabs.length - 1
        if (targetIndex === -1) return
        event.preventDefault()
        view.modViewTabs[targetIndex].focus()
        view.showModView(view.modViewTabs[targetIndex].dataset.modView)
      })
    })
    this.recommendedModList.addEventListener('click', function (event) {
      if (!event.target.closest('[data-action="retry-recommended-mods"]')) return
      view.recommendedModListeners.forEach(function (listener) { listener(true) })
    })

    this.configForm.addEventListener('submit', function (event) {
      event.preventDefault()
      if (!view.configModId) return
      var value = {}
      view.configFields.querySelectorAll('[data-config-key]').forEach(function (control) {
        var key = control.dataset.configKey
        if (control.type === 'checkbox') value[key] = control.checked
        else value[key] = control.value
      })
      handlers.saveModConfig(view.configModId, value)
    })
    this.configCloseButton.addEventListener('click', function () { view.closeModConfig() })
    this.configCancelButton.addEventListener('click', function () { view.closeModConfig() })
    this.configDialog.addEventListener('click', function (event) {
      if (event.target === view.configDialog) view.closeModConfig()
    })

    this.menuButton.addEventListener('click', function () {
      view.openMenu()
      handlers.refreshPlayerDiagnostics()
    })
    this.menuCloseButton.addEventListener('click', function () { closePlayerMenu() })
    this.menu.addEventListener('click', function (event) {
      if (event.target === view.menu) closePlayerMenu()
    })
    this.closeButton.addEventListener('click', function () {
      closePlayerMenu(false)
      handlers.close()
    })
    this.reloadButton.addEventListener('click', function () {
      closePlayerMenu()
      handlers.reload()
    })
    this.virtualKeyboard.addEventListener('pointerdown', function (event) {
      var button = event.target.closest('[data-virtual-key]')
      if (!button || button.dataset.pointerActive === 'true') return
      if (button.dataset.virtualModifier === 'true') return
      if (event.pointerType === 'touch') return
      event.preventDefault()
      button.dataset.pointerActive = 'true'
      button.dataset.suppressClickUntil = String(Date.now() + 700)
      button.setAttribute('aria-pressed', 'true')
      if (button.setPointerCapture && event.pointerId !== undefined) {
        try { button.setPointerCapture(event.pointerId) } catch (error) {}
      }
      handlers.virtualKeyDown(button.dataset.virtualKey)
    })
    ;['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (eventName) {
      view.virtualKeyboard.addEventListener(eventName, function (event) {
        var button = event.target.closest('[data-virtual-key]')
        if (!button || button.dataset.pointerActive !== 'true') return
        event.preventDefault()
        delete button.dataset.pointerActive
        button.setAttribute('aria-pressed', 'false')
        handlers.virtualKeyUp(button.dataset.virtualKey)
      })
    })
    this.virtualKeyboard.addEventListener('click', function (event) {
      var button = event.target.closest('[data-virtual-key]')
      if (!button) return
      if (button.dataset.virtualModifier === 'true') {
        var pressed = button.getAttribute('aria-pressed') === 'true'
        button.setAttribute('aria-pressed', String(!pressed))
        if (pressed) handlers.virtualKeyUp(button.dataset.virtualKey)
        else handlers.virtualKeyDown(button.dataset.virtualKey)
        return
      }
      var suppressUntil = Number(button.dataset.suppressClickUntil) || 0
      delete button.dataset.suppressClickUntil
      if (Date.now() <= suppressUntil) {
        return
      }
      handlers.virtualKeyTap(button.dataset.virtualKey)
    })
    this.playerConsoleFilters.forEach(function (button) {
      button.addEventListener('click', function () {
        view.playerConsoleFilter = button.dataset.consoleFilter
        view.renderPlayerConsole(view.playerConsoleSnapshot)
      })
    })
    this.playerConsoleRefreshButton.addEventListener('click', function () { handlers.refreshPlayerDiagnostics() })
    this.playerConsoleClearButton.addEventListener('click', function () { handlers.clearPlayerDiagnostics() })
    this.playerConsoleCopyButton.addEventListener('click', function () { view.copyPlayerConsole() })
    this.menu.ownerDocument.addEventListener('keydown', function (event) {
      if (!view.confirmDialog.hidden) {
        if (event.key === 'Escape') {
          event.preventDefault()
          view.resolveConfirmation(false)
          return
        }
        if (event.key === 'Tab') view.keepFocusIn(view.confirmDialog, event)
        return
      }
      if (!view.configDialog.hidden) {
        if (event.key === 'Escape') {
          event.preventDefault()
          view.closeModConfig()
          return
        }
        if (event.key === 'Tab') view.keepFocusIn(view.configDialog, event)
        return
      }
      if (view.menu.hidden) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closePlayerMenu()
        return
      }
      if (event.key !== 'Tab') return
      var controls = Array.prototype.slice.call(view.menu.querySelectorAll('button:not([disabled])'))
      if (!controls.length) return
      var first = controls[0]
      var last = controls[controls.length - 1]
      if (event.shiftKey && event.target === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && event.target === last) {
        event.preventDefault()
        first.focus()
      }
    })
  }

  ShellView.prototype.keepFocusIn = function (container, event) {
    var controls = Array.prototype.slice.call(container.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled])'))
    if (!controls.length) return
    var first = controls[0]
    var last = controls[controls.length - 1]
    if (event.shiftKey && event.target === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && event.target === last) {
      event.preventDefault()
      first.focus()
    }
  }

  ShellView.prototype.openMenu = function () {
    if (!this.menu.hidden) return
    this.menuReturnFocus = this.menu.ownerDocument.activeElement
    this.menu.hidden = false
    this.menuButton.setAttribute('aria-expanded', 'true')
    this.menuCloseButton.focus()
  }

  ShellView.prototype.closeMenu = function (restoreFocus) {
    if (this.menu.hidden) return
    this.menu.hidden = true
    this.menuButton.setAttribute('aria-expanded', 'false')
    if (restoreFocus !== false && this.menuReturnFocus && this.menuReturnFocus.focus) {
      this.menuReturnFocus.focus()
    }
    this.menuReturnFocus = null
  }

  ShellView.prototype.filteredPlayerConsoleEntries = function () {
    var filter = this.playerConsoleFilter
    return (this.playerConsoleSnapshot.entries || []).filter(function (entry) {
      return filter === 'all' || entry.level === filter
    })
  }

  ShellView.prototype.renderPlayerConsole = function (snapshot) {
    var value = snapshot || { available: false, counts: { error: 0, warn: 0 }, entries: [], limit: 0 }
    var counts = value.counts || { error: 0, warn: 0 }
    this.playerConsoleSnapshot = value
    this.playerConsoleCountWarn.textContent = String(counts.warn || 0)
    this.playerConsoleCountError.textContent = String(counts.error || 0)
    this.playerConsoleCountAll.textContent = String((counts.warn || 0) + (counts.error || 0))
    this.playerConsoleSummary.textContent = 'Warn ' + (counts.warn || 0) + ' / Error ' + (counts.error || 0)
    this.playerConsoleFilters.forEach(function (button) {
      var active = button.dataset.consoleFilter === this.playerConsoleFilter
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-pressed', String(active))
    }, this)

    this.playerConsoleList.replaceChildren()
    var entries = this.filteredPlayerConsoleEntries()
    if (!value.available || !entries.length) {
      this.playerConsoleList.append(createElement(
        this.doc,
        'p',
        'player-console-empty',
        value.available ? '暂无警告或错误' : '日志监控尚未就绪',
      ))
      return
    }

    entries.forEach(function (entry) {
      var row = createElement(this.doc, 'article', 'player-console-entry is-' + entry.level)
      var header = createElement(this.doc, 'header')
      header.append(createElement(this.doc, 'span', 'player-console-level', entry.level))
      header.append(createElement(this.doc, 'time', '', formatConsoleTime(entry.time)))
      header.append(createElement(this.doc, 'span', 'player-console-source', entry.source))
      row.append(header)
      row.append(createElement(this.doc, 'pre', 'player-console-message', entry.message))
      this.playerConsoleList.append(row)
    }, this)
  }

  ShellView.prototype.copyPlayerConsole = function () {
    var entries = this.filteredPlayerConsoleEntries()
    if (!entries.length) {
      this.playerConsoleCopyStatus.textContent = '没有可复制的日志'
      return
    }
    var text = entries.map(function (entry) {
      return '[' + formatConsoleTime(entry.time) + '] ' + entry.level.toUpperCase() + ' ' + entry.source + '\n' + entry.message
    }).join('\n\n')
    var clipboard = this.doc.defaultView && this.doc.defaultView.navigator && this.doc.defaultView.navigator.clipboard
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      this.playerConsoleCopyStatus.textContent = '当前浏览器不允许复制'
      return
    }
    var view = this
    Promise.resolve(clipboard.writeText(text)).then(function () {
      view.playerConsoleCopyStatus.textContent = '已复制当前筛选结果'
    }, function () {
      view.playerConsoleCopyStatus.textContent = '复制失败'
    })
  }

  ShellView.prototype.showPage = function (pageName) {
    this.tabs.forEach(function (tab) {
      var active = tab.dataset.page === pageName
      tab.classList.toggle('is-active', active)
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
    })
    this.pages.forEach(function (page) { page.hidden = page.dataset.page !== pageName })
    if (pageName === 'about') this.readmeView.load()
    this.pageListeners.forEach(function (listener) { listener(pageName) })
  }

  ShellView.prototype.onPageChange = function (listener) {
    if (typeof listener === 'function') this.pageListeners.push(listener)
  }

  ShellView.prototype.showModView = function (viewName) {
    if (viewName !== 'installed' && viewName !== 'recommended') return
    this.modViewTabs.forEach(function (tab) {
      var active = tab.dataset.modView === viewName
      tab.classList.toggle('is-active', active)
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
    })
    this.modViewPanels.forEach(function (panel) { panel.hidden = panel.dataset.modPanel !== viewName })
    if (viewName === 'recommended') {
      this.recommendedModListeners.forEach(function (listener) { listener(false) })
    }
  }

  ShellView.prototype.onRecommendedModsRequested = function (listener) {
    if (typeof listener === 'function') this.recommendedModListeners.push(listener)
  }

  ShellView.prototype.bindSaveManager = function (handlers) {
    var view = this
    this.saveRefreshButton.addEventListener('click', function () { handlers.refresh() })
    this.saveExportButton.addEventListener('click', function () { handlers.exportAll() })
    this.saveImportButton.addEventListener('click', function () { view.saveImportInput.click() })
    this.saveImportInput.addEventListener('change', function () {
      var file = view.saveImportInput.files && view.saveImportInput.files[0]
      view.saveImportInput.value = ''
      handlers.importFile(file)
    })
    this.saveClearButton.addEventListener('click', function () { handlers.clear() })
    this.confirmCancelButton.addEventListener('click', function () { view.resolveConfirmation(false) })
    this.confirmAcceptButton.addEventListener('click', function () { view.resolveConfirmation(true) })
    this.confirmDialog.addEventListener('click', function (event) {
      if (event.target === view.confirmDialog) view.resolveConfirmation(false)
    })
  }

  ShellView.prototype.setSaveBusy = function (value) {
    this.saveRefreshButton.disabled = value
    this.saveExportButton.disabled = value
    this.saveImportButton.disabled = value
    this.saveClearButton.disabled = value
    this.saveImportInput.disabled = value
  }

  ShellView.prototype.setSaveStatus = function (message, state) {
    this.saveStatus.textContent = message || ''
    if (state) this.saveStatus.dataset.state = state
    else delete this.saveStatus.dataset.state
  }

  ShellView.prototype.renderSaveReport = function (report) {
    var view = this
    var doc = this.doc
    this.savePointCount.textContent = String(report.savePointCount)
    this.saveEntryCount.textContent = String(report.entryCount)
    this.saveTotalSize.textContent = formatBytes(report.totalBytes)
    this.savePointList.replaceChildren()
    this.saveStorageList.replaceChildren()

    if (!report.savePoints.length) {
      var empty = createElement(doc, 'div', 'save-empty')
      empty.append(createElement(doc, 'strong', '', '尚未识别到游戏存档'))
      empty.append(createElement(doc, 'span', '', report.entryCount ? '当前数据中没有可展示的手动或自动存档' : '开始游戏并保存后，存档会显示在这里'))
      this.savePointList.append(empty)
    } else report.savePoints.forEach(function (save) {
      var row = createElement(doc, 'article', 'save-point-item')
      var marker = createElement(doc, 'span', 'save-point-marker', save.slot ? String(save.slot).padStart(2, '0') : 'A')
      var content = createElement(doc, 'div', 'save-point-content')
      var heading = createElement(doc, 'div', 'save-point-heading')
      heading.append(createElement(doc, 'strong', '', save.title))
      heading.append(createElement(doc, 'span', '', save.kind))
      content.append(heading)
      var meta = [save.date, save.scenario].filter(Boolean).join(' · ')
      content.append(createElement(doc, 'p', '', meta || '未记录时间与场景'))
      row.append(marker, content)
      view.savePointList.append(row)
    })

    if (!report.storageEntries.length) {
      this.saveStorageList.append(createElement(doc, 'p', 'save-storage-empty', '没有存储条目'))
    } else report.storageEntries.forEach(function (entry) {
      var row = createElement(doc, 'div', 'save-storage-item')
      var content = createElement(doc, 'div')
      content.append(createElement(doc, 'strong', '', entry.kind))
      content.append(createElement(doc, 'code', '', entry.key))
      row.append(content, createElement(doc, 'span', '', entry.detail + ' · ' + formatBytes(entry.size)))
      view.saveStorageList.append(row)
    })
    if (!this.saveStatus.textContent) this.setSaveStatus('数据来自当前浏览器来源', '')
  }

  ShellView.prototype.downloadBlob = function (fileName, blob) {
    var url = global.URL.createObjectURL(blob)
    var link = this.doc.createElement('a')
    link.href = url
    link.download = fileName
    this.doc.body.append(link)
    link.click()
    link.remove()
    global.setTimeout(function () { global.URL.revokeObjectURL(url) }, 0)
  }

  ShellView.prototype.confirmAction = function (options) {
    if (this.confirmResolver) this.resolveConfirmation(false)
    this.confirmReturnFocus = this.doc.activeElement
    this.confirmTitle.textContent = options.title || '确认操作'
    this.confirmMessage.textContent = options.message || ''
    this.confirmAcceptButton.textContent = options.confirmLabel || '确认'
    this.confirmAcceptButton.classList.toggle('is-danger', Boolean(options.danger))
    this.confirmDialog.hidden = false
    this.confirmAcceptButton.focus()
    var view = this
    return new Promise(function (resolve) { view.confirmResolver = resolve })
  }

  ShellView.prototype.resolveConfirmation = function (accepted) {
    if (!this.confirmResolver) return
    var resolve = this.confirmResolver
    this.confirmResolver = null
    this.confirmDialog.hidden = true
    this.confirmAcceptButton.classList.remove('is-danger')
    if (this.confirmReturnFocus && this.confirmReturnFocus.focus) this.confirmReturnFocus.focus()
    this.confirmReturnFocus = null
    resolve(Boolean(accepted))
  }

  ShellView.prototype.setBusy = function (value) {
    this.busy = value
    this.loadCoreButton.disabled = value
    this.restoreSourcesButton.disabled = value
    this.coreInput.disabled = value
    this.addModsButton.disabled = value
    this.modInput.disabled = value
    this.startButton.disabled = value || !this.launchReady
    this.tabs.forEach(function (tab) { tab.disabled = value })
    this.modViewTabs.forEach(function (tab) { tab.disabled = value })
    this.modList.querySelectorAll('button, input').forEach(function (control) {
      control.disabled = value || control.dataset.baseDisabled === 'true'
    })
  }

  ShellView.prototype.openModConfig = function (mod, saved) {
    var view = this
    var schema = mod.schema || {}
    this.configReturnFocus = this.doc.activeElement
    this.configModId = mod.id
    this.configTitle.textContent = schema.title || mod.name
    this.configDescription.textContent = schema.description || ''
    this.configDescription.hidden = !schema.description
    this.configError.hidden = true
    this.configError.textContent = ''
    this.configFields.replaceChildren()

    ;(schema.fields || []).forEach(function (field, index) {
      if (!field || !field.key) return
      var row = createElement(view.doc, 'div', 'config-field')
      var inputId = 'mod-config-field-' + index
      var label = createElement(view.doc, 'label', 'config-label', field.label || field.key)
      label.htmlFor = inputId
      row.append(label)
      var hasSaved = Object.prototype.hasOwnProperty.call(saved, field.key)
      var value = hasSaved ? saved[field.key] : field.default
      var control

      if (field.type === 'toggle') {
        var toggle = createElement(view.doc, 'label', 'config-toggle')
        control = createElement(view.doc, 'input')
        control.type = 'checkbox'
        control.checked = Boolean(value)
        toggle.append(control, createElement(view.doc, 'span', '', control.checked ? '开启' : '关闭'))
        control.addEventListener('change', function () {
          toggle.lastChild.textContent = control.checked ? '开启' : '关闭'
        })
        row.append(toggle)
      } else if (field.type === 'select') {
        control = createElement(view.doc, 'select', 'config-input')
        ;(field.options || []).forEach(function (option) {
          var descriptor = option && typeof option === 'object'
            ? { label: option.label !== undefined ? option.label : option.value, value: option.value }
            : { label: option, value: option }
          var item = createElement(view.doc, 'option', '', descriptor.label === undefined ? '' : String(descriptor.label))
          item.value = descriptor.value === undefined ? '' : String(descriptor.value)
          control.append(item)
        })
        control.value = value === undefined || value === null ? '' : String(value)
        row.append(control)
      } else {
        control = createElement(view.doc, 'input', 'config-input')
        control.type = field.type === 'password' || field.type === 'number' ? field.type : 'text'
        control.value = value === undefined || value === null ? '' : String(value)
        if (field.placeholder) control.placeholder = field.placeholder
        if (field.type === 'number') {
          if (field.min !== undefined) control.min = field.min
          if (field.max !== undefined) control.max = field.max
          if (field.step !== undefined) control.step = field.step
        }
        row.append(control)
      }

      control.id = inputId
      control.dataset.configKey = field.key
      control.required = Boolean(field.required)
      if (field.help) row.append(createElement(view.doc, 'p', 'config-help', field.help))
      view.configFields.append(row)
    })

    this.configDialog.hidden = false
    var firstControl = this.configFields.querySelector('input,select')
    ;(firstControl || this.configCloseButton).focus()
  }

  ShellView.prototype.closeModConfig = function () {
    if (this.configDialog.hidden) return
    this.configDialog.hidden = true
    this.configModId = ''
    if (this.configReturnFocus && this.configReturnFocus.focus) this.configReturnFocus.focus()
    this.configReturnFocus = null
  }

  ShellView.prototype.showModConfigError = function (message) {
    this.configError.textContent = message
    this.configError.hidden = false
  }

  ShellView.prototype.setLaunchReady = function (value) {
    this.launchReady = Boolean(value)
    this.startButton.disabled = this.busy || !this.launchReady
  }

  ShellView.prototype.setStatus = function (message, state) {
    this.statusCopy.textContent = message
    if (state) this.statusCopy.dataset.state = state
    else delete this.statusCopy.dataset.state
  }

  ShellView.prototype.setProgress = function (value, label) {
    var percentage = Math.max(0, Math.min(100, Math.round(value)))
    this.progressRow.hidden = false
    this.progressFill.style.width = percentage + '%'
    this.progressLabel.textContent = label || percentage + '%'
  }

  ShellView.prototype.showError = function (error) {
    var message = error && error.message ? error.message : String(error)
    this.setStatus(message, 'error')
    this.errorOutput.textContent = error && error.stack ? error.stack : message
    this.errorDetails.hidden = false
    this.errorDetails.open = true
  }

  ShellView.prototype.clearError = function () {
    this.errorDetails.hidden = true
    this.errorDetails.open = false
    this.errorOutput.textContent = ''
  }

  ShellView.prototype.showBaseGame = function (file, version) {
    this.coreFile.textContent = file.name
    this.coreVersion.textContent = version || '--'
    this.coreSize.textContent = formatBytes(file.size)
    this.coreDetails.hidden = false
  }

  ShellView.prototype.setModCount = function (count) {
    this.selectedModCount.textContent = count + ' 个'
  }

  ShellView.prototype.renderMods = function (mods) {
    var doc = this.doc
    this.modList.replaceChildren()
    if (!mods.length) {
      var empty = createElement(doc, 'div', 'mod-empty')
      empty.append(createElement(doc, 'strong', '', '尚未添加模组'))
      empty.append(createElement(doc, 'span', '', '添加本地 DCML .asar 文件后会显示在这里'))
      this.modList.append(empty)
      return
    }

    mods.forEach(function (mod, index) {
      var row = createElement(doc, 'article', 'mod-item' + (mod.enabled ? '' : ' is-disabled'))
      row.dataset.modId = mod.id
      row.append(createElement(doc, 'span', 'mod-order', String(index + 1).padStart(2, '0')))

      var content = createElement(doc, 'div', 'mod-content')
      var titleLine = createElement(doc, 'div', 'mod-title-line')
      titleLine.append(createElement(doc, 'strong', 'mod-name', mod.name))
      if (mod.hasHook) titleLine.append(createElement(doc, 'span', 'mod-badge', 'HOOK'))
      if (mod.hasConfig) titleLine.append(createElement(doc, 'span', 'mod-badge', 'CONFIG'))
      content.append(titleLine)
      content.append(createElement(doc, 'p', 'mod-description', mod.description))
      content.append(createElement(doc, 'p', 'mod-meta', mod.fileName + ' · ' + mod.version + ' · ' + formatBytes(mod.size)))
      row.append(content)

      var controls = createElement(doc, 'div', 'mod-controls')
      var toggleLabel = createElement(doc, 'label', 'mod-toggle')
      var toggle = createElement(doc, 'input')
      toggle.type = 'checkbox'
      toggle.checked = mod.enabled
      toggle.dataset.action = 'toggle'
      toggle.setAttribute('aria-label', (mod.enabled ? '停用 ' : '启用 ') + mod.name)
      toggleLabel.append(toggle, createElement(doc, 'span', '', mod.enabled ? '已启用' : '已停用'))
      controls.append(toggleLabel)

      var descriptors = [
        { action: 'up', label: '上移 ' + mod.name, symbol: '\u2191', disabled: index === 0 },
        { action: 'down', label: '下移 ' + mod.name, symbol: '\u2193', disabled: index === mods.length - 1 },
        { action: 'remove', label: '移除 ' + mod.name, symbol: '\u00d7', disabled: false },
      ]
      if (mod.hasConfig) {
        descriptors.unshift({ action: 'config', label: '配置 ' + mod.name, symbol: '\u2699', disabled: false })
      }
      descriptors.forEach(function (descriptor) {
        var button = createElement(doc, 'button', 'mod-icon-button', descriptor.symbol)
        button.type = 'button'
        button.dataset.action = descriptor.action
        button.dataset.baseDisabled = String(descriptor.disabled)
        button.disabled = descriptor.disabled
        button.setAttribute('aria-label', descriptor.label)
        button.title = descriptor.label
        controls.append(button)
      })
      row.append(controls)
      this.modList.append(row)
    }, this)
  }

  ShellView.prototype.renderRecommendedMods = function (result) {
    var doc = this.doc
    var state = result && result.state
    var mods = result && Array.isArray(result.mods) ? result.mods : []
    this.recommendedModList.replaceChildren()

    if (state !== 'ready') {
      var status = createElement(doc, 'div', 'mod-empty')
      var title = state === 'loading' ? '正在读取推荐目录' : '推荐目录读取失败'
      status.append(createElement(doc, 'strong', '', title))
      if (state === 'failed') {
        status.append(createElement(doc, 'span', '', result.message || '无法读取推荐模组清单'))
        var retry = createElement(doc, 'button', 'recommended-mod-retry', '重试')
        retry.type = 'button'
        retry.dataset.action = 'retry-recommended-mods'
        status.append(retry)
      }
      this.recommendedModList.append(status)
      return
    }

    if (!mods.length) {
      var empty = createElement(doc, 'div', 'mod-empty')
      empty.append(createElement(doc, 'strong', '', '暂无推荐模组'))
      empty.append(createElement(doc, 'span', '', '推荐目录已经就绪'))
      this.recommendedModList.append(empty)
      return
    }

    mods.forEach(function (mod) {
      var row = createElement(doc, 'article', 'recommended-mod-item')
      var content = createElement(doc, 'div', 'mod-content')
      var titleLine = createElement(doc, 'div', 'mod-title-line')
      titleLine.append(createElement(doc, 'strong', 'mod-name', mod.name))
      titleLine.append(createElement(doc, 'span', 'mod-badge', 'VERIFIED'))
      content.append(titleLine)
      if (mod.description) content.append(createElement(doc, 'p', 'mod-description', mod.description))
      var metadata = [mod.author, mod.version, mod.size ? formatBytes(mod.size) : ''].filter(Boolean)
      if (metadata.length) content.append(createElement(doc, 'p', 'mod-meta', metadata.join(' · ')))
      row.append(content)

      var download = createElement(doc, 'a', 'recommended-mod-download')
      download.href = mod.downloadUrl
      download.download = mod.fileName
      if (mod.external) {
        download.target = '_blank'
        download.rel = 'noopener noreferrer'
      }
      download.setAttribute('aria-label', '下载 ' + mod.name)
      download.append(createElement(doc, 'span', '', '\u2193'), doc.createTextNode('下载'))
      row.append(download)
      this.recommendedModList.append(row)
    }, this)
  }

  ShellView.prototype.showPlayer = function (file, version, modCount, gameTitle) {
    this.doc.title = gameTitle || 'Devil Connection'
    this.frame.title = gameTitle || 'Devil Connection'
    this.mountedFile.textContent = file.name
    this.mountedVersion.textContent = version || '--'
    this.mountedSize.textContent = formatBytes(file.size)
    this.mountedMods.textContent = modCount + ' 个'
    this.closeMenu(false)
    this.playerView.classList.remove('is-preparing')
    this.loaderView.hidden = true
    this.playerView.hidden = false
  }

  ShellView.prototype.showPreparingPlayer = function () {
    this.closeMenu(false)
    this.playerView.classList.add('is-preparing')
    this.playerView.hidden = false
    this.loaderView.hidden = false
  }

  ShellView.prototype.showManager = function (hasBaseGame) {
    this.doc.title = 'DevilConnection Modloader web'
    this.frame.title = 'Devil Connection'
    this.closeMenu(false)
    this.playerView.classList.remove('is-preparing')
    this.playerView.hidden = true
    this.loaderView.hidden = false
    this.progressRow.hidden = true
    this.setStatus(hasBaseGame ? '核心归档仍然就绪，可以重新开始游戏' : '等待载入核心 ASAR', hasBaseGame ? 'ready' : '')
    this.showPage('launch')
    this.setLaunchReady(false)
    this.loadCoreButton.focus()
  }

  ShellView.prototype.navigate = function (html, onLoad) {
    if (this.pendingFrameLoad) {
      this.frame.removeEventListener('load', this.pendingFrameLoad)
      this.pendingFrameLoad = null
    }
    if (onLoad) {
      var view = this
      var handler = function (event) {
        if (view.pendingFrameLoad !== handler) return
        view.pendingFrameLoad = null
        view.frame.removeEventListener('load', handler)
        onLoad(event)
      }
      this.pendingFrameLoad = handler
      this.frame.addEventListener('load', handler)
    }
    this.frame.srcdoc = html
  }

  ShellView.prototype.chooseCoreFile = function () { this.coreInput.click() }
  ShellView.prototype.chooseModFiles = function () { this.modInput.click() }

  ShellView.prototype.showSourceRestore = function (count) {
    this.restoreSourcesDetail.textContent = '重新授权 ' + count + ' 个已记住的本地归档'
    this.restoreSourcesButton.hidden = false
  }

  ShellView.prototype.hideSourceRestore = function () {
    this.restoreSourcesButton.hidden = true
  }

  ShellView.prototype.resetCoreInput = function () { this.coreInput.value = '' }
  ShellView.prototype.resetModInput = function () { this.modInput.value = '' }

  ShellView.formatBytes = formatBytes
  DCWeb.ShellView = ShellView
})(window)
