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
    this.modInput = doc.getElementById('mod-asar-input')
    this.addModsButton = doc.getElementById('add-mods')
    this.modList = doc.getElementById('mod-list')
    this.configDialog = doc.getElementById('mod-config-dialog')
    this.configForm = doc.getElementById('mod-config-form')
    this.configTitle = doc.getElementById('mod-config-title')
    this.configDescription = doc.getElementById('mod-config-description')
    this.configFields = doc.getElementById('mod-config-fields')
    this.configError = doc.getElementById('mod-config-error')
    this.configCloseButton = doc.getElementById('close-mod-config')
    this.configCancelButton = doc.getElementById('cancel-mod-config')
    this.tabs = Array.prototype.slice.call(doc.querySelectorAll('.manager-tab'))
    this.pages = Array.prototype.slice.call(doc.querySelectorAll('.manager-page'))
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
    this.menu = doc.getElementById('player-menu')
    this.menuButton = doc.getElementById('open-player-menu')
    this.menuCloseButton = doc.getElementById('close-player-menu')
    this.mountedFile = doc.getElementById('mounted-file')
    this.mountedSize = doc.getElementById('mounted-size')
    this.mountedVersion = doc.getElementById('mounted-version')
    this.mountedMods = doc.getElementById('mounted-mods')
    this.closeButton = doc.getElementById('close-game')
    this.reloadButton = doc.getElementById('reload-game')
    this.launchReady = false
    this.busy = false
    this.menuReturnFocus = null
    this.configReturnFocus = null
    this.configModId = ''
  }

  ShellView.prototype.bind = function (handlers) {
    var view = this
    this.loadCoreButton.addEventListener('click', function () {
      if (!handlers.isBusy()) view.coreInput.click()
    })
    this.coreInput.addEventListener('change', function () {
      handlers.loadCore(view.coreInput.files && view.coreInput.files[0])
    })
    this.startButton.addEventListener('click', function () { handlers.start() })
    this.addModsButton.addEventListener('click', function () {
      if (!handlers.isBusy()) view.modInput.click()
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

    this.menuButton.addEventListener('click', function () { view.openMenu() })
    this.menuCloseButton.addEventListener('click', function () { view.closeMenu() })
    this.menu.addEventListener('click', function (event) {
      if (event.target === view.menu) view.closeMenu()
    })
    this.closeButton.addEventListener('click', function () {
      view.closeMenu(false)
      handlers.close()
    })
    this.reloadButton.addEventListener('click', function () {
      view.closeMenu()
      handlers.reload()
    })
    this.menu.ownerDocument.addEventListener('keydown', function (event) {
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
        view.closeMenu()
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

  ShellView.prototype.showPage = function (pageName) {
    this.tabs.forEach(function (tab) {
      var active = tab.dataset.page === pageName
      tab.classList.toggle('is-active', active)
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
    })
    this.pages.forEach(function (page) { page.hidden = page.dataset.page !== pageName })
  }

  ShellView.prototype.setBusy = function (value) {
    this.busy = value
    this.loadCoreButton.disabled = value
    this.coreInput.disabled = value
    this.addModsButton.disabled = value
    this.modInput.disabled = value
    this.startButton.disabled = value || !this.launchReady
    this.tabs.forEach(function (tab) { tab.disabled = value })
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

  ShellView.prototype.showPlayer = function (file, version, modCount) {
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
    if (onLoad) this.frame.addEventListener('load', onLoad, { once: true })
    this.frame.srcdoc = html
  }

  ShellView.prototype.resetCoreInput = function () { this.coreInput.value = '' }
  ShellView.prototype.resetModInput = function () { this.modInput.value = '' }

  ShellView.formatBytes = formatBytes
  DCWeb.ShellView = ShellView
})(window)
