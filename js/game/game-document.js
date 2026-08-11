;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb

  function inlineScript(doc, source) {
    var script = doc.createElement('script')
    script.textContent = source
    return script
  }

  function rewriteStaticElement(resolver, element, attribute) {
    var value = element.getAttribute(attribute)
    if (value && resolver.has(value)) element.setAttribute(attribute, resolver.getObjectUrl(value))
  }

  async function build(resolver) {
    var source = await resolver.readText('index.html')
    var doc = new DOMParser().parseFromString(source, 'text/html')
    if (!doc.documentElement || doc.querySelector('parsererror')) throw new Error('游戏 index.html 无法解析')

    var bootstrap = inlineScript(doc, [
      ';(function () {',
      '  var vfs = parent.__dcActiveResolver || parent.__dcActiveArchive',
      '  if (!vfs) throw new Error("ASAR mount is not available")',
      '  parent.DCWeb.Runtime.install(window, vfs)',
      '  parent.DCWeb.Compat.installBrowserApi(window, vfs)',
      '  window.addEventListener("error", function (event) {',
      '    parent.postMessage({ type: "dc-player-error", message: event.message, stack: event.error && event.error.stack }, "*")',
      '  })',
      '})()',
    ].join('\n'))
    doc.head.insertBefore(bootstrap, doc.head.firstChild)

    Array.prototype.slice.call(doc.querySelectorAll('script[src]')).forEach(function (script) {
      var sourcePath = script.getAttribute('src') || ''
      var normalized = DCWeb.ResourcePath.normalize(sourcePath)
      if (normalized === 'electron_latest.js') {
        script.removeAttribute('src')
        script.textContent = 'parent.DCWeb.Compat.installTyranoCompat(window, window.__ASAR_VFS__)'
        return
      }
      if (resolver.has(sourcePath)) script.setAttribute('src', resolver.getObjectUrl(sourcePath))
      if (normalized === 'tyrano/libs/jquery-3.6.0.min.js') {
        script.parentNode.insertBefore(inlineScript(doc, 'parent.DCWeb.Runtime.installJQuery(window)'), script.nextSibling)
      }
    })

    Array.prototype.slice.call(doc.querySelectorAll('link[href]')).forEach(function (element) {
      rewriteStaticElement(resolver, element, 'href')
    })
    Array.prototype.slice.call(doc.querySelectorAll('img[src],audio[src],video[src],source[src]')).forEach(function (element) {
      rewriteStaticElement(resolver, element, 'src')
    })
    Array.prototype.slice.call(doc.querySelectorAll('video[poster]')).forEach(function (element) {
      rewriteStaticElement(resolver, element, 'poster')
    })

    doc.documentElement.setAttribute('data-dc-asar-player', 'true')
    return '<!doctype html>\n' + doc.documentElement.outerHTML
  }

  DCWeb.GameDocument = { build: build }
})(window)
