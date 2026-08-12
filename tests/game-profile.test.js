'use strict'

const assert = require('node:assert/strict')

global.window = {}
require('../js/core/namespace.js')
require('../js/core/resource-path.js')
require('../js/game/devil-connection-profile.js')

const profile = window.DCWeb.DevilConnectionProfile

assert.equal(
  profile.parseGameTitle(';System.title=恶魔连结 - 简体中文 Ver1.01'),
  '恶魔连结 - 简体中文 Ver1.01',
)
assert.equal(profile.parseGameTitle('System.title="Devil Connection"'), 'Devil Connection')
assert.equal(profile.parseGameTitle("System.title='Devil Connection Web'"), 'Devil Connection Web')
assert.equal(profile.parseGameTitle(';projectID=DevilConnection'), '')

profile.readTitle({
  readText(path) {
    assert.equal(path, 'data/system/Config.tjs')
    return Promise.resolve(';System.title=Loaded from VFS')
  },
}).then(function (title) {
  assert.equal(title, 'Loaded from VFS')
  console.log('Game profile tests passed')
}).catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
