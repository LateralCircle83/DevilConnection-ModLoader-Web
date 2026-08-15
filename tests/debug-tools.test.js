'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8')

assert.match(html, /id="manager-tab-debug"[\s\S]*?aria-controls="manager-page-debug"[\s\S]*?data-page="debug"/)
assert.match(html, /id="manager-page-debug"[\s\S]*?aria-labelledby="manager-tab-debug"[\s\S]*?data-page="debug"/)

const mediaLink = html.match(/<a\s+[\s\S]*?id="open-media-compatibility"[\s\S]*?>/)
assert.ok(mediaLink, 'media compatibility tool link should exist')
assert.match(mediaLink[0], /href="\.\/tools\/media-compatibility\.html"/)
assert.match(mediaLink[0], /target="_blank"/)
assert.match(mediaLink[0], /rel="noopener"/)

const mobileCss = css.slice(css.indexOf('@media (max-width: 640px)'))
assert.match(mobileCss, /\.manager-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/)
assert.match(mobileCss, /\.debug-tool-item\s*\{[\s\S]*?grid-template-columns:\s*30px minmax\(0, 1fr\)/)
assert.match(mobileCss, /\.debug-tool-open\s*\{[\s\S]*?grid-column:\s*2/)

console.log('Debug tools page tests passed')
