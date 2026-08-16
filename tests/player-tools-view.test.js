'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8')
const view = fs.readFileSync(path.join(root, 'js/shell/shell-view.js'), 'utf8')
const controls = fs.readFileSync(path.join(root, 'js/shell/player-runtime-controls.js'), 'utf8')

assert.match(html, /id="player-menu"[\s\S]*?role="dialog"[\s\S]*?class="player-menu-shell"/)
assert.match(html, /id="virtual-keyboard"[\s\S]*?aria-label="虚拟键盘"/)
assert.match(controls, /key\('f1', 'F1'/)
assert.match(controls, /functionIndex\s*<=\s*12/)
assert.match(controls, /key\('keya', 'A'/)
assert.match(controls, /defineKey\('arrowright'/)
assert.match(html, /id="player-console-list"[\s\S]*?role="log"/)
assert.match(html, /id="refresh-player-console"/)
assert.match(html, /id="copy-player-console"/)
assert.match(html, /id="clear-player-console"/)

assert.match(css, /\.player-menu-shell\s*\{[\s\S]*?width:\s*min\(1180px, 100%\)[\s\S]*?height:\s*min\(700px, 100%\)/)
assert.match(css, /\.player-menu-content\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1\.7fr\) minmax\(300px, 1fr\)/)
assert.match(css, /\.virtual-keyboard\s*\{[\s\S]*?overflow-x:\s*auto/)
assert.match(css, /\.virtual-keyboard-layout\s*\{[\s\S]*?width:\s*max-content/)
assert.match(css, /\.player-console-list\s*\{[\s\S]*?overflow:\s*auto/)

const mobileCss = css.slice(css.indexOf('@media (max-width: 640px)'))
assert.match(mobileCss, /\.player-menu-content\s*\{[\s\S]*?display:\s*block[\s\S]*?overflow-y:\s*auto/)
assert.match(view, /addEventListener\('pointerdown'[\s\S]*?handlers\.virtualKeyDown/)
assert.match(view, /event\.pointerType\s*===\s*'touch'[\s\S]*?return/)
assert.match(view, /\['pointerup', 'pointercancel', 'lostpointercapture'\][\s\S]*?handlers\.virtualKeyUp/)
assert.match(view, /ShellView\.prototype\.renderPlayerConsole/)
assert.match(view, /ShellView\.prototype\.renderVirtualKeyboard/)

console.log('Player tools view tests passed')
