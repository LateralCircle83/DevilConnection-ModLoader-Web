# 变更记录

本文件记录项目的重要功能、修复和结构调整。项目目前尚未发布正式版本，因此按开发日期归档。

## 未发布

### 兼容性调查

- Android Edge 的标题 fragmented MP4 在普通受管 Blob URL 路径中于 `loadedmetadata` 和 `play()` 之前失败，返回 `MEDIA_ERR_SRC_NOT_SUPPORTED` / `PipelineStatus::DEMUXER_ERROR_DETECTED_AAC`，而桌面 Chromium 可直接播放。同一字节复制为独立内存 Blob 后仍复现，排除了 ASAR range、`File.slice()` 高位偏移 backing store、Blob 字节缺失、用户激活和自动播放策略；相同字节经声明 `avc1.640028, mp4a.40.2` 的 `MediaSource` 可取得 metadata。因此将已确认的故障边界记录为 Android Chromium 普通 Blob 媒体输入路径对 fragmented MP4/AAC 的平台兼容性差异；没有 Chromium 上游问题编号前，不进一步断言具体内核提交或平台解码器缺陷。
- 缺失的迷雾效果统一来自 `kiri2.mp4`。该文件使用普通 `ftyp/moov/mdat` MP4，无法进入只接受 `mvex/moof` 的 MSE 回退；画面是常规 H.264，附带的 AAC-LC 轨经完整解码确认全静音。Tyrano 未处理的 `video.play()` Promise 只负责暴露 `NotSupportedError`，不是自动播放策略失败。

### 新增

- 增加资源就绪层：Tyrano `image` 标签在原始节点插入和淡入前等待预加载及 `decode()`，不对最终图片增加全局隐藏样式；已有视频预加载回调等待可播放状态并记录事件，但不修改视觉属性，继续服从游戏原有的 `movie_with_bg` 交接时序。
- 增加受限 fragmented MP4 恢复：受管 MP4/M4V 首次返回错误码 4 后，只有在文件不超过 16 MiB、严格包含 `ftyp/moov/mvex/moof`、可解析 AVC/AAC codec 且 MSE 明确支持时，才用一个 `SourceBuffer` 重载原元素一次；换源或结束会话时释放全部临时资源。
- 增加严格版本匹配的迷雾视频 Profile 补丁：只对大小及 SHA-256 均匹配的 `kiri2.mp4` 在内存中将唯一全静音 AAC `trak` 等长标记为 `free`，保留 H.264 画面、文件布局和所有视频 chunk offset；二进制补丁读取上限为 1 MiB，摘要计算不依赖局域网 HTTP 下不可用的安全上下文 API。
- 将存储准备前移到启动握手，使宿主 Start 的可信点击可同步解锁音频并调用原始 `TYRANO.init()`，不引入覆盖可见按钮的 iframe 代理。
- 在 Tyrano 适配边界增加有界预加载调度器：限制图片、音频和视频并发，合并语义相同的同 URL 在途请求，并支持超时放行、页面退出取消及分类遥测。
- 将临时静态服务器改为零依赖的 Node.js 工具，启动时同时显示本机与可用局域网 IPv4 地址；服务器仅提供网页所需文件并拒绝 ASAR 和目录访问。
- 在管理器中新增“存档”页面，可查看手动/自动存档摘要及完整存储明细。
- 使用原版兼容的 ZIP/SAV 格式导入和导出 `DevilConnection_*` 与 `NEO` 存档；导入前校验内容并增量覆盖同名项，保留其他存储数据。
- 清空存档只删除可与原版交换的游戏进度，不删除网页兼容层插件虚拟文件、模组配置或本地文件选择。
- 新增“关于”页面，运行时安全读取并渲染项目 `README.md`，避免维护重复说明文本。
- 使用 `favicon.ico` 作为站点图标，管理器标题调整为 `DevilConnection Modloader web`；游戏启动后改用最终资源层 `Config.tjs` 中的 `System.title`。
- 在支持 File System Access API 的浏览器中持久化核心与模组文件句柄、加载顺序和启用状态，刷新后按权限状态自动恢复或请求用户重新授权，不复制 ASAR 内容。
- 根据模组 `config.schema.json` 生成配置表单，支持 `text`、`password`、`number`、`toggle` 和 `select` 字段。
- 统一管理器、`ModLoader`、`electronAPI`、`fs` 与 `window.api` 的 DCML 配置路径映射，使模组无需为 Web 壳单独适配。
- 新增本地 DCML 模组 ASAR 导入、启停、移除及载入顺序调整。
- 按“游戏本体 → 模组列表由上到下”的顺序建立分层 VFS，后载入模组覆盖先载入内容。
- 支持标准 Electron ASAR 与旧 DCML 模组使用的兼容头布局。
- 为 `hook.js` 提供模组读取、URL、配置及常用 Electron/Node 接口兼容。
- 将启动拆为“载入核心 ASAR”和“开始游戏”，核心校验通过前禁止启动。
- 将游戏常驻顶栏改为左上角悬浮菜单按钮。
- 新增自适应全屏游戏菜单，可查看归档名称、版本、文件大小和资源来源。
- 为菜单补充重新载入、退出、Escape 关闭、焦点约束及移动端单列布局。
- 新增只读“兼容性”页面，展示必要转换的目标、最终资源来源和运行状态，并支持导出不含本地路径或归档内容的诊断 JSON。

### 文档

- 将 `README.md` 重写为中文用户指南。
- 新增智能体维护入口 `AGENTS.md`，统一记录架构、边界和验证要求。
- 新增 `TODO.md`，记录三层补丁职责、旧项目补丁候选、暂缓项和验收规则。
- 新增本变更记录，并移除职责重复的 `ARCHITECTURE.md`。

### 调整

- CSS 准备阶段只预读最终分层文本，首次访问样式时才同步实体化其实际依赖闭包；未使用样式及其图片、字体不会提前创建 Blob URL。
- 对象 URL 统计新增样式、图片、音频、视频、字体、文本和二进制分类的当前值与会话峰值，便于定位移动端资源压力。
- 二进制 API 优先直接在游戏 iframe realm 中读取 `ArrayBuffer`，仅在不兼容时回退逐字节复制，降低大文件读取时双缓冲峰值。
- 启用模组文本在读取前完成总量预检；达到 32 MiB 时只发布结构化记录和开发者控制台软提示，不阻止启动。
- 转换后的文本资源改为首次实际取用时才发布 Blob URL，并提供当前数量、逻辑字节数和会话峰值统计。
- 停用或移除模组时释放其同步文本缓存；重新启用时按需重建，并在启动计划中记录启用模组的文本资源总量。
- 将补丁职责真正落实为三层运行结构：`SessionPreparer` 统一编排最终模组 VFS、游戏 Profile 必要转换、壳层浏览器资源准备和 iframe 文档构建，播放器控制器只保留会话生命周期职责。
- 内存转换后的资源现在同时作为当前会话的文本、Blob 与对象 URL 视图；APNG Profile 补丁新增声明信息、严格源码匹配次数和应用状态结果。
- 将源码目录收拢为 `kernel / profiles / mods / shell / vendor` 五个职责域，在保留窄模块契约的前提下降低目录碎片。
- 引入小型声明式 `ProfileRunner`；必要转换不受支持或应用失败时会阻止启动，并将完整状态交给兼容性页面。
- 将 APNG 必要转换从游戏身份档案中拆为独立补丁声明，转换仍只作用于最终 VFS 资源的内存副本。
- 取消 Tyrano 页面内的第二次点击启动层，由宿主“开始游戏”按钮直接完成用户手势和会话启动。
- 模组顺序在游戏会话建立时冻结，运行中不修改资源层。
- 模组资源 Blob URL 与本体资源共用存档前路径还原；存档暂不记录或校验模组组合。

### 修复

- 本地文本 XHR 的 `responseURL` 改用规范逻辑 URL，避免仅为响应元数据给每个场景和配置文件常驻创建 Blob URL。
- CSS 准备阶段检测并打断循环依赖回边，避免后准备的样式替换并撤销已嵌入其他样式的 Blob URL。
- 动态 `<style>` 的 `textContent` 在赋值时立即转换 ASAR 资源 URL、读取时还原逻辑路径，避免光标等按需加载资源绕过 VFS，同时保持模组路径判断兼容性。
- 补齐资源属性、HTML 序列化和更多 CSS URL 属性的逻辑路径视图，避免模组因运行期 Blob URL 静默判断失败。
- 内联样式读取时将运行期 Blob URL 还原为 ASAR 逻辑路径，使依赖图片路径识别标题按钮的模组可以正常注入入口。
- 修复模组兼容层将 `Buffer` 设为不可调用对象，导致游戏 OGG 元数据解析异常并永久卡在 `lwaitload` 的问题。
- 将游戏 iframe 改为点击前完成准备，并由宿主“开始游戏”手势同步解锁音频后启动 Tyrano。
- 使用每次会话的随机 token 校验 `srcdoc` 播放器消息，避免依赖浏览器中不稳定的 `MessageEvent.source` 对象身份。
- 将模组 `hook.js` 延迟到 iframe DOM 就绪后执行，并让启动握手等待 hook 完成，修复工具箱等模组访问 `document.body` 时失败的问题。

## 2026-08-11

### 修复

- 支持还原普通、百分号编码及双重编码存档中的 Blob URL。
- 加固带查询参数、片段、编码字符、Windows 路径和 CSS 相对路径的资源解析。
- 修复页面刷新后存档引用旧 Blob URL 而导致资源加载失败的问题。

### 调整

- 将项目拆分为核心路径、ASAR、分层 VFS、资源、运行时、存储、兼容层、游戏配置、播放器和 UI 模块。
- 明确 `LayeredVfs` 的覆盖顺序，为后续模组层预留边界。
- 删除 `DCAsar`、`DCVfsRuntime`、`DCCompat`、`__dcActiveArchive` 和 `__ASAR_VFS__` 等旧全局接口。
- 将 iframe 的资源解析器改为显式传递，并保留游戏真正需要的 Electron 和 Tyrano 接口。

## 2026-08-10

### 新增

- 建立纯静态 ASAR 游戏运行壳。
- 支持浏览器内只读解析用户提供的 `app.asar`，无需向磁盘解包。
- 通过 Blob URL 和运行时拦截器加载 ASAR 内的脚本、样式、图片、音频和场景文件。
- 建立 iframe 游戏运行环境及 Electron 浏览器兼容接口。
- 使用 IndexedDB 保存 Tyrano 存档，并提供 localStorage 回退。
- 增加 URL、CSS、存档序列化和 VFS 覆盖规则测试。

### 修复

- 修复浏览器环境中的 APNG 二进制数据解码与空结果处理。
- 保存前将临时 Blob URL 转换为稳定的 ASAR 逻辑路径。
