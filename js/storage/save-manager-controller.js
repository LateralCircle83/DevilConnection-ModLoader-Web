;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb

  function SaveManagerController(view, manager, player) {
    this.view = view
    this.manager = manager
    this.player = player
    this.busy = false
  }

  SaveManagerController.prototype.bind = function () {
    var controller = this
    this.view.bindSaveManager({
      clear: function () { return controller.clear() },
      exportAll: function () { return controller.exportAll() },
      importFile: function (file) { return controller.importFile(file) },
      refresh: function () { return controller.refresh() },
    })
    this.view.onPageChange(function (pageName) {
      if (pageName === 'saves') return controller.refresh()
    })
  }

  SaveManagerController.prototype.runRead = async function (operation) {
    if (this.busy) return null
    this.busy = true
    this.view.setSaveBusy(true)
    try {
      await this.player.flushPreparedStorage()
      return await operation()
    } catch (error) {
      this.view.setSaveStatus(error && error.message ? error.message : String(error), 'error')
      return null
    } finally {
      this.busy = false
      this.view.setSaveBusy(false)
    }
  }

  SaveManagerController.prototype.runMutation = async function (operation) {
    if (this.busy || this.player.activeSession) return null
    this.busy = true
    this.player.setBusy(true)
    this.view.setSaveBusy(true)
    var suspended = false
    try {
      await this.player.suspendPreparedSession()
      suspended = true
      var result = await operation()
      await this.player.refreshStorageSession()
      suspended = false
      this.view.renderSaveReport(result)
      return result
    } catch (error) {
      if (suspended) {
        try { await this.player.refreshStorageSession() } catch (refreshError) {
          global.console.error('[DC save manager]', refreshError)
        }
      }
      this.view.setSaveStatus(error && error.message ? error.message : String(error), 'error')
      return null
    } finally {
      this.busy = false
      this.player.setBusy(false)
      this.view.setSaveBusy(false)
    }
  }

  SaveManagerController.prototype.refresh = function () {
    var controller = this
    return this.runRead(async function () {
      var report = await controller.manager.inspect()
      controller.view.renderSaveReport(report)
      return report
    })
  }

  SaveManagerController.prototype.exportAll = function () {
    var controller = this
    return this.runRead(async function () {
      var exported = await controller.manager.createExport()
      if (!exported.count) {
        controller.view.setSaveStatus('当前来源中没有可导出的存档数据', 'error')
        return null
      }
      controller.view.downloadBlob(exported.fileName, exported.blob)
      controller.view.setSaveStatus('已导出 ' + exported.count + ' 个原版兼容存档文件', 'success')
      return exported
    })
  }

  SaveManagerController.prototype.importFile = async function (file) {
    if (!file || this.busy || this.player.activeSession) return
    var preview
    try {
      preview = await this.manager.parseImport(await file.arrayBuffer())
    } catch (error) {
      this.view.setSaveStatus(error && error.message ? error.message : String(error), 'error')
      return
    }
    var report = DCWeb.SaveManager.inspectEntries(preview.entries)
    var confirmed = await this.view.confirmAction({
      confirmLabel: '导入存档',
      danger: false,
      message: '将导入 ' + report.entryCount + ' 个原版兼容存档文件，同名数据会被覆盖，其他现有数据会保留。' + (preview.ignoredCount ? '另有 ' + preview.ignoredCount + ' 个非存档项会被忽略。' : ''),
      title: '导入存档 ZIP？',
    })
    if (!confirmed) return

    var controller = this
    var result = await this.runMutation(function () { return controller.manager.importEntries(preview.entries) })
    if (result) this.view.setSaveStatus('导入完成：写入 ' + report.entryCount + ' 个存档文件，当前识别到 ' + result.savePointCount + ' 个存档点', 'success')
  }

  SaveManagerController.prototype.clear = async function () {
    if (this.busy || this.player.activeSession) return
    var confirmed = await this.view.confirmAction({
      confirmLabel: '清空全部存档',
      danger: true,
      message: '将删除当前浏览器来源中的原版游戏存档、系统变量和 NEO 进度。插件虚拟文件、核心与模组文件选择、模组配置不会被删除。',
      title: '确认清空存档？',
    })
    if (!confirmed) return

    var controller = this
    var result = await this.runMutation(function () { return controller.manager.clear() })
    if (result) this.view.setSaveStatus('当前来源中的原版游戏存档已清空', 'success')
  }

  DCWeb.SaveManagerController = SaveManagerController
})(window)
