;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var Path = DCWeb.ResourcePath
  var EMPTY_STYLE_URL = 'data:text/css;charset=utf-8,'

  function StyleProcessor(resolver) {
    this.resolver = resolver
    this.templates = new Map()
  }

  StyleProcessor.prototype.rewrite = function (cssText, cssPath, ancestors) {
    var processor = this
    var resolver = this.resolver
    ancestors = ancestors || new Set()

    function replacementFor(raw) {
      var resolved = Path.resolveCss(cssPath, raw)
      if (!resolved || !resolver.has(resolved)) return raw
      var canonical = resolver.findPath(raw, cssPath)
      if (Path.extensionOf(canonical) === '.css') {
        if (ancestors.has(canonical)) return EMPTY_STYLE_URL
        processor.materialize(canonical, ancestors)
      }
      return resolver.getObjectUrl(raw, cssPath)
    }

    var rewritten = cssText.replace(/@import\s+(['"])([^'"\n]+)\1/gi, function (match, quote, raw) {
      var replacement = replacementFor(raw)
      return replacement === raw ? match : '@import "' + replacement + '"'
    })
    return rewritten.replace(/url\(\s*(['"]?)([^)'"\n]+)\1\s*\)/gi, function (match, quote, raw) {
      var replacement = replacementFor(raw)
      return replacement === raw ? match : 'url("' + replacement + '")'
    })
  }

  StyleProcessor.prototype.hasTemplate = function (path) {
    return this.templates.has(path)
  }

  StyleProcessor.prototype.materialize = function (path, ancestors) {
    var template = this.templates.get(path)
    if (!template || template.materialized) return
    ancestors = ancestors || new Set()
    if (ancestors.has(path)) return

    var nextAncestors = new Set(ancestors)
    nextAncestors.add(path)
    template.materializing = true
    try {
      this.resolver.prepareText(
        path,
        this.rewrite(template.text, path, nextAncestors),
        Path.mimeForPath(path)
      )
      template.materialized = true
    } finally {
      template.materializing = false
    }
  }

  StyleProcessor.prototype.prepareAll = async function (onProgress) {
    var resolver = this.resolver
    var paths = resolver.list('.css')
    this.templates.clear()
    for (var index = 0; index < paths.length; index++) {
      var path = paths[index]
      this.templates.set(path, {
        text: await resolver.readText(path),
        materialized: false,
        materializing: false,
      })
      if (onProgress) onProgress(index + 1, paths.length, path)
      if ((index + 1) % 4 === 0) await new Promise(function (resolve) { setTimeout(resolve, 0) })
    }
    return resolver
  }

  StyleProcessor.prototype.release = function () {
    this.templates.clear()
  }

  DCWeb.StyleProcessor = StyleProcessor
})(window)
