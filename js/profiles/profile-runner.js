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
    patch.signatures.forEach(function (signature) {
      if (!signature || typeof signature.text !== 'string' || !signature.text) {
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

      var source
      try {
        source = await resolver.readText(patch.target)
      } catch (error) {
        fail(report, state, 'failed', '无法读取兼容目标：' + patch.target, error)
      }

      var signatures = patch.signatures || []
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

      try {
        var transformed = await patch.transform(source, { patch: patch, resolved: resolved, resolver: resolver })
        if (typeof transformed !== 'string') throw new TypeError('Patch transform did not return text')
        resolver.prepareText(patch.target, transformed, DCWeb.ResourcePath.mimeForPath(patch.target))
        state.status = transformed === source ? 'not-needed' : 'applied'
        state.message = transformed === source ? '当前资源无需转换' : '已应用必要的浏览器兼容转换'
      } catch (error) {
        fail(report, state, 'failed', (patch.name || patch.id) + ' 应用失败：' + (error.message || error), error)
      }
    }

    report.status = 'ready'
    return report
  }

  DCWeb.ProfileRunner = { createReport: createReport, run: run }
})(window)
