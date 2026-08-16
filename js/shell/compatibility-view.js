;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var STATUS_LABELS = {
    applied: '已应用',
    checking: '检查中',
    delegated: '交由运行时',
    failed: '应用失败',
    idle: '等待检查',
    'not-applicable': '无需应用',
    'not-needed': '无需转换',
    pending: '等待检查',
    ready: '兼容就绪',
    unverified: '版本未验证',
    unsupported: '不受支持',
    warning: '有警告，可启动',
  }

  function createElement(doc, tag, className, text) {
    var element = doc.createElement(tag)
    if (className) element.className = className
    if (text !== undefined) element.textContent = text
    return element
  }

  function sourceLabel(patch, context) {
    var sourceLayerId = String(patch.sourceLayerId || '')
    if (sourceLayerId === 'base-game') return '游戏本体'
    var mods = context.mods || []
    var id = sourceLayerId.indexOf('mod:') === 0 ? sourceLayerId.slice(4) : ''
    var mod = mods.find(function (item) { return item.id === id })
    return mod ? '模组：' + mod.name : (sourceLayerId || '尚未解析')
  }

  function CompatibilityView(target, doc) {
    this.target = target
    this.doc = doc
    this.profile = doc.getElementById('compatibility-profile')
    this.version = doc.getElementById('compatibility-version')
    this.count = doc.getElementById('compatibility-count')
    this.status = doc.getElementById('compatibility-status')
    this.list = doc.getElementById('compatibility-list')
    this.exportButton = doc.getElementById('export-compatibility')
  }

  CompatibilityView.prototype.bind = function (handlers) {
    this.exportButton.addEventListener('click', function () { handlers.exportReport() })
  }

  CompatibilityView.prototype.render = function (report, context) {
    var doc = this.doc
    context = context || {}
    this.profile.textContent = report.profileName || report.profileId || '--'
    this.version.textContent = context.gameVersion || '--'
    this.count.textContent = String((report.patches || []).filter(function (patch) { return patch.required }).length)
    this.status.textContent = STATUS_LABELS[report.status] || report.status || STATUS_LABELS.idle
    this.status.dataset.state = report.status || 'idle'
    this.exportButton.disabled = false
    this.list.replaceChildren()

    if (!report.patches || !report.patches.length) {
      var empty = createElement(doc, 'div', 'compatibility-empty')
      empty.append(createElement(doc, 'strong', '', '当前档案没有必要转换'))
      empty.append(createElement(doc, 'span', '', '浏览器壳仍会提供通用运行环境'))
      this.list.append(empty)
      return
    }

    report.patches.forEach(function (patch, index) {
      var row = createElement(doc, 'article', 'compatibility-item')
      row.dataset.state = patch.status
      row.append(createElement(doc, 'span', 'compatibility-order', String(index + 1).padStart(2, '0')))

      var content = createElement(doc, 'div', 'compatibility-content')
      var title = createElement(doc, 'div', 'compatibility-title-line')
      title.append(createElement(doc, 'strong', '', patch.name))
      title.append(createElement(doc, 'span', 'compatibility-required', patch.required ? 'REQUIRED' : 'OPTIONAL'))
      content.append(title)
      if (patch.description) content.append(createElement(doc, 'p', 'compatibility-description', patch.description))

      var target = createElement(doc, 'div', 'compatibility-target')
      target.append(createElement(doc, 'code', '', patch.target))
      target.append(createElement(doc, 'span', '', sourceLabel(patch, context)))
      content.append(target)
      if (patch.message) content.append(createElement(doc, 'p', 'compatibility-message', patch.message))
      row.append(content)

      var badge = createElement(doc, 'span', 'compatibility-state', STATUS_LABELS[patch.status] || patch.status)
      badge.dataset.state = patch.status
      row.append(badge)
      this.list.append(row)
    }, this)
  }

  CompatibilityView.prototype.download = function (fileName, value) {
    var blob = new this.target.Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' })
    var url = this.target.URL.createObjectURL(blob)
    var link = this.doc.createElement('a')
    link.href = url
    link.download = fileName
    this.doc.body.append(link)
    link.click()
    link.remove()
    this.target.setTimeout(function () { global.URL.revokeObjectURL(url) }, 0)
  }

  DCWeb.CompatibilityView = CompatibilityView
})(window)
