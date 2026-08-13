;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb

  function notify(options, phase, detail) {
    if (typeof options.onPhase === 'function') options.onPhase(phase, detail || null)
  }

  async function prepare(options) {
    options = options || {}
    if (!options.baseGame || !options.baseGame.archive) throw new TypeError('SessionPreparer requires a base game archive')
    if (!options.profile) throw new TypeError('SessionPreparer requires a game profile')

    var resolver = null
    try {
      notify(options, 'mods')
      var modPlan = await DCWeb.ModPlan.create(options.mods || [])
      var layers = [{ id: 'base-game', kind: 'base', source: options.baseGame.archive }].concat(modPlan.layers)
      var vfs = new DCWeb.LayeredVfs(layers)
      resolver = new DCWeb.AssetResolver(vfs)

      notify(options, 'profile')
      var compatibility = await DCWeb.ProfileRunner.run(options.profile, resolver)
      notify(options, 'profile-ready', compatibility)

      notify(options, 'styles')
      await resolver.prepareStyles(options.onStyleProgress)

      notify(options, 'entry')
      var gameTitle = options.profile.readTitle ? await options.profile.readTitle(resolver) : ''
      var html = await DCWeb.GameDocument.build(resolver)
      var result = {
        compatibility: compatibility,
        gameTitle: gameTitle,
        html: html,
        modPlan: modPlan,
        resolver: resolver,
        vfs: vfs,
      }
      resolver = null
      return result
    } finally {
      if (resolver) resolver.release()
    }
  }

  DCWeb.SessionPreparer = { prepare: prepare }
})(window)
