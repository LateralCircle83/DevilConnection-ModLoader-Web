;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var MARKER = 'var dc_movie_finished'

  var START_SOURCE_LINES = [
    "    if ('pc' != $.userenv()) {",
    '      this.kag.layer.showEventLayer()',
    '      if ($.isTyranoPlayer()) this.playVideo(pm)',
    '      else {',
    '        this.kag.layer.showEventLayer()',
    '        this.playVideo(pm)',
    "        $('.tyrano_base').unbind('click.movie')",
    '      }',
    '    } else {',
  ]

  var START_GUARD_LINES = [
    "    if ('pc' != $.userenv()) {",
    "      if ('true' != pm.bgmode) {",
    '        this.kag.layer.hideEventLayer()',
    '      } else this.kag.layer.showEventLayer()',
    '      if ($.isTyranoPlayer()) this.playVideo(pm)',
    '      else {',
    "        if ('true' != pm.bgmode) {",
    '          this.kag.layer.hideEventLayer()',
    '        } else this.kag.layer.showEventLayer()',
    '        this.playVideo(pm)',
    "        $('.tyrano_base').unbind('click.movie')",
    '      }',
    '    } else {',
  ]

  var FINISH_SOURCE_LINES = [
    '    } else {',
    '      video.style.zIndex = 199999',
    "      video.addEventListener('ended', function (e) {",
    "        $('.tyrano_base').find(`#${videoId}`).remove()",
    "        if ('false' == pm.bgmode && 'false' == pm.skip) {",
    "          $('.layer_event_click').css('display', '')",
    '        }',
    '        that.kag.ftag.nextOrder()',
    '      })',
    "      'true' == pm.skip &&",
    "        $(video).on('click touchstart', function (e) {",
    "          $(video).off('click touchstart')",
    "          $('.tyrano_base').find(`#${videoId}`).remove()",
    '          that.kag.ftag.nextOrder()',
    '        })',
    '    }',
  ]

  var FINISH_GUARD_LINES = [
    '    } else {',
    '      video.style.zIndex = 199999',
    '      ' + MARKER + ' = false',
    '      function dc_finish_movie() {',
    '        if (dc_movie_finished) return',
    '        dc_movie_finished = true',
    "        $('.tyrano_base').find(`#${videoId}`).remove()",
    "        $('.layer_event_click').css('display', '')",
    '        that.kag.layer.showEventLayer()',
    '        that.kag.ftag.nextOrder()',
    '      }',
    "      video.addEventListener('ended', function (e) {",
    '        dc_finish_movie()',
    '      })',
    "      'true' == pm.skip &&",
    "        $(video).on('click touchstart', function (e) {",
    "          $(video).off('click touchstart')",
    '          dc_finish_movie()',
    '        })',
    '    }',
  ]

  function transform(source) {
    var newline = source.indexOf('\r\n') !== -1 ? '\r\n' : '\n'
    var startSource = START_SOURCE_LINES.join(newline)
    var startGuard = START_GUARD_LINES.join(newline)
    var finishSource = FINISH_SOURCE_LINES.join(newline)
    var finishGuard = FINISH_GUARD_LINES.join(newline)
    if (source.indexOf(startSource) === -1) throw new Error('移动端电影入口源码块未匹配')
    if (source.indexOf(finishSource) === -1) throw new Error('前景电影完成路径源码块未匹配')
    return source.replace(startSource, startGuard).replace(finishSource, finishGuard)
  }

  DCWeb.DevilConnectionMovieWithBgPatch = {
    description: '为移动端自定义 [movie_with_bg] 建立标签级输入锁与单次完成路径，阻止视频就绪前点击提前推进剧本',
    failure: 'warn-and-continue',
    id: 'devil-connection-movie-with-bg-input-lock',
    name: '前景电影输入锁（movie_with_bg）',
    required: true,
    signatures: [
      { count: 1, name: '移动端电影入口', text: "    if ('pc' != $.userenv()) {" },
      { count: 2, name: '移动端事件层显示调用', text: '      this.kag.layer.showEventLayer()' },
      { count: 1, name: '电影结束推进路径', text: '      video.style.zIndex = 199999' },
      { count: 1, name: '电影跳过路径', text: "      'true' == pm.skip &&" },
      { count: 0, name: '电影输入锁补丁标记', text: MARKER },
    ],
    target: 'data/others/plugin/movie_with_bg/movie_with_bg.js',
    transform: transform,
  }

  DCWeb.DevilConnectionMoviePatch = {
    description: '为移动端 Tyrano 内置 [movie] 建立标签级输入锁与单次完成路径，阻止视频就绪前点击提前推进剧本',
    failure: 'warn-and-continue',
    id: 'devil-connection-movie-input-lock',
    name: '前景电影输入锁（内置 movie）',
    required: true,
    signatures: [
      { count: 1, name: '内置电影移动端入口', text: "    if ('pc' != $.userenv()) {" },
      { count: 1, name: '内置电影播放器调用', text: '      if ($.isTyranoPlayer()) this.playVideo(pm)' },
      { count: 1, name: '内置电影移动端解绑', text: "        $('.tyrano_base').unbind('click.movie')" },
      { count: 1, name: '内置电影结束推进路径', text: '      video.style.zIndex = 199999' },
      { count: 1, name: '内置电影跳过路径', text: "      'true' == pm.skip &&" },
      { count: 0, name: '内置电影输入锁补丁标记', text: MARKER },
    ],
    target: 'tyrano/plugins/kag/kag.tag_ext.js',
    transform: transform,
  }
})(window)
