;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb || (global.DCWeb = {})

  function createSimulation(options) {
    options = options || {}
    var schedule = options.schedule || function (callback, delay) { return global.setTimeout(callback, delay) }
    var cancel = options.cancel || function (handle) { global.clearTimeout(handle) }
    var onTrace = typeof options.onTrace === 'function' ? options.onTrace : function () {}
    var generation = 0
    var pendingHandle = null
    var currentSource = ''
    var kag = null
    var state = null

    function snapshot() {
      return {
        accepted: state.accepted,
        blocked: state.blocked,
        completedJumps: state.completedJumps,
        fallthroughs: state.fallthroughs,
        guardInstalled: state.guardInstalled,
        mode: state.mode,
        order: state.order,
        postTarget: state.postTarget,
        requests: state.requests,
        sex: state.sex,
        stage: state.stage,
        strongStop: Boolean(kag.stat.is_strong_stop),
      }
    }

    function emit(kind, source) {
      onTrace({ kind: kind, source: source || '', state: snapshot() })
    }

    function completeJump(activeGeneration, target) {
      if (activeGeneration !== generation) return
      pendingHandle = null
      kag.ftag.nextOrderWithLabel(target)
    }

    function buildRuntime(mode) {
      state = {
        accepted: 0,
        blocked: 0,
        completedJumps: 0,
        fallthroughs: 0,
        guardInstalled: false,
        mode: mode,
        order: 0,
        postTarget: 0,
        requests: 0,
        sex: 1,
        stage: 'pause',
      }

      kag = {
        stat: { is_strong_stop: false },
        tag: {},
        ftag: {
          current_order_index: 0,
          master_tag: {},
          nextOrder: function () {
            if (kag.stat.is_strong_stop) {
              state.blocked += 1
              emit('advance-blocked', currentSource)
              return false
            }

            state.accepted += 1
            this.current_order_index += 1
            state.order = this.current_order_index
            if (this.current_order_index === 1) {
              state.stage = 'jump-pending'
              this.master_tag.jump.start({ target: '*target' })
            } else if (this.current_order_index === 2) {
              state.stage = 'fallthrough'
              state.fallthroughs += 1
              state.sex = 2
              emit('fallthrough-executed', currentSource)
            } else if (this.current_order_index > 10) {
              state.stage = 'target'
              state.postTarget += 1
              emit('target-advanced', currentSource)
            }
            return true
          },
          nextOrderWithLabel: function (target) {
            kag.stat.is_strong_stop = false
            this.current_order_index = 10
            state.order = 10
            state.stage = 'target'
            state.completedJumps += 1
            emit('jump-completed', target)
          },
        },
      }

      var jumpTag = {
        kag: kag,
        start: function (pm) {
          var activeGeneration = generation
          pendingHandle = schedule(function () { completeJump(activeGeneration, pm.target) }, 1)
          emit('jump-scheduled', currentSource)
        },
      }
      kag.tag.jump = jumpTag
      kag.ftag.master_tag.jump = jumpTag

      if (mode === 'host-guard') {
        state.guardInstalled = Boolean(DCWeb.TyranoJumpGuard && DCWeb.TyranoJumpGuard.install(kag))
      }
    }

    function reset(mode) {
      if (mode !== 'unguarded' && mode !== 'host-guard') {
        throw new Error('Unknown input advance mode: ' + mode)
      }
      generation += 1
      if (pendingHandle !== null) cancel(pendingHandle)
      pendingHandle = null
      currentSource = ''
      buildRuntime(mode)
      return snapshot()
    }

    function advance(source) {
      state.requests += 1
      currentSource = source || ''
      emit('advance-requested', currentSource)
      var accepted = kag.ftag.nextOrder()
      currentSource = ''
      return accepted
    }

    function dispose() {
      generation += 1
      if (pendingHandle !== null) cancel(pendingHandle)
      pendingHandle = null
    }

    reset('unguarded')
    return { advance: advance, dispose: dispose, reset: reset, snapshot: snapshot }
  }

  DCWeb.InputAdvanceProbe = { createSimulation: createSimulation }

  if (!global.document) return

  var document = global.document
  var elements = {}
  var records = []
  var active = null
  var runNumber = 0
  var finishTimer = 0
  var timeline = []
  var MAX_TIMELINE = 120

  function byId(id) {
    return document.getElementById(id)
  }

  function now() {
    return global.performance && typeof global.performance.now === 'function'
      ? global.performance.now()
      : Date.now()
  }

  function selectedMode() {
    var selected = document.querySelector('input[name="guard-mode"]:checked')
    return selected ? selected.value : 'unguarded'
  }

  function stageText(stage) {
    return {
      pause: '等待点',
      'jump-pending': 'jump 等待回调',
      fallthrough: '相邻分支',
      target: '目标标签',
    }[stage] || stage
  }

  function trace(kind, detail) {
    if (!active) return
    var entry = {
      atMs: Math.max(0, now() - active.startedAt),
      detail: detail,
      kind: kind,
    }
    timeline.push(entry)
    if (timeline.length > MAX_TIMELINE) timeline.shift()
    active.timeline.push(entry)
    renderTimeline()
  }

  var simulation = createSimulation({
    onTrace: function (entry) {
      var kind = entry.kind === 'fallthrough-executed' ? 'boundary' : 'advance'
      trace(kind, entry.kind + (entry.source ? ' / ' + entry.source : ''))
      renderState(entry.state)
    },
  })

  function beginRun(origin) {
    if (finishTimer) global.clearTimeout(finishTimer)
    if (active && !active.finished) finishRun('replaced')
    runNumber += 1
    timeline = []
    active = {
      finished: false,
      id: runNumber,
      mode: selectedMode(),
      origin: origin,
      rawEvents: [],
      startedAt: now(),
      timeline: [],
    }
    simulation.reset(active.mode)
    elements.exportButton.disabled = true
    elements.probeStatus.textContent = 'RUN ' + String(runNumber).padStart(2, '0')
    elements.resultState.dataset.state = 'idle'
    elements.resultState.textContent = '采集中'
    renderState(simulation.snapshot())
    renderTimeline()
    return active
  }

  function ensureRun(origin) {
    if (!active || active.finished) return beginRun(origin)
    return active
  }

  function rawEvent(event) {
    var run = ensureRun(event.type)
    var pointerType = event.pointerType || (event.changedTouches ? 'touch' : '')
    var item = {
      detail: Number(event.detail) || 0,
      isTrusted: Boolean(event.isTrusted),
      pointerType: String(pointerType || ''),
      type: event.type,
    }
    run.rawEvents.push(item)
    trace('dom', event.type + ' / trusted=' + item.isTrusted + (item.pointerType ? ' / ' + item.pointerType : ''))
    renderState(simulation.snapshot())
  }

  function scheduleFinish() {
    if (finishTimer) global.clearTimeout(finishTimer)
    finishTimer = global.setTimeout(function () { finishRun('settled') }, 700)
  }

  function finishRun(reason) {
    if (!active || active.finished) return
    if (finishTimer) global.clearTimeout(finishTimer)
    finishTimer = 0
    active.finished = true
    active.finishedAt = new Date().toISOString()
    active.reason = reason
    active.result = simulation.snapshot()
    records.push(active)
    if (records.length > 24) records.shift()
    elements.exportButton.disabled = false
    renderState(active.result)
  }

  function renderState(snapshot) {
    if (!snapshot) snapshot = simulation.snapshot()
    elements.metricEvents.textContent = active ? String(active.rawEvents.length) : '0'
    elements.metricRequests.textContent = String(snapshot.requests)
    elements.metricBlocked.textContent = String(snapshot.blocked)
    elements.metricFallthrough.textContent = String(snapshot.fallthroughs)
    elements.currentStage.textContent = stageText(snapshot.stage) + ' / order ' + snapshot.order
    elements.currentSex.textContent = 'f.seibetu = ' + snapshot.sex
    elements.strongStop.textContent = String(snapshot.strongStop)
    elements.jumpCount.textContent = String(snapshot.completedJumps)
    elements.guardStatus.textContent = snapshot.guardInstalled ? 'TyranoJumpGuard' : '未启用'
    elements.trustedClickCount.textContent = active
      ? String(active.rawEvents.filter(function (entry) { return entry.type === 'click' && entry.isTrusted }).length)
      : '0'

    if (!active) {
      elements.resultState.dataset.state = 'idle'
      elements.resultState.textContent = '等待输入'
    } else if (snapshot.fallthroughs > 0) {
      elements.resultState.dataset.state = 'breach'
      elements.resultState.textContent = '检测到越界推进'
    } else if (snapshot.blocked > 0) {
      elements.resultState.dataset.state = 'protected'
      elements.resultState.textContent = '额外推进已拦截'
    } else if (snapshot.postTarget > 0) {
      elements.resultState.dataset.state = 'late'
      elements.resultState.textContent = '额外推进晚于 jump'
    } else if (snapshot.completedJumps > 0) {
      elements.resultState.dataset.state = 'safe'
      elements.resultState.textContent = '单次推进'
    }
  }

  function renderTimeline() {
    elements.eventLog.replaceChildren()
    if (timeline.length === 0) {
      var empty = document.createElement('p')
      empty.className = 'empty-log'
      empty.textContent = '尚无输入事件'
      elements.eventLog.appendChild(empty)
      elements.timelineCount.textContent = '0 条'
      return
    }

    timeline.forEach(function (entry) {
      var row = document.createElement('div')
      row.className = 'event-row'
      row.dataset.kind = entry.kind
      var time = document.createElement('span')
      time.className = 'event-time'
      time.textContent = '+' + entry.atMs.toFixed(1) + 'ms'
      var kind = document.createElement('span')
      kind.className = 'event-kind'
      kind.textContent = entry.kind.toUpperCase()
      var detail = document.createElement('span')
      detail.className = 'event-detail'
      detail.textContent = entry.detail
      row.append(time, kind, detail)
      elements.eventLog.appendChild(row)
    })
    elements.timelineCount.textContent = timeline.length + ' 条'
    elements.eventLog.scrollTop = elements.eventLog.scrollHeight
  }

  function resetAll() {
    if (finishTimer) global.clearTimeout(finishTimer)
    finishTimer = 0
    if (active && !active.finished) active.finished = true
    active = null
    records = []
    timeline = []
    simulation.reset(selectedMode())
    elements.exportButton.disabled = true
    elements.probeStatus.textContent = '等待一次物理输入'
    renderState(simulation.snapshot())
    renderTimeline()
  }

  function exportReport() {
    if (active && !active.finished) finishRun('exported')
    var payload = {
      environment: {
        maxTouchPoints: Number(global.navigator.maxTouchPoints) || 0,
        pointerEvent: typeof global.PointerEvent === 'function',
        touchEvent: 'ontouchend' in document,
        userAgent: String(global.navigator.userAgent || ''),
      },
      exportedAt: new Date().toISOString(),
      runs: records,
      schemaVersion: 2,
    }
    var url = global.URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    var link = document.createElement('a')
    link.href = url
    link.download = 'dc-input-advance-' + Date.now() + '.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    global.setTimeout(function () { global.URL.revokeObjectURL(url) }, 0)
  }

  function onTouchEnd(event) {
    rawEvent(event)
    simulation.advance('touchend:tap')
    scheduleFinish()
  }

  function onClick(event) {
    rawEvent(event)
    simulation.advance(event.isTrusted ? 'click:trusted' : 'click:synthetic')
    scheduleFinish()
  }

  function bindEvents() {
    var probe = elements.probe
    ;['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchmove'].forEach(function (type) {
      probe.addEventListener(type, rawEvent, { passive: true })
    })
    probe.addEventListener('touchend', onTouchEnd, { passive: true })
    probe.addEventListener('click', onClick)
    probe.addEventListener('dblclick', rawEvent)

    Array.prototype.forEach.call(document.querySelectorAll('input[name="guard-mode"]'), function (input) {
      input.addEventListener('change', function () {
        elements.modeDetail.textContent = input.value === 'host-guard'
          ? 'jump.start() 同步拉起 strong stop，原 nextOrderWithLabel() 负责解闸'
          : '保留原始异步 jump，不启用 strong stop 保护'
        resetAll()
      })
    })
    elements.resetButton.addEventListener('click', resetAll)
    elements.exportButton.addEventListener('click', exportReport)
    global.addEventListener('pagehide', function () { simulation.dispose() }, { once: true })
  }

  function init() {
    elements = {
      currentSex: byId('current-sex'),
      currentStage: byId('current-stage'),
      environment: byId('environment'),
      eventLog: byId('event-log'),
      exportButton: byId('export-probe'),
      guardStatus: byId('guard-status'),
      jumpCount: byId('jump-count'),
      metricBlocked: byId('metric-blocked'),
      metricEvents: byId('metric-events'),
      metricFallthrough: byId('metric-fallthrough'),
      metricRequests: byId('metric-requests'),
      modeDetail: byId('mode-detail'),
      probe: byId('input-probe'),
      probeStatus: byId('probe-status'),
      resetButton: byId('reset-probe'),
      resultState: byId('result-state'),
      strongStop: byId('strong-stop'),
      timelineCount: byId('timeline-count'),
      trustedClickCount: byId('trusted-click-count'),
    }
    elements.environment.textContent = [
      'touch=' + String('ontouchend' in document),
      'points=' + String(Number(global.navigator.maxTouchPoints) || 0),
      String(global.navigator.userAgent || ''),
    ].join(' / ')
    bindEvents()
    resetAll()
    document.documentElement.setAttribute('data-dc-input-probe-ready', 'true')
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true })
  else init()
})(typeof window !== 'undefined' ? window : globalThis)
