;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb

  function clonePatchState(patch) {
    return {
      description: patch.description || '',
      failure: patch.failure,
      id: patch.id,
      message: '',
      name: patch.name || patch.id,
      required: patch.required,
      sourceKind: '',
      sourceLayerId: '',
      status: 'pending',
      target: patch.target,
    }
  }

  function createReport(profile) {
    return {
      compatible: true,
      patches: (profile.patches || []).map(clonePatchState),
      profileId: profile.id,
      profileName: profile.name || profile.id,
      status: 'checking',
    }
  }

  function countMatches(source, signature) {
    return source.split(signature).length - 1
  }

  function bytesOf(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    return null
  }

  function equalBinary(left, right) {
    var leftBytes = bytesOf(left)
    var rightBytes = bytesOf(right)
    if (!leftBytes || !rightBytes || leftBytes.byteLength !== rightBytes.byteLength) return false
    for (var index = 0; index < leftBytes.byteLength; index++) {
      if (leftBytes[index] !== rightBytes[index]) return false
    }
    return true
  }

  var SHA256_CONSTANTS = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]

  function rotateRight(value, bits) {
    return (value >>> bits) | (value << (32 - bits))
  }

  function sha256(buffer) {
    var source = bytesOf(buffer)
    var paddedLength = Math.ceil((source.byteLength + 9) / 64) * 64
    var padded = new Uint8Array(paddedLength)
    padded.set(source)
    padded[source.byteLength] = 0x80
    var bitLength = source.byteLength * 8
    var paddedView = new DataView(padded.buffer)
    paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false)
    paddedView.setUint32(paddedLength - 4, bitLength >>> 0, false)

    var state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
    var words = new Uint32Array(64)
    for (var offset = 0; offset < paddedLength; offset += 64) {
      for (var wordIndex = 0; wordIndex < 16; wordIndex++) words[wordIndex] = paddedView.getUint32(offset + wordIndex * 4, false)
      for (var expanded = 16; expanded < 64; expanded++) {
        var low = words[expanded - 15]
        var high = words[expanded - 2]
        var sigma0 = rotateRight(low, 7) ^ rotateRight(low, 18) ^ (low >>> 3)
        var sigma1 = rotateRight(high, 17) ^ rotateRight(high, 19) ^ (high >>> 10)
        words[expanded] = (words[expanded - 16] + sigma0 + words[expanded - 7] + sigma1) >>> 0
      }

      var a = state[0]
      var b = state[1]
      var c = state[2]
      var d = state[3]
      var e = state[4]
      var f = state[5]
      var g = state[6]
      var h = state[7]
      for (var round = 0; round < 64; round++) {
        var upper1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
        var choice = (e & f) ^ (~e & g)
        var temp1 = (h + upper1 + choice + SHA256_CONSTANTS[round] + words[round]) >>> 0
        var upper0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
        var majority = (a & b) ^ (a & c) ^ (b & c)
        var temp2 = (upper0 + majority) >>> 0
        h = g
        g = f
        f = e
        e = (d + temp1) >>> 0
        d = c
        c = b
        b = a
        a = (temp1 + temp2) >>> 0
      }
      state[0] = (state[0] + a) >>> 0
      state[1] = (state[1] + b) >>> 0
      state[2] = (state[2] + c) >>> 0
      state[3] = (state[3] + d) >>> 0
      state[4] = (state[4] + e) >>> 0
      state[5] = (state[5] + f) >>> 0
      state[6] = (state[6] + g) >>> 0
      state[7] = (state[7] + h) >>> 0
    }
    return state.map(function (value) { return value.toString(16).padStart(8, '0') }).join('')
  }

  function fail(report, state, status, message, cause) {
    state.status = status
    state.message = message
    report.compatible = false
    report.status = 'failed'
    var error = new Error(message)
    error.name = 'ProfileCompatibilityError'
    error.compatibility = report
    error.patchId = state.id
    if (cause) error.cause = cause
    throw error
  }

  function validatePatch(patch) {
    if (!patch || typeof patch.id !== 'string' || !patch.id) throw new TypeError('Profile patch requires an id')
    if (typeof patch.target !== 'string' || !patch.target) throw new TypeError('Profile patch ' + patch.id + ' requires a target')
    if (patch.required !== true) throw new TypeError('Profile patch ' + patch.id + ' must be declared as required')
    if (patch.failure !== 'abort-session') throw new TypeError('Profile patch ' + patch.id + ' must abort the session on failure')
    if (!Array.isArray(patch.signatures) || !patch.signatures.length) throw new TypeError('Profile patch ' + patch.id + ' requires strict source signatures')
    var format = patch.format || 'text'
    if (format !== 'text' && format !== 'binary') throw new TypeError('Profile patch ' + patch.id + ' has an invalid format')
    if (format === 'binary' && (!Number.isInteger(patch.maxBytes) || patch.maxBytes <= 0)) {
      throw new TypeError('Binary profile patch ' + patch.id + ' requires a positive maxBytes')
    }
    patch.signatures.forEach(function (signature) {
      if (!signature) throw new TypeError('Profile patch ' + patch.id + ' has an invalid source signature')
      if (format === 'binary') {
        var hasSize = Number.isInteger(signature.size) && signature.size >= 0
        var hasDigest = typeof signature.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(signature.sha256)
        if (hasSize === hasDigest) throw new TypeError('Binary profile patch ' + patch.id + ' signatures require exactly one size or sha256')
        return
      }
      if (typeof signature.text !== 'string' || !signature.text) {
        throw new TypeError('Profile patch ' + patch.id + ' has an invalid source signature')
      }
      if (!Number.isInteger(signature.count) || signature.count < 0) {
        throw new TypeError('Profile patch ' + patch.id + ' has an invalid expected signature count')
      }
    })
    if (typeof patch.transform !== 'function') throw new TypeError('Profile patch ' + patch.id + ' requires a transform function')
  }

  async function run(profile, resolver) {
    if (!profile || !profile.id) throw new TypeError('ProfileRunner requires a game profile')
    if (!resolver) throw new TypeError('ProfileRunner requires an asset resolver')

    var patches = profile.patches || []
    var report = createReport(profile)
    var patchIds = Object.create(null)
    for (var index = 0; index < patches.length; index++) {
      var patch = patches[index]
      var state = report.patches[index]
      validatePatch(patch)
      if (patchIds[patch.id]) throw new TypeError('Duplicate profile patch id: ' + patch.id)
      patchIds[patch.id] = true

      var resolved = resolver.resolve(patch.target)
      if (!resolved) {
        fail(report, state, 'failed', '缺少必要兼容目标：' + patch.target)
      }
      state.sourceKind = resolved.kind || ''
      state.sourceLayerId = resolved.layerId || ''

      var format = patch.format || 'text'
      var source
      try {
        if (format === 'binary') {
          var blob = resolver.getBlob(patch.target)
          if (!blob || typeof blob.arrayBuffer !== 'function') throw new Error('Binary target is unavailable')
          if (blob.size > patch.maxBytes) {
            fail(report, state, 'unsupported', (patch.name || patch.id) + ' 超过补丁读取上限：' + blob.size + ' > ' + patch.maxBytes)
          }
          source = await blob.arrayBuffer()
        } else source = await resolver.readText(patch.target)
      } catch (error) {
        if (error && error.name === 'ProfileCompatibilityError') throw error
        fail(report, state, 'failed', '无法读取兼容目标：' + patch.target, error)
      }

      var signatures = patch.signatures || []
      if (format === 'binary') {
        var digest = ''
        for (var binaryIndex = 0; binaryIndex < signatures.length; binaryIndex++) {
          var binaryRule = signatures[binaryIndex]
          if (binaryRule.size !== undefined && source.byteLength !== binaryRule.size) {
            fail(report, state, 'unsupported', (binaryRule.name || patch.name || patch.id) + ' 的大小不受支持：预期 ' + binaryRule.size + ' 字节，实际 ' + source.byteLength + ' 字节')
          }
          if (binaryRule.sha256) {
            digest = digest || sha256(source)
            if (digest !== binaryRule.sha256.toLowerCase()) {
              fail(report, state, 'unsupported', (binaryRule.name || patch.name || patch.id) + ' 的 SHA-256 不受支持')
            }
          }
        }
      } else {
        for (var signatureIndex = 0; signatureIndex < signatures.length; signatureIndex++) {
          var rule = signatures[signatureIndex]
          var actual = countMatches(source, rule.text)
          if (actual !== rule.count) {
            fail(
              report,
              state,
              'unsupported',
              (rule.name || patch.name || patch.id) + ' 的源码特征不受支持：预期 ' + rule.count + ' 处，实际 ' + actual + ' 处',
            )
          }
        }
      }

      try {
        var transformed = await patch.transform(source, { patch: patch, resolved: resolved, resolver: resolver })
        var unchanged
        if (format === 'binary') {
          if (!bytesOf(transformed)) throw new TypeError('Binary patch transform did not return an ArrayBuffer or typed array')
          unchanged = equalBinary(source, transformed)
          resolver.prepareBinary(patch.target, transformed, DCWeb.ResourcePath.mimeForPath(patch.target))
        } else {
          if (typeof transformed !== 'string') throw new TypeError('Patch transform did not return text')
          unchanged = transformed === source
          resolver.prepareText(patch.target, transformed, DCWeb.ResourcePath.mimeForPath(patch.target))
        }
        state.status = unchanged ? 'not-needed' : 'applied'
        state.message = unchanged ? '当前资源无需转换' : '已应用必要的浏览器兼容转换'
      } catch (error) {
        fail(report, state, 'failed', (patch.name || patch.id) + ' 应用失败：' + (error.message || error), error)
      }
    }

    report.status = 'ready'
    return report
  }

  DCWeb.ProfileRunner = { createReport: createReport, run: run }
})(window)
