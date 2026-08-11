;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var Path = DCWeb.ResourcePath

  function StyleProcessor(resolver) {
    this.resolver = resolver
  }

  StyleProcessor.prototype.rewrite = function (cssText, cssPath) {
    var resolver = this.resolver
    var rewritten = cssText.replace(/@import\s+(['"])([^'"\n]+)\1/gi, function (match, quote, raw) {
      var resolved = Path.resolveCss(cssPath, raw)
      if (!resolved || !resolver.has(resolved)) return match
      return '@import "' + resolver.getObjectUrl(raw, cssPath) + '"'
    })
    return rewritten.replace(/url\(\s*(['"]?)([^)'"\n]+)\1\s*\)/gi, function (match, quote, raw) {
      var resolved = Path.resolveCss(cssPath, raw)
      if (!resolved || !resolver.has(resolved)) return match
      return 'url("' + resolver.getObjectUrl(raw, cssPath) + '")'
    })
  }

  StyleProcessor.prototype.findDependencies = function (cssText, cssPath) {
    var resolver = this.resolver
    var dependencies = new Set()
    function add(raw) {
      var resolved = Path.resolveCss(cssPath, raw)
      if (!resolved) return
      var canonical = resolver.findPath(raw, cssPath)
      if (Path.extensionOf(canonical) === '.css') dependencies.add(canonical)
    }
    cssText.replace(/@import\s+(['"])([^'"\n]+)\1/gi, function (match, quote, raw) { add(raw); return match })
    cssText.replace(/url\(\s*(['"]?)([^)'"\n]+)\1\s*\)/gi, function (match, quote, raw) { add(raw); return match })
    return Array.from(dependencies)
  }

  StyleProcessor.prototype.prepareAll = async function (onProgress) {
    var processor = this
    var resolver = this.resolver
    var paths = resolver.list('.css')
    var preparedCount = 0

    async function prepare(path, ancestors) {
      if (resolver.hasPrepared(path) || ancestors.has(path)) return
      var nextAncestors = new Set(ancestors)
      nextAncestors.add(path)
      var css = await resolver.readText(path)
      var dependencies = processor.findDependencies(css, path)
      for (var index = 0; index < dependencies.length; index++) {
        await prepare(dependencies[index], nextAncestors)
      }
      resolver.prepareText(path, processor.rewrite(css, path), Path.mimeForPath(path))
      preparedCount++
      if (onProgress) onProgress(preparedCount, paths.length, path)
      if (preparedCount % 4 === 0) await new Promise(function (resolve) { setTimeout(resolve, 0) })
    }

    for (var index = 0; index < paths.length; index++) await prepare(paths[index], new Set())
    return resolver
  }

  DCWeb.StyleProcessor = StyleProcessor
})(window)
