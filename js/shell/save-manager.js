;(function (global) {
  'use strict'

  var DCWeb = global.DCWeb
  var MAX_ENTRY_COUNT = 100000
  var MAX_ENTRY_BYTES = 128 * 1024 * 1024
  var MAX_TOTAL_BYTES = 512 * 1024 * 1024

  function byteLength(value) {
    return new Blob([String(value || '')]).size
  }

  function tryJson(value, seen) {
    if (typeof value !== 'string' || seen.indexOf(value) !== -1) return null
    seen.push(value)
    try { return { decoded: value, parsed: JSON.parse(value) } } catch (error) { return null }
  }

  function decodeSaveData(value, lzString) {
    if (value === undefined || value === null) return null
    var source = String(value)
    var seen = []
    var result = tryJson(source, seen)
    if (result) return result
    try { result = tryJson(decodeURIComponent(source), seen) } catch (error) {}
    if (result) return result
    try { result = tryJson(unescape(source), seen) } catch (error) {}
    if (result) return result
    if (!lzString || typeof lzString.decompress !== 'function') return null
    var decompressed
    try { decompressed = lzString.decompress(source) } catch (error) { return null }
    if (typeof decompressed !== 'string') return null
    result = tryJson(decompressed, seen)
    if (result) return result
    try { result = tryJson(decodeURIComponent(decompressed), seen) } catch (error) {}
    if (result) return result
    try { return tryJson(unescape(decompressed), seen) } catch (error) { return null }
  }

  function parseStoredJson(value) {
    var decoded = decodeSaveData(value, global.LZString)
    return decoded ? decoded.parsed : null
  }

  function isSaveStorageKey(key) {
    return typeof key === 'string' && (key === 'NEO' || key.indexOf('DevilConnection_') === 0)
  }

  function textValue(value) {
    if (value === undefined || value === null) return ''
    return String(value).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  }

  function isFilledSave(value) {
    if (!value || typeof value !== 'object') return false
    return Boolean(value.save_date || value.current_order_index || (value.stat && value.stat.current_scenario))
  }

  function describeSave(value, fallbackTitle) {
    var stat = value && value.stat && typeof value.stat === 'object' ? value.stat : {}
    return {
      date: textValue(value && value.save_date),
      scenario: textValue(stat.current_scenario || value && value.current_scenario),
      title: textValue(value && value.title) || fallbackTitle,
    }
  }

  function classifyEntry(key, value) {
    var parsed = parseStoredJson(value)
    var kind = '其他数据'
    var detail = parsed ? 'JSON 数据' : '编码数据'
    if (/_tyrano_data$/i.test(key)) {
      kind = '手动存档数据'
      detail = parsed && Array.isArray(parsed.data) ? parsed.data.filter(isFilledSave).length + ' 个有效槽位' : '无法解析槽位'
    } else if (/_tyrano_auto_save(?:_.+)?$/i.test(key)) {
      kind = '自动存档数据'
      detail = parsed && isFilledSave(parsed) ? (describeSave(parsed, '自动存档').date || '已有记录') : '空记录或无法解析'
    } else if (/_sf$/i.test(key)) {
      kind = '系统变量'
      detail = '进度与全局设置'
    } else if (key === 'NEO') {
      kind = '独立进度'
      detail = 'NEO 剧情进度'
    } else if (key.indexOf('file:') === 0) {
      kind = '插件文件'
      detail = key.slice(5) || '虚拟文件数据'
    }
    return { detail: detail, key: key, kind: kind, size: byteLength(value) }
  }

  function inspectEntries(entries) {
    var savePoints = []
    var storageEntries = []
    var totalBytes = 0
    Object.keys(entries || {}).sort().forEach(function (key) {
      var value = entries[key]
      var size = byteLength(value)
      totalBytes += size
      storageEntries.push(classifyEntry(key, value))
      var parsed = parseStoredJson(value)

      if (/_tyrano_data$/i.test(key) && parsed && Array.isArray(parsed.data)) {
        parsed.data.forEach(function (save, index) {
          if (!isFilledSave(save)) return
          var record = describeSave(save, '手动存档 ' + String(index + 1).padStart(2, '0'))
          record.id = key + ':' + index
          record.kind = '手动存档'
          record.slot = index + 1
          savePoints.push(record)
        })
      } else if (/_tyrano_auto_save(?:_.+)?$/i.test(key) && parsed && isFilledSave(parsed)) {
        var autoRecord = describeSave(parsed, '自动存档')
        autoRecord.id = key
        autoRecord.kind = '自动存档'
        autoRecord.slot = null
        savePoints.push(autoRecord)
      }
    })
    return {
      entryCount: storageEntries.length,
      savePointCount: savePoints.length,
      savePoints: savePoints,
      storageEntries: storageEntries,
      totalBytes: totalBytes,
    }
  }

  function compatibleEntries(entries) {
    var result = {}
    Object.keys(entries || {}).sort().forEach(function (key) {
      if (isSaveStorageKey(key)) result[key] = String(entries[key])
    })
    return result
  }

  function validateImportEntries(entries, lzString) {
    var keys = Object.keys(entries || {})
    if (!keys.length) throw new Error('ZIP 中没有 DevilConnection 存档')
    if (keys.length > MAX_ENTRY_COUNT) throw new Error('ZIP 中的存档条目过多')
    var totalBytes = 0
    var normalized = {}
    keys.forEach(function (key) {
      if (!isSaveStorageKey(key)) throw new Error('ZIP 中包含不受支持的存档键：' + key)
      var size = byteLength(entries[key])
      if (size > MAX_ENTRY_BYTES) throw new Error('存档文件过大：' + key)
      totalBytes += size
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('ZIP 解压后的存档数据过大')
      var decoded = decodeSaveData(entries[key], lzString)
      if (!decoded) throw new Error('存档内容无效或已损坏：' + key)
      normalized[key] = encodeURIComponent(decoded.decoded)
    })
    return normalized
  }

  async function parseArchive(source, zipLibrary, lzString) {
    if (!zipLibrary || typeof zipLibrary.loadAsync !== 'function') throw new Error('ZIP 组件不可用')
    var zip
    try { zip = await zipLibrary.loadAsync(source, { checkCRC32: true }) } catch (error) {
      throw new Error('ZIP 格式错误、内容损坏或读取失败')
    }
    var entries = {}
    var files = []
    var ignoredCount = 0
    var declaredBytes = 0
    zip.forEach(function (path, file) {
      if (file.dir || !/\.sav$/i.test(path)) return
      var key
      try { key = decodeURIComponent(path.replace(/\.sav$/i, '')) } catch (error) {
        throw new Error('存档文件名无法解析：' + path)
      }
      if (!isSaveStorageKey(key)) {
        ignoredCount++
        return
      }
      if (Object.prototype.hasOwnProperty.call(entries, key)) throw new Error('ZIP 中存在重复存档键：' + key)
      var declaredSize = Number(file._data && file._data.uncompressedSize)
      if (isFinite(declaredSize) && declaredSize >= 0) {
        if (declaredSize > MAX_ENTRY_BYTES) throw new Error('存档文件过大：' + key)
        declaredBytes += declaredSize
        if (declaredBytes > MAX_TOTAL_BYTES) throw new Error('ZIP 解压后的存档数据过大')
      }
      entries[key] = null
      files.push({ file: file, key: key })
    })
    if (files.length > MAX_ENTRY_COUNT) throw new Error('ZIP 中的存档条目过多')
    for (var index = 0; index < files.length; index++) {
      try { entries[files[index].key] = await files[index].file.async('string') } catch (error) {
        throw new Error('无法读取存档文件：' + files[index].file.name)
      }
    }
    return { entries: validateImportEntries(entries, lzString), ignoredCount: ignoredCount }
  }

  function SaveManager(target, store) {
    this.target = target
    this.store = store || DCWeb.BrowserSaveStore.create(target)
  }

  SaveManager.prototype.inspect = async function () {
    return inspectEntries(await this.store.readEntries())
  }

  SaveManager.prototype.createExport = async function () {
    var entries = compatibleEntries(await this.store.readEntries())
    var keys = Object.keys(entries)
    if (!keys.length) return { blob: null, count: 0, fileName: 'DevilConnection_saves.zip' }
    var zipLibrary = this.target.JSZip
    if (typeof zipLibrary !== 'function') throw new Error('ZIP 组件不可用')
    var zip = new zipLibrary()
    keys.forEach(function (key) { zip.file(encodeURIComponent(key) + '.sav', entries[key]) })
    var blob = await zip.generateAsync({ type: 'blob' })
    return {
      blob: blob,
      count: keys.length,
      fileName: 'DevilConnection_saves.zip',
    }
  }

  SaveManager.prototype.parseImport = function (source) {
    return parseArchive(source, this.target.JSZip, this.target.LZString)
  }

  SaveManager.prototype.importEntries = async function (entries) {
    var normalized = validateImportEntries(entries, this.target.LZString)
    await this.store.updateEntries(normalized)
    return inspectEntries(await this.store.readEntries())
  }

  SaveManager.prototype.clear = async function () {
    var entries = await this.store.readEntries()
    await this.store.removeEntries(Object.keys(entries).filter(isSaveStorageKey))
    return inspectEntries(await this.store.readEntries())
  }

  SaveManager.compatibleEntries = compatibleEntries
  SaveManager.decodeSaveData = decodeSaveData
  SaveManager.inspectEntries = inspectEntries
  SaveManager.isSaveStorageKey = isSaveStorageKey
  SaveManager.parseArchive = parseArchive
  SaveManager.validateImportEntries = validateImportEntries
  DCWeb.SaveManager = SaveManager
})(window)
