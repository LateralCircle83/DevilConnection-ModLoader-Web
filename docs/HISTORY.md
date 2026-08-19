# 变更记录

本文件记录项目的重要功能、修复和结构调整。项目目前尚未发布正式版本，因此按开发日期归档。

## 未发布

### 兼容性调查

- 变身场景背景卡黑的根因是 `[bg]` 异步应用竞态：标签在 `kag.preload` 回调里写 base 层背景，多个 `time=0` 的 `[bg]` 并发时，最终背景由回调完成顺序决定而非标签顺序。Android 上 `kuro.webp` 冷 blob 加载约 170–200ms，而 `haikei2.webp` 回档后的热缓存请求仅 13–21ms；回档后中间标签（flash_off/playse/bgmovie）变快使两个 preload 重叠，haikei2 先落地、迟到的 kuro 覆盖它，表现为全屏变身视频后背景保持黑底、角色与剧情正常。桌面 blob 加载毫秒级，kuro 总是先完成所以从未触发。同一竞态覆盖全部 730 个 `time=0` 的 `[bg]`/`[bg2]`，实际可重叠的主要是“kuro → 下一个背景”的闪黑恢复 idiom（Chapter3 与 Devil_Hardester 逐字重复同一变身序列）。
- 移动端性别选择异常的通用故障边界位于 Tyrano 的异步 `jump`：标签通过 1ms timer 延后调用 `nextOrderWithLabel()`，但在这段时间内 `is_strong_stop` 仍为 false；触屏适配把同一次物理输入通过 tap/click 路径形成连续 `nextOrder()` 时，第二次推进可先执行 jump 下方的相邻标签。最终 jump 仍会抵达目标，因此后续台词正确，但期间写入的 `f.seibetu` 会保留并使菜单图标错误。桌面鼠标通常只有一次推进，因而很难进入该窗口；关键差异是单次输入送达的推进次数，而不是设备性能。
- 对跨文件 `jump` / `call` 的异步 `loadScenario` 窗口做静态审计与真机连点核查：`nextOrderWithLabel` / `nextOrderWithIndex` 会在加载前清 `is_strong_stop` 并隐藏事件层，但该窗口没有复现二次推进。原因分层成立：加载期间唯一的点击推进入口 `.layer_event_click` 因事件层隐藏而收不到输入；free 层 glink / button / clickable 都要求 `is_strong_stop` 为真或受 `button_clicked` 去重，而加载期 strong stop 已复位；本作不存在 fix 层跨文件 glink，无法绕过门控；标题到第一章的跨文件跳转为自动触发，触发前按钮已随 `[free layer="fix" name="title_menu"]` 移除；读档与 backlog 恢复的存档槽位于菜单层、不经过事件层冒泡，且首次点击后菜单立即隐藏并清空。结论是 jump guard 修复的 1ms 窗口是引擎内唯一同时满足“strong stop 为 false 且事件层可见”的推进间隙。
- Android Edge 的标题 fragmented MP4 在普通受管 Blob URL 路径中于 `loadedmetadata` 和 `play()` 之前失败，返回 `MEDIA_ERR_SRC_NOT_SUPPORTED` / `PipelineStatus::DEMUXER_ERROR_DETECTED_AAC`，而桌面 Chromium 可直接播放。同一字节复制为独立内存 Blob 后仍复现，排除了 ASAR range、`File.slice()` 高位偏移 backing store、Blob 字节缺失、用户激活和自动播放策略；相同字节经声明 `avc1.640028, mp4a.40.2` 的 `MediaSource` 可取得 metadata。因此将已确认的故障边界记录为 Android Chromium 普通 Blob 媒体输入路径对 fragmented MP4/AAC 的平台兼容性差异；没有 Chromium 上游问题编号前，不进一步断言具体内核提交或平台解码器缺陷。
- 缺失的迷雾效果统一来自 `kiri2.mp4`。该文件使用普通 `ftyp/moov/mdat` MP4，无法进入只接受 `mvex/moof` 的 MSE 回退；画面是常规 H.264，附带的 AAC-LC 轨经完整解码确认全静音。Tyrano 未处理的 `video.play()` Promise 只负责暴露 `NotSupportedError`，不是自动播放策略失败。
- Android 逐项媒体扫描进一步确认 `effect.mp4` 存在同类故障：它也是普通 `ftyp/moov/free/mdat` MP4，H.264 画面可完整解码，唯一 AAC-LC 轨的全部解码样本均为零；文件大小为 963,462 字节，SHA-256 为 `0151e07fec302ed5de5998dda6202b5120d7c0c2cc612e90c98640f04055c9bd`。
- 对基础包和当前汉化覆盖后的最终资源做只读媒体审计：46 个 MP4 中有 40 个 fragmented MP4，其中 15 个带 AAC；现有 MSE 检查可识别全部 40 个，除 17.18 MiB 且只有 H.264 轨的 `title_main.mp4` 外均处于 16 MiB 回退上限内。`title_main.mp4` 由游戏标题循环插件自己的 MSE 路径读取，不属于普通 Blob/AAC 故障，因此修复边界限定为游戏 Profile 内的 SourceBuffer 队列，而不是 Host 媒体回退。
- 最终资源中的 559 个独立音频均可被媒体探针解析，编码为 556 个 Vorbis 和 3 个 MP3，没有发现 AAC 同类封装；最长 BGM 解码为双声道 Float32 PCM 的理论体积约 108.6 MiB。另有 12 个压缩体积超过 16 MiB 的 APNG，单帧 RGBA 约 3.9–9.9 MiB，按现有一次建立所有帧图像的行为计算，完整帧上界约 124–347 MiB，需在真机测量实际峰值后以可选性能策略处理。

### 新增

- 增加严格版本匹配的连点兼容 Profile：安卓端浏览器对间隔极短的连续点击会取消合成 click，使依赖原生 click 的连打互动丢点击。补丁精确命中两处连打场景的 `[clickable target="*da"]`——`Chapter4_2kuitomeru.ks` 的 NEO 魔力放出与 `omake_yume_kupya.ks` 的 3 秒限时连打——在该行后插入 `[iscript]`，对刚创建的按钮以 `touchend` 直触发游戏 click handler（`preventDefault` 取消浏览器延迟 click，`trigger('click')` 逐次命中），其余 clickable、mousedown 按住型和 glink/button（tap 多边形）均不受影响，也不与 Host 触屏 tap 防推进保护冲突。插入内容遵循引擎解析约束（场景解析器会把以 `;` 开头的行当注释跳过，即使位于 `[iscript]` 内），签名不符时保留原资源并产生可启动警告。
- 增加严格版本匹配的标题循环 Profile：分别串行化视频与音频 `SourceBuffer`，每次只在 `updateend` 后按固定 deadline 安排下一段，避免定时器重入触发 `InvalidStateError`；加载失败、同名实例替换和退出会取消队列与定时器、解除监听、中止在途追加、关闭 `MediaSource` 并撤销标题 Blob URL。未知本体或模组覆盖保留原资源并产生可启动警告，不全局包装 `SourceBuffer.prototype`。
- 新增零依赖的跨平台 `npm start` 入口，继续调用带文件白名单的 `tools/static-server.js`；无需安装 npm 包或执行构建，Windows 原有 `start_server.bat` 保持可用。
- 将游戏菜单改为保留场景背景的响应式浮动面板：桌面双栏展示会话控制与运行日志，窄屏改为单列有界滚动；新增包含 Esc、F1–F12、QWERTY、修饰键、导航区和方向键的紧凑 TKL 虚拟键盘，按键事件在游戏 iframe realm 中生成，兼容 `key/code` 与旧式 `keyCode/which`。Ctrl、Shift、Alt 与 Meta 可锁定用于组合键，菜单关闭、窗口失焦、重载和退出时统一释放。
- Host kernel 新增有界游戏控制台监控：只捕获 iframe 主世界的 `console.warn/error`、未捕获异常和 Promise rejection，最多保留 160 条、单条最多 2400 字符且不持有原始对象引用；浮动面板按需读取快照，支持级别筛选、刷新、复制和清空，不尝试读取浏览器扩展隔离世界或 Chromium 内部日志。
- 模组页面增加“已添加 / 推荐模组”分段视图：推荐目录通过同源静态 `catalog.json` 延迟读取，校验唯一 ID，以及本地直接子级 `.asar` 或受限 GitHub HTTPS 直链，再以浏览器原生下载保存到本地；说明、版本、作者和大小均为可选展示信息，不会把包读入内存、自动导入或改变当前模组计划。已有上游发行的汉化、小剧场、库皮亚、多艾露与工坊包改用外链，开发服务器只暴露清单中仍选择随仓库分发的本地包，根目录和其他 ASAR 保持拒绝。
- 增加严格版本匹配的第二层 Remodal 兼容补丁：仅在最终 `index.html` 保留已验证的原版 Remodal 依赖、弹窗和按钮结构时注入独立缩放器，将窄屏媒体查询压缩掉的弹窗恢复为游戏坐标中的 700px 设计宽度，再按 Tyrano 当前 `base_scale` 和移动端可视视口等比居中；未知页面覆盖保留原资源并产生可启动警告，不继承未经验证的布局假设。补丁不覆盖 `$.alert` / `$.confirm`，旋转后有一次 250ms 有界再校准，关闭或退出时完整还原 DOM 和 wrapper 样式。
- 管理器新增“调试”工具目录，以独立标签页打开媒体兼容诊断而不替换当前会话；移动端导航改为三列两行，工具操作在窄屏纵向收拢，避免新增入口造成横向溢出。
- 调试工具新增触摸推进诊断页：真实记录 probe 收到的 pointer、touch、鼠标与 click 事件，分别将一次 `touchend` 和实际送达的 `click` 计为推进来源，在相同的 1ms jump 模型中对照未保护路径与正式 Host jump guard；报告区分越界、strong-stop 拦截和晚于 jump 的普通推进，并可导出不含游戏内容的 JSON。旧版固定把一次 `touchend` 建模为两次推进的原型已撤销，避免把复现假设误当作设备测量。
- 增加独立媒体兼容诊断页：按基础包和所选模组的最终覆盖顺序枚举视频，逐项测试 Blob 首帧，并在错误码 4 后按正式运行时顺序尝试保声 MSE 与普通 MP4 仅画面回退；测试全程只保留一个媒体元素和一个临时 URL，可停止并导出不含归档内容的 JSON。维护用 `selftest` 模式会在页面内生成一个有效视频和一个损坏 MP4 的内存 ASAR，验证成功、失败和释放分支。
- 增加普通 MP4 仅画面兜底：受管 MP4/M4V 首次返回错误码 4 且保声 MSE 不适用或失败后，只对结构完整、非分片、恰有一条 H.264 和一条 AAC 轨的文件生成等长复合 Blob；仅将音频 `trak` 类型替换为 `free`，顶层 box 以范围切片扫描，`moov` 读取上限为 4 MiB，不因大视频复制完整文件。降级时控制台输出包含逻辑路径、VFS 层、codec 和原始错误的警告，失败、换源和退出均释放临时 URL。
- 严格静音视频 Profile 允许未知模组覆盖委托给运行时：最终来源为 `mod` 且大小或摘要不匹配时记录 `delegated` 而不执行内容转换；精确匹配资源仍应用补丁，未知基础视频则保留原资源并产生可启动警告，后续仍可由原生播放或 Host 的真实错误回退处理。
- 增加资源就绪层：Tyrano `image` 标签在原始节点插入和淡入前等待预加载及 `decode()`，不对最终图片增加全局隐藏样式；已有视频预加载回调等待可播放状态并记录事件，但不修改视觉属性，继续服从游戏原有的 `movie_with_bg` 交接时序。
- 增加受限 fragmented MP4 恢复：受管 MP4/M4V 首次返回错误码 4 后，只有在文件不超过 16 MiB、严格包含 `ftyp/moov/mvex/moof`、可解析 AVC/AAC codec 且 MSE 明确支持时，才用一个 `SourceBuffer` 重载原元素一次；不适用或失败后才允许进入普通 MP4 仅画面兜底，换源或结束会话时释放全部临时资源。
- 增加严格版本匹配的静音视频 Profile 补丁：分别对大小及 SHA-256 均匹配的 `kiri2.mp4` 和 `effect.mp4` 在内存中将唯一全静音 AAC `trak` 等长标记为 `free`，保留 H.264 画面、文件布局和所有视频 chunk offset；每个补丁独立校验且读取上限为 1 MiB，摘要计算不依赖局域网 HTTP 下不可用的安全上下文 API。
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

- 增加根目录 GNU AGPL v3 完整许可证，并以 `AGPL-3.0-only` 标记包元数据；README 只说明项目原创代码、第三方材料、游戏内容和独立模组之间的许可边界，第三方条款仍集中保存在 `docs/THIRD_PARTY_NOTICES.md`。开发服务器仅通过精确白名单额外提供许可证文本。
- 收敛 Markdown 文档职责：根目录 `README.md` 只保留用户指南与 Web 兼容范围，根目录 `AGENTS.md` 统一维护架构、约束和验收命令，`docs/TODO.md` 只记录未完成、暂缓和拒绝事项，`docs/HISTORY.md` 归档完成项与调查结论，`docs/THIRD_PARTY_NOTICES.md` 只保存第三方来源和许可；移除各文件之间重复的实现说明与已完成待办。
- 将上游 `ModsUsage.md` 保存为 `docs/ModsUsage.md`，供离线查阅 DCML/Rebuild 完整模组规范；`README.md` 只说明 Web 壳实际支持的子集，第三方声明保存原始来源与 BSD-3-Clause 全文。临时服务器仅通过精确白名单提供四份 `docs/` 文档，不开放任意目录读取。
- 移除职责重复的 `ARCHITECTURE.md`。

### 调整

- 更新推荐模组“恶魔连结工具箱”至 1.0.2：移除手机端右上角悬浮按钮，保留 F9 打开/关闭面板，并在模组清单与推荐简介中补充快捷键说明。
- CSS 准备阶段只预读最终分层文本，首次访问样式时才同步实体化其实际依赖闭包；未使用样式及其图片、字体不会提前创建 Blob URL。
- 对象 URL 统计新增样式、图片、音频、视频、字体、文本和二进制分类的当前值与会话峰值，便于定位移动端资源压力。
- 二进制 API 优先直接在游戏 iframe realm 中读取 `ArrayBuffer`，仅在不兼容时回退逐字节复制，降低大文件读取时双缓冲峰值。
- 启用模组文本在读取前完成总量预检；达到 32 MiB 时只发布结构化记录和开发者控制台软提示，不阻止启动。
- 转换后的文本资源改为首次实际取用时才发布 Blob URL，并提供当前数量、逻辑字节数和会话峰值统计。
- 停用或移除模组时释放其同步文本缓存；重新启用时按需重建，并在启动计划中记录启用模组的文本资源总量。
- 将补丁职责真正落实为三层运行结构：`SessionPreparer` 统一编排最终模组 VFS、游戏 Profile 必要转换、壳层浏览器资源准备和 iframe 文档构建，播放器控制器只保留会话生命周期职责。
- 内存转换后的资源现在同时作为当前会话的文本、Blob 与对象 URL 视图；APNG Profile 补丁新增声明信息、严格源码匹配次数和应用状态结果。
- 将源码目录收拢为 `kernel / profiles / mods / shell / vendor` 五个职责域，在保留窄模块契约的前提下降低目录碎片。
- 引入小型声明式 `ProfileRunner`；严格签名只决定转换能否安全应用。当前必要转换不受支持、目标缺失、读取或应用失败时不生成替换资源，发布可启动警告并继续检查后续补丁；只有显式 `abort-session` 或会话构建本身失败才阻止启动。
- 将 APNG 必要转换从游戏身份档案中拆为独立补丁声明，转换仍只作用于最终 VFS 资源的内存副本。
- 取消 Tyrano 页面内的第二次点击启动层，由宿主“开始游戏”按钮直接完成用户手势和会话启动。
- 模组顺序在游戏会话建立时冻结，运行中不修改资源层。
- 模组资源 Blob URL 与本体资源共用存档前路径还原；存档暂不记录或校验模组组合。

### 修复

- `window.api.readFileBin` 读取前先经当前会话的 `AssetResolver` 把运行期 Blob URL 还原为编码后的 ASAR 逻辑路径，再执行 VFS 查找；照相机插件从角色 `<img>.src` 反向读取立绘时不再把 Blob URL 当作归档路径，未在注册表登记的未知 Blob 仍按原样报 `ASAR file not found`。
- Host Tyrano 适配新增背景应用顺序保护：`tyrano-bg-guard.js` 为每个 `[bg]`/`[bg2]` 请求分配单调递增序号，preload 回调落地时若已不是最新请求则丢弃，保证 base 层最终背景始终等于最后请求的存储；`[movie_with_bg]` 在视频 `play` 后 ~100ms 直写背景的迟到写入也纳入同一序号，被更新请求超越时会在 150ms 内纠正回最新背景。`wait=true` 的阻塞回调防御性放行，非背景预加载完全不受影响，不改 CSS 应用本身与 crossfade/wait 语义。适配器安装时及模组 hook 完成后的真正启动前都会确认包装。
- Host Tyrano 适配新增角色应用顺序保护：`tyrano-chara-guard.js` 按角色名对 `[chara_show]`/`[chara_mod]` 分配独立的 show/mod 序号，preload 回调落地时同名同类型的最新请求才允许应用；show 与 mod 分开计数，较新的 mod 不会取消仍在途的 show（show 负责创建角色元素并读取最新存储），避免 Android 冷热缓存差异导致表情/姿态倒挂。当前游戏数据经审计不存在同名角色显式 `wait=false` 且无阻挡的真实重叠调用，该保护为模组场景的防御性加固。
- 移动端存档/读取界面不再显示游戏自带的 `.button_smart` 滚动箭头：Host 适配器在 iframe 引导时注入仅作用于存档列表容器（`.area_save_list`）的隐藏规则；桌面端行为不变，回看界面（`.log_body` 滚动按钮）不受影响，不修改游戏模板或脚本。
- Firefox 标题循环兼容：`title_loop` / `bg_loop` 共用的 MSE 循环在创建音频 `SourceBuffer` 前先探测 `MediaSource.isTypeSupported('audio/mpeg')`，Firefox 不支持时降级为仅视频 MSE，并用普通 `<audio>` 元素以 Blob URL 播放标题 MP3（主段播完切循环段），音量每 50ms 镜像标题视频元素，设置中 BGM 滑条（写 `sf._system_config_movie_volume`）与退场淡出都会实时跟随；拆除时先暂停并摘除视频 `src` 再关闭 MediaSource，消除 Firefox 的 `NS_ERROR_DOM_MEDIA_CANCELED` / demuxer detached 报错。标题循环音频主段约 95.7 秒、循环段约 80.7 秒。
- 为 Safari 与 iOS 浏览器关闭旧 Tyrano 按 UA 将 `.ogg` 无条件改写为 `.m4a` 的逻辑：严格匹配 `kag.tag_audio.js`，把改写动作变为 no-op；归档中没有 M4A 时，Safari、iOS Chrome/Edge/Firefox 的 BGM、SE 与语音不再全部请求不存在的文件，直接使用 OGG。未知源码或模组覆盖保持原资源并产生可启动警告。
- 为移动端前景电影建立标签级输入锁：严格匹配的自定义 `[movie_with_bg]` 与 Tyrano 内置 `[movie]` 在标签开始即隐藏事件层（引擎 `hideEventLayer` 会同步置 `is_stop`），关闭“标签开始到 `canplay`”之间的提前点击窗口；所有完成路径统一汇入幂等 `finish()`，移除视频、恢复事件层并恰好推进一次，`skip` 与 `ended` 不再重复推进。背景电影（`bgmode`）保留原事件层行为，桌面分支不受影响；未知源码或模组覆盖保持原资源并产生可启动警告。
- Host Tyrano 适配新增通用异步 jump guard：在当前 jump `start()` 进入原有 1ms timer 前同步设置 `is_strong_stop=true`，让同一输入 burst 中的额外 `nextOrder()` 停在当前索引；原 `nextOrderWithLabel()` 继续负责解闸、场景加载和目标跳转。适配器安装时及模组 hook 完成后的真正启动前都会确认包装，且同步异常会恢复先前状态；不修改 `libs.js`、不全局去重 click/tap，也不依赖 `scene1.ks` 标签排列。
- Host Tyrano 适配新增事件层推进去重与点击特效时序修复：KAG 初始化完成后只移除 body 级 `.layer_event_click` 克隆上重复的 `tap` 推进绑定，使一次 touchend 恰好推进一次；并在事件层绑定前应用游戏自身最终版本的 tap 多边形（不 `preventDefault`、不掐 touchstart 冒泡），使对话推进点击恢复 tap_effect 波纹。letterbox 点击仍经游戏自身集合触发命中游戏内事件层，不合并 click/tap，也不修改按钮/选项/热区绑定。
- 增加严格版本匹配的第二层收藏列表移动端滚动补丁：角色与结局收藏共用的 `#collection_menu` 仅阻止 `touchmove` 继续冒泡，保留 Android Chromium 的原生纵向滚动；不修改 Tyrano 全局禁滚逻辑，未知插件覆盖保留原资源并产生可启动警告。
- iframe 导航现在只保留最新一笔 `load` 回调；被连续模组调整替换的准备会话进入待释放集合，由最终替换文档载入后统一释放。游戏重新载入会轮换 launch ID/token，并在占位页完成及延迟跳转前复核会话和重载代次，避免连续重载或重载后立即退出时旧回调重新写入 `srcdoc`。
- 游戏文档的存档实例固定记录所属 `document`，在 `pagehide` 时等待写前日志 flush 后显式关闭 IndexedDB；关闭流程幂等，flush 失败仍关闭旧连接并保留日志供下次恢复。
- 为浏览器存档增加版本化 localStorage 写前恢复日志：同步存档写入在返回前记录最新值或删除标记，IndexedDB 事务按日志版本串行提交，失败后保留并可重试；重新启动时日志和普通 fallback 均覆盖同名旧数据库值，全量替换使用 reset 标记防止已删除存档复活。内部日志不进入存档枚举或 ZIP/SAV 导出，只有对应事务成功后才清理。
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
