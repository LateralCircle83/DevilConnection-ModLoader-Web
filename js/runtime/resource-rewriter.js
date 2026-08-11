;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb

  function makeResolver(vfs) {
    return function resolve(value, basePath) {
      if (typeof value !== 'string') return value
      return vfs.has(value, basePath) ? vfs.getObjectUrl(value, basePath) : value
    }
  }

  function rewriteCssValue(value, resolve) {
    if (typeof value !== 'string' || !/(?:url\(|@import)/i.test(value)) return value
    var output = value.replace(/@import\s+(['"])([^'"\n]+)\1/gi, function (match, quote, path) {
      var replacement = resolve(path)
      return replacement === path ? match : '@import "' + replacement + '"'
    })
    return output.replace(/url\(\s*(['"]?)([^)'"\n]+)\1\s*\)/gi, function (match, quote, path) {
      var cleanPath = path.trim()
      var replacement = resolve(cleanPath)
      return replacement === cleanPath ? match : 'url("' + replacement + '")'
    })
  }

  function rewriteSrcset(value, resolve) {
    if (typeof value !== 'string') return value
    var output = ''
    var index = 0
    function isSpace(character) {
      return character === ' ' || character === '\t' || character === '\n' || character === '\f' || character === '\r'
    }

    while (index < value.length) {
      var leadingStart = index
      while (index < value.length && (isSpace(value.charAt(index)) || value.charAt(index) === ',')) index++
      output += value.slice(leadingStart, index)
      if (index >= value.length) break

      var urlStart = index
      while (index < value.length && !isSpace(value.charAt(index))) index++
      var url = value.slice(urlStart, index)
      var trailingCommas = ''
      while (url.charAt(url.length - 1) === ',') {
        trailingCommas = ',' + trailingCommas
        url = url.slice(0, -1)
      }
      output += resolve(url) + trailingCommas
      if (trailingCommas) continue

      var descriptorStart = index
      var parentheses = 0
      while (index < value.length) {
        var character = value.charAt(index)
        if (character === '(') parentheses++
        else if (character === ')' && parentheses) parentheses--
        index++
        if (character === ',' && parentheses === 0) break
      }
      output += value.slice(descriptorStart, index)
    }
    return output
  }

  function rewriteMarkup(value, resolve) {
    if (typeof value !== 'string') return value
    var output = value.replace(/\b(src|poster|srcset)\s*=\s*(['"])(.*?)\2/gi, function (match, name, quote, path) {
      var replacement = name.toLowerCase() === 'srcset' ? rewriteSrcset(path, resolve) : resolve(path)
      return name + '=' + quote + replacement + quote
    })
    return rewriteCssValue(output, resolve)
  }

  DCWeb.ResourceRewriter = {
    makeResolver: makeResolver,
    rewriteCssValue: rewriteCssValue,
    rewriteMarkup: rewriteMarkup,
    rewriteSrcset: rewriteSrcset,
  }
})(window)
