;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb

  function CompatibilityController(shellView, compatibilityView, profile) {
    this.shellView = shellView
    this.view = compatibilityView
    this.profile = profile
    this.context = {}
    this.report = DCWeb.ProfileRunner.createReport(profile)
    this.report.status = 'idle'
  }

  CompatibilityController.prototype.bind = function () {
    var controller = this
    this.view.bind({ exportReport: function () { controller.exportReport() } })
    this.view.render(this.report, this.context)
  }

  CompatibilityController.prototype.checking = function (context) {
    this.context = context || {}
    this.report = DCWeb.ProfileRunner.createReport(this.profile)
    this.report.status = 'checking'
    this.view.render(this.report, this.context)
  }

  CompatibilityController.prototype.ready = function (report, context) {
    this.context = context || this.context
    this.report = report
    this.view.render(report, this.context)
  }

  CompatibilityController.prototype.failed = function (error, context) {
    this.context = context || this.context
    this.report = error && error.compatibility
      ? error.compatibility
      : {
          compatible: false,
          patches: [],
          profileId: this.profile.id,
          profileName: this.profile.name || this.profile.id,
          status: 'failed',
        }
    this.view.render(this.report, this.context)
    this.shellView.showPage('compatibility')
  }

  CompatibilityController.prototype.exportReport = function () {
    this.view.download('devil-connection-compatibility.json', {
      context: this.context,
      report: this.report,
      schemaVersion: 1,
    })
  }

  DCWeb.CompatibilityController = CompatibilityController
})(window)
