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

  function ShellView(doc) {
    this.input = doc.getElementById('asar-input')
    this.dropButton = doc.getElementById('file-drop')
    this.loaderView = doc.getElementById('loader-view')
    this.playerView = doc.getElementById('player-view')
    this.frame = doc.getElementById('game-frame')
    this.statusCopy = doc.getElementById('mount-status')
    this.progressRow = doc.getElementById('progress-row')
    this.progressFill = doc.getElementById('progress-fill')
    this.progressLabel = doc.getElementById('progress-label')
    this.errorDetails = doc.getElementById('error-details')
    this.errorOutput = doc.getElementById('error-output')
    this.menu = doc.getElementById('player-menu')
    this.menuButton = doc.getElementById('open-player-menu')
    this.menuCloseButton = doc.getElementById('close-player-menu')
    this.mountedFile = doc.getElementById('mounted-file')
    this.mountedSize = doc.getElementById('mounted-size')
    this.mountedVersion = doc.getElementById('mounted-version')
    this.closeButton = doc.getElementById('close-game')
    this.reloadButton = doc.getElementById('reload-game')
    this.menuReturnFocus = null
  }

  ShellView.prototype.bind = function (handlers) {
    var view = this
    this.dropButton.addEventListener('click', function () { if (!handlers.isBusy()) view.input.click() })
    this.input.addEventListener('change', function () { handlers.mount(view.input.files && view.input.files[0]) })
    ;['dragenter', 'dragover'].forEach(function (type) {
      view.dropButton.addEventListener(type, function (event) {
        event.preventDefault()
        if (!handlers.isBusy()) view.dropButton.classList.add('is-dragging')
      })
    })
    ;['dragleave', 'drop'].forEach(function (type) {
      view.dropButton.addEventListener(type, function (event) {
        event.preventDefault()
        view.dropButton.classList.remove('is-dragging')
      })
    })
    this.dropButton.addEventListener('drop', function (event) {
      if (!handlers.isBusy()) handlers.mount(event.dataTransfer.files && event.dataTransfer.files[0])
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

  ShellView.prototype.setBusy = function (value) {
    this.dropButton.disabled = value
    this.input.disabled = value
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
  ShellView.prototype.showPlayer = function (file, version) {
    this.mountedFile.textContent = file.name
    this.mountedVersion.textContent = version || '--'
    this.mountedSize.textContent = formatBytes(file.size)
    this.closeMenu(false)
    this.loaderView.hidden = true
    this.playerView.hidden = false
  }
  ShellView.prototype.showLoader = function () {
    this.closeMenu(false)
    this.playerView.hidden = true
    this.loaderView.hidden = false
    this.progressRow.hidden = true
    this.setStatus('等待选择 app.asar')
    this.dropButton.focus()
  }
  ShellView.prototype.navigate = function (html, onLoad) {
    if (onLoad) this.frame.addEventListener('load', onLoad, { once: true })
    this.frame.srcdoc = html
  }
  ShellView.prototype.resetInput = function () { this.input.value = '' }

  ShellView.formatBytes = formatBytes
  DCWeb.ShellView = ShellView
})(window)
