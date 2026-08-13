;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb

  function safeHref(value) {
    var href = String(value || '').trim()
    if (!href || /^(?:javascript|data|blob):/i.test(href)) return ''
    return href
  }

  function appendInline(doc, parent, source) {
    var pattern = /(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g
    var cursor = 0
    var match
    while ((match = pattern.exec(source))) {
      if (match.index > cursor) parent.append(doc.createTextNode(source.slice(cursor, match.index)))
      var token = match[0]
      if (token[0] === '`') {
        var code = doc.createElement('code')
        code.textContent = token.slice(1, -1)
        parent.append(code)
      } else if (token.indexOf('**') === 0) {
        var strong = doc.createElement('strong')
        strong.textContent = token.slice(2, -2)
        parent.append(strong)
      } else {
        var linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
        var href = linkMatch && safeHref(linkMatch[2])
        if (!href) parent.append(doc.createTextNode(linkMatch ? linkMatch[1] : token))
        else {
          var link = doc.createElement('a')
          link.textContent = linkMatch[1]
          link.href = href
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          parent.append(link)
        }
      }
      cursor = pattern.lastIndex
    }
    if (cursor < source.length) parent.append(doc.createTextNode(source.slice(cursor)))
  }

  function isBlockStart(line) {
    return /^#{1,3}\s+/.test(line) || /^```/.test(line) || /^-\s+/.test(line) || /^\d+\.\s+/.test(line)
  }

  function renderMarkdown(doc, container, source) {
    var lines = String(source || '').replace(/\r\n?/g, '\n').split('\n')
    var fragment = doc.createDocumentFragment()
    var index = 0
    while (index < lines.length) {
      var line = lines[index]
      if (!line.trim()) { index++; continue }

      var heading = line.match(/^(#{1,3})\s+(.*)$/)
      if (heading) {
        var title = doc.createElement('h' + heading[1].length)
        appendInline(doc, title, heading[2])
        fragment.append(title)
        index++
        continue
      }

      if (/^```/.test(line)) {
        var language = line.slice(3).trim()
        var codeLines = []
        index++
        while (index < lines.length && !/^```/.test(lines[index])) codeLines.push(lines[index++])
        if (index < lines.length) index++
        var pre = doc.createElement('pre')
        var codeBlock = doc.createElement('code')
        if (language) codeBlock.dataset.language = language
        codeBlock.textContent = codeLines.join('\n')
        pre.append(codeBlock)
        fragment.append(pre)
        continue
      }

      var listMatch = line.match(/^(-|\d+\.)\s+(.*)$/)
      if (listMatch) {
        var ordered = listMatch[1] !== '-'
        var list = doc.createElement(ordered ? 'ol' : 'ul')
        while (index < lines.length) {
          var itemMatch = lines[index].match(ordered ? /^\d+\.\s+(.*)$/ : /^-\s+(.*)$/)
          if (!itemMatch) break
          var item = doc.createElement('li')
          appendInline(doc, item, itemMatch[1])
          list.append(item)
          index++
        }
        fragment.append(list)
        continue
      }

      var paragraphLines = [line.trim()]
      index++
      while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
        paragraphLines.push(lines[index].trim())
        index++
      }
      var paragraph = doc.createElement('p')
      appendInline(doc, paragraph, paragraphLines.join(' '))
      fragment.append(paragraph)
    }
    container.replaceChildren(fragment)
  }

  function ReadmeView(target, container) {
    this.target = target
    this.container = container
    this.loading = null
  }

  ReadmeView.prototype.load = function () {
    if (this.loading) return this.loading
    var view = this
    this.container.dataset.state = 'loading'
    this.loading = this.target.fetch('./README.md', { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('README.md 加载失败：HTTP ' + response.status)
      return response.text()
    }).then(function (source) {
      renderMarkdown(view.container.ownerDocument, view.container, source)
      view.container.dataset.state = 'ready'
    }).catch(function (error) {
      view.container.dataset.state = 'error'
      view.container.textContent = error && error.message ? error.message : String(error)
    }).finally(function () { view.loading = null })
    return this.loading
  }

  DCWeb.ReadmeView = ReadmeView
  DCWeb.ReadmeView.renderMarkdown = renderMarkdown
})(window)
