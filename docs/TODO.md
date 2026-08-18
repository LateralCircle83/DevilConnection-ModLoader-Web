# 开发待办

本文件记录尚未完成的工作和取舍依据。已完成的功能写入 `HISTORY.md`，用户使用方法写入 `../README.md`。

架构、三层补丁职责、实现约束和验收命令统一维护在 `../AGENTS.md`；已完成事项及兼容性调查统一维护在 `HISTORY.md`。

## 当前优先

- [ ] **Profile 集成矩阵**：使用真实 `LayeredVfs` 与最终模组覆盖组合，覆盖同路径本体、精确匹配模组、未知模组和不受支持本体，不再扩充孤立的 resolver stub。

## 需要证据

- [ ] **iOS/WebKit 多 AudioContext 挂起**：游戏在加载时、任何用户手势之前创建三个独立 AudioContext——Howler（`playbgm`/`playse`）、waapi（`[lbgm]`/`[lse]`，剧情共 191/32 处）、popopo（89 处标签）。只有 Howler 自带 `_unlockAudio()`（在 document 绑定一次性 touchstart/touchend/click）；waapi 与 popopo 没有任何 `resume()` 或解锁钩子，而 iOS Safari 上无手势创建的 AudioContext 保持 `suspended` 且不会自动恢复，这些声音会永久静音。壳的启动解锁只 resume `Howler.ctx`，且经 postMessage 调用不构成 iframe 内用户手势，iOS 上可能连 Howler 都要等游戏内首次点击兜底。待真机/WebKit 验证（UA 欺骗无效）后，在 Host 适配器内一次性监听 iframe 的 pointerdown/touchend/keydown 并 resume 所有已知 AudioContext（含 waapi、popopo）；`kag.tmp.audio_context` 创建后无人使用，不纳入。
- [ ] **标题循环 WebKit sequence 模式验证**：标题循环依赖 `SourceBuffer.mode='sequence'` + `timestampOffset` + `appendWindowStart/End` 的组合（MP3 无片段时间戳，无法改用 segments 模式），WebKit Bug 157539 记录过该组合的 MSE 行为偏差；Firefox/Chromium 实测正常，Safari 需真机确认循环音画同步与无声场景。
- [ ] **Android 资源压力诊断**：基于 `HISTORY.md` 已记录的资源规模调查，通过调试工具和真机开发者工具测量分类对象 URL 峰值、模组文本总量、APNG 生命周期和长 BGM 切换后的 AudioBuffer 回收。取得运行数据后再决定是否调整软提示或引入可选性能策略；在此之前不增加硬限制、永久缓存或可能撤销仍被引用资源的 LRU。
- [ ] **截图与相册可靠收敛**：先复现截图失败、页面克隆和相册删除问题，再合并处理 `snapSave` 单次结束、无缩略图存档、html2canvas `onclone` 克隆隔离，以及删除记录后的孤立图片数据；优先包装稳定接口，只能依赖源码结构时才进入版本 Profile。
- [ ] **移动端输入提交复位**：执行 Tyrano `[commit]` 后立即并在下一帧再次复位 `#tyrano_base` 滚动位置；先在真实移动浏览器复现输入法导致的画面偏移。
- [ ] **Backlog 初始化**：移除依赖固定 150 ms 的异步探测，改为通过 VFS 明确判断所需文件是否存在；确认不会改变原版初始化顺序。

## 暂缓

- [ ] **`link` 标签触屏双跳**：引擎 `link` 直接调用 `nextOrderWithLabel` 并同时绑定 `click touchstart`，一次触摸会跳转两次，且不经过 `jump` 标签、不受 jump guard 覆盖。本作剧情 `[link]` 用量为 0，现有推荐模组也未使用；只有未来启用 `[link]` 时才按 jump guard 思路做有界包装，不引入全局 click/tap 去重。
- [ ] **WAAPI 资源错误处理**：先确认当前运行时是否仍会因 XHR 或解码失败让 `isLoading` 永久不归零，再设计有超时和失败状态的实现。

## 明确不引入

- 为 skip 型延迟推进加保护：`r`（5 ms）、text 完成后的 skipSpeed、camera 完成后的 300 ms、image/freeimage 淡入回调、`savesnap` 截图回调都会在 `is_strong_stop=false` 时延迟 `nextOrder()`，但只会多跳一两个标签、不会改变执行位置到另一分支，也没有持久副作用标签，不满足修复优先级。
- 全局永久 Howl 音频缓存：会让长流程内存持续增长。
- 全量资源预取或无上限加载队列：与按需读取 ASAR 的目标冲突。
- 未复现字体阻塞时全局注入 `font-display: swap`：可能重新引入字体闪烁；若只是体验偏好，应由可选模组或设置负责。
- 未测量到具体场景卡顿时修改六处场景预载，或增加 `jump` / `call` 场景预取：本地 ASAR 收益不明，且会扩大解码内存和 Blob URL 生命周期。
- 并行加载 Tyrano 核心脚本：容易破坏脚本依赖顺序，收益不足以抵消风险。
- 整份复制 `kag.js`、`kag.tag.js`、`kag.menu.js` 或 `libs.js`：版权、升级和模组覆盖成本过高。
- 旧项目的加载遮罩、点击启动门、`configSave` 覆盖和调试库：当前壳已有对应能力或不属于运行必需功能。
- 为尚未复现的问题引入宽泛 monkey patch：先建立最小复现和回归测试。
