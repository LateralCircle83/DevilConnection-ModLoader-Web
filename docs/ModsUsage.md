# DevilConnection ModLoader (Rebuild) 模组开发规范

> 面向模组作者。本文档说明模组的目录形态、`mods.json` 元信息规范、GitHub 自动更新渠道、模组工坊收录、运行时 API 与常见坑。
> 适用于 **DevilConnection_ModLoader Rebuild 分支**（王柴维护）。基础机制兼容官方 DC_ML，但自动更新/工坊/配置系统为本分支特性。

---

## 1. 模组形态

- 模组 = **单个 `.asar` 文件**，放进游戏 `resources/plugins/` 目录。
- **只加载 `plugins/*.asar`**：目录、其它后缀一律不识别。
- **禁用** = 文件重命名为 `xxx.asar.disable`（不以 `.asar` 结尾即不被扫描）。管理器的启停按钮会自动重命名。
- **加载顺序** = 文件名可带 `NNN_` 数字前缀（如 `005_dc_theatre.asar`），数字越小优先级越高。管理器拖拽排序会写 `plugins/mods.config.json` 的 `order`。
- **内置模组**（`resources/insidemods/*.asar`）= 加载器自带、强制最高优先级、不在模组列表显示（如「模组工坊」本体）。第三方模组不涉及此目录。

### 推荐 asar 内部结构
```
你的模组.asar
├── mods.json            ← 必需：模组元信息（见 §2）
├── hook.js              ← 可选：注入渲染进程的脚本（见 §5）
├── config.schema.json   ← 可选：配置界面 schema（见 §7）
└── data/                ← 可选：覆盖/新增游戏资源（.ks 场景、图片等）
    └── ...
```

---

## 2. `mods.json`（模组元信息，asar 根目录）

无 `mods.json` 的模组仍能加载，但管理器会显示文件名 + 黄字警告「此模组未尝试兼容本加载器!可能会有异常表现!」。**强烈建议提供**。

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `name` | string | ✅ | 模组显示名 |
| `description` | string | 推荐 | 一句话简介 |
| `version` | number | ✅ | **数字验证版本号**，升降级判定的唯一依据（如 `120`）。每次发版必须递增 |
| `displayVersion` | string | 推荐 | 显示版本号（如 `"1.2.0"`），列表徽章用；缺省显示 `v<version>` |
| `id` | string | 可选 | 稳定身份（kebab-case）；缺省回退去前缀去后缀的文件名（bareName） |
| `minLoaderVersion` | number | 可选 | 要求的最低加载器版本（`loaderVersion` 数字）。高于当前 → 管理器红徽章「需更新加载器」+ 不注入 |
| `dependencies` | object | 可选 | 依赖/冲突声明（见 §8） |
| `update` | object | 可选 | GitHub 自动更新渠道（见 §3） |

### `version` 与 `displayVersion` 的关系
- `version` 是**整数**，只用来比大小（远端 > 本地 = 有更新）。约定用显示版本去点拼成整数，如 `1.2.0` → `120`、`1.1.3` → `113`。自己保持规则一致即可。
- `displayVersion` 是给人看的字符串，随便你写（`"1.2.0"` / `"v1.2-beta"` 等）。

### 示例
```json
{
	"name": "库皮哒呀小剧场",
	"description": "登上小剧场舞台，与库皮亚和德比伦即兴聊天互动！",
	"version": 120,
	"displayVersion": "1.2.0",
	"id": "dc_theatre",
	"update": {
		"source": "github",
		"repo": "Luoyu-Wangchai/DevilConnection_Theatre"
	}
}
```

---

## 3. GitHub 自动更新渠道

让你的模组能在管理器「模组」页显示更新徽章、被用户一键更新，并出现在工坊。

### 3.1 `mods.json` 的 `update` 段
```json
"update": {
	"source": "github",
	"repo": "你的用户名/仓库名"
}
```
只需 `source: "github"` + `repo`。**不需要**再写 asset/manifest 字段（走固定约定，见下）。

### 3.2 `mod.update.json`（仓库 main 分支根目录）——版本清单

在你的**模组仓库 `main` 分支根目录**放一个固定名文件 **`mod.update.json`**：
```json
{
	"version": 120,
	"displayVersion": "1.2.0",
	"tag": "V1.2.0",
	"asset": "dc_theatre.asar"
}
```
| 字段 | 说明 |
|---|---|
| `version` | 数字，与该版本 `mods.json.version` 一致——加载器用它和用户本地版本比大小 |
| `displayVersion` | 显示版本串 |
| `tag` | 对应的 GitHub release 标签 |
| `asset` | 该 release 里 `.asar` 资产的文件名 |

> **为什么要这个文件**：加载器检测/下载**全部走 `raw.githubusercontent.com/<repo>/main/mod.update.json` 与 `releases/download/...` 直链**（GitHub CDN，几乎无限流），而不是 `api.github.com`（匿名限 60 次/小时/IP，多模组时很快打满，表现为"版本未知/检测失败"）。这个清单文件就是 raw 检测的数据源。

### 3.3 发布新版本的完整流程
1. 改 `mods.json.version`（递增）+ `displayVersion`，打包 `你的模组.asar`。
2. 在模组仓库发一个 **GitHub Release**（打 tag，如 `V1.2.1`），上传 `你的模组.asar` 作为资产。
3. 更新仓库 `main` 分支的 **`mod.update.json`**：把 `version`/`displayVersion`/`tag`/`asset` 改成新版本的值，commit + push。
4. 完成。用户在管理器「模组」页或「工坊」会看到「检测到更新」，点更新即自动下载安装（下次启动游戏生效）。

> ⚠️ **第 3 步不能漏**——只发 release 不更新 `mod.update.json`，加载器仍读到旧版本号，不会提示更新。

---

## 4. 模组工坊收录（store.json）

工坊 =「模组」页下方的社区商店页，实时拉取 DCML 主仓库的 `store.json` 展示收录模组，用户可直接下载/更新。

- **收录方式**：联系王柴，把你的模组条目加进主仓库 `store.json`。条目格式：
  ```json
  { "id": "dc_theatre", "name": "库皮哒呀小剧场", "desc": "简介", "author": "作者名", "repo": "owner/repo" }
  ```
  - `id` 需与已装模组的 bareName 匹配（用于识别"已安装/可更新"）。
- **前提**：你的仓库已按 §3 提供 `mod.update.json` 与 release 资产，工坊才能检测版本、提供下载。
- 工坊「历史版本」功能会列举仓库所有 release（这一处走 API，属低频操作）。

---

## 5. `hook.js`（渲染进程注入脚本）

- 每个模组的 `hook.js` 在**游戏 preload 阶段、页面脚本之前**按优先级顺序注入主世界（渲染进程）。
- 页面 reload（读档/重启）后自动重注入。
- 典型用途：hook 游戏对象（`TYRANO.kag.*`）、加自定义 UI、改行为。
- **幂等**：用 `if (window.__你的标志) return; window.__你的标志=true;` 防重复注入。
- 顶层若直接碰 DOM，注意 document-start 时 `body` 可能为 null（包装器会在 `DOMContentLoaded` 重试一次）。

---

## 6. DCML 运行时 API（`window.DCML`）

由内置模组「模组工坊」在最早注入，第三方模组 hook 可直接使用。

### 6.1 `DCML.registerEntry(entry)` — 登记到「模组工坊」书页
```js
if (window.DCML && DCML.registerEntry) {
	DCML.registerEntry({
		id: 'dc_theatre',
		title: '库皮哒呀小剧场',
		icon: './data/image/logo.png',   // 缺省用 404 占位图
		desc: '一句话介绍',
		version: 'v1.2.0',                // 显示版本串
		enabled: () => true,              // 返回 false → 格子灰显不可点
		onOpen: () => { /* 点击后执行，如 jump 到你的场景 */ }
	});
}
```
- **不传 `onOpen`** = 纯展示条目（灰化、不可点、自动沉底）。
- 双模兼容：探测不到 `window.DCML` 时（官方 DC_ML 环境），自行回退到你自己的入口注入方式。

### 6.2 版本查询
- `DCML.loaderVersion` — 加载器数字版本（`loaderVersion`），可与 `mods.json.minLoaderVersion` 对比。
- `DCML.loaderVersionText` — 显示版本串（如 `BRV1.2.8`）。

---

## 7. 配置系统（`config.schema.json`）

让模组在管理器里有「配置」按钮 + 现代化配置界面。

- 模组根目录放 `config.schema.json`：
  ```json
  {
	"title": "模组设置",
	"description": "说明",
	"fields": [
		{ "key": "api_key", "label": "API Key", "type": "password", "required": true },
		{ "key": "enabled", "label": "启用", "type": "toggle", "default": true }
	]
  }
  ```
  `type` 支持 `text | password | number | toggle | select`（select 需 `options`）。
- 配置存 `plugins/config/<bareName>.json`（在 asar 外，改显示名/优先级不影响绑定）。
- 模组侧读取：
  ```js
  const p = window.electronAPI.joinPath(window.api.returnAppPath(), '..', 'plugins', 'config', '<bare>.json');
  // existsSync / readFileSync 现读（改配置无需重启游戏）
  ```

---

## 8. 依赖 / 冲突声明（`dependencies`）

`mods.json` 可声明与其它模组的关系，加载器会检测并给出徽章/阻断：
```json
"dependencies": {
	"requires":          [ { "id": "other-mod", "minVersion": 100, "reason": "..." } ],
	"optionalRequires":  [ "some-mod" ],
	"requiresAfter":     [ "must-load-before-me" ],
	"optionalLoadAfter": [ "prefer-before-me" ],
	"conflicts":         [ "incompatible-mod" ]
}
```
- 条目可是字符串（模组 id）或对象 `{ id, minVersion, reason }`。
- 缺硬前置 / 版本不足 / 冲突 → 管理器红徽章，该模组**不注入**。
- 顺序类问题（应更靠前/后）→ 黄徽章提示，可点「自动修复顺序」。

---

## 9. 资源约定与常见坑

- **图片路径 404 兜底**：模组被删后，存档里引用的该模组图片会被加载器替换为占位图（不再弹「画像ファイル…が見つかりません」）。但请尽量不要把模组专属图片写进玩家存档。
- **新增 `.ks` 场景**：直接放 `data/scenario/xxx.ks`，`[jump xxx.ks]` 即可加载（ModLoader 的文件映射天然支持新增文件）。
- **覆盖游戏资源**：`data/` 下同名文件会覆盖游戏原文件（汉化/换图/改脚本即此原理）。
- **`.asar` 文件操作**：Electron 的 fs 会把 `.asar` 当目录拦截——涉及读写/改名 `.asar` 真实文件时必须用 `original-fs`（这是加载器内部的事，模组作者一般不碰）。
- **版本号务必递增**：`mods.json.version` 与 `mod.update.json.version` 必须同步递增，否则更新检测失效。

---

## 10. 版本号速查

| 概念 | 位置 | 用途 |
|---|---|---|
| 模组 `version`（数字） | `mods.json` / `mod.update.json` | 升降级判定 |
| 模组 `displayVersion` | 同上 | 显示 |
| 加载器 `loaderVersion`（数字） | 加载器 `version.json` | `minLoaderVersion` 对比 |
| 加载器 `shellVersion`（数字） | 加载器 `version.json` | 加载器自身是否动了核心壳（与模组无关） |

---

有疑问或想收录进工坊，联系王柴。
