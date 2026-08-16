;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var MENU_SIGNATURE = 'TYRANO.kag.ftag.master_tag.collection_menu = {'
  var CONTAINER_SIGNATURE = '`<div id="collection_menu" class="${name}" tabindex="-1">`'
  var CREATE_SIGNATURE = "    ).css('opacity', 0)"
  var APPEND_SIGNATURE = '    freeLayer.append(collectionMenu)'
  var PATCH_MARKER = 'function dcCollectionScroll'

  function transform(source) {
    var newline = source.indexOf('\r\n') !== -1 ? '\r\n' : '\n'
    var scrollBoundary = [
      CREATE_SIGNATURE,
      '    collectionMenu.get(0).addEventListener(',
      "      'touchmove',",
      '      ' + PATCH_MARKER + '(event) { event.stopPropagation() },',
      '      { passive: true }',
      '    )',
    ].join(newline)
    return source.replace(CREATE_SIGNATURE, scrollBoundary)
  }

  DCWeb.DevilConnectionCollectionScrollPatch = {
    description: '允许移动端角色与结局收藏列表原生纵向滚动，同时保留 Tyrano 的全局页面手势限制。',
    failure: 'warn-and-continue',
    id: 'devil-connection-collection-mobile-scroll',
    name: '收藏列表移动端滚动兼容',
    required: true,
    signatures: [
      { count: 1, name: '收藏菜单标签', text: MENU_SIGNATURE },
      { count: 1, name: '收藏菜单容器', text: CONTAINER_SIGNATURE },
      { count: 1, name: '收藏菜单创建', text: CREATE_SIGNATURE },
      { count: 1, name: '收藏菜单挂载', text: APPEND_SIGNATURE },
      { count: 0, name: '收藏滚动补丁标记', text: PATCH_MARKER },
    ],
    target: 'data/others/plugin/collection_menu/main.js',
    transform: transform,
  }
})(window)
