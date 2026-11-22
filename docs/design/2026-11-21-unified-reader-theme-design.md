# 统一阅读器与多主题设计（新知、往事、高见）

状态：设计定稿，待实施
日期：2026-11-21
范围：三模块阅读层统一、六套主题、文档内嵌可执行 cell、模块配置入口
前置调研：原生侧与 server 侧全量事实清单见本文引用的文件行号；srcbook 仓库（浅克隆于工作区）的执行模型已评估，本设计不引入其任何运行时代码。

## 1. 结论

1. 三模块统一为「内容片段 + 阅读器壳 + 主题表」：server 只产出内容片段（HTML 片段或原始文本），版式、主题、cell 执行全部集中在 app 侧的 `ReaderWebView` 与其注入的运行时脚本里。
2. 可执行 cell 在 WebView 内的沙箱 iframe 执行（`sandbox="allow-scripts"` 加 CSP 禁网），取代此前评估的「server 起子进程跑 Node」方案：无工作区目录、无依赖安装、无 stdout 协议，停止与超时即移除 iframe。
3. 主题是单一 JSON 表（12 色每套，共六套），原生界面与 WebView 内容共用同一份值；现状五套互不一致的强调色（原生蓝 #337AFF、日报紫 #6C47FF、Markdown 橙 #D96F3A、标注脚本紫、配置页系统蓝）全部收敛到这张表，defaultLight 承接暖纸橙血统。

## 2. 现状证据

| 问题 | 证据 |
|---|---|
| 三套渲染栈 | 新知整页 HTML 进 WKWebView（`apple/NoteOne/Sources/Views/NewLoreReportDetailView.swift:70`）；往事三分支（html/md 走 WebView、text 原生 LazyVStack，`NoteDetailView.swift:43-51`）；高见纯原生（`FarViewView.swift`） |
| 三套 WebView 包装 | `NewLoreWebView`（NewLoreReportDetailView.swift:357-409）、`WebView`/`WebViewMac`（ReportsView.swift:290-331）、`NewLoreConfigWebView`（Settings/NewLoreConfigSheet.swift:86-108） |
| 五套强调色、四套互不共享调色板 | REPORT_CSS 37 变量仅亮色（`server/src/services/newlore/pipeline/report.ts:10-59`）、MarkdownRenderer 暖纸橙（`Views/MarkdownRenderer.swift:18-24`）、标注脚本紫（`Services/NewLoreHighlightScript.swift:222-229`）、配置页系统蓝（`server/public/newlore/style.css:1-19`）、原生 Asset Catalog 蓝 |
| 深色覆盖 | 仅配置页有 `prefers-color-scheme`；日报、Markdown 预览、learn-art 笔记在系统深色下仍为白底 |
| 外网依赖 | Markdown 预览经 CDN marked（`MarkdownRenderer.swift:55`）、learn-art 模板经 CDN 加载 highlight.js 与 mermaid@10（`server/src/services/notty/resources/learn-art-template.html:8,243-244`），server 不可达或离线时不可用 |
| 高见无原生配置入口 | 高见仅有的 2 个配置项藏在新知网页配置页内（`server/src/services/newlore/config.ts:71-72`） |
| 原生消息桥已具备安全基线 | `NewLoreWebCoordinator` 已校验 `message.frameInfo.isMainFrame`（NewLoreReportDetailView.swift:315），子框架消息无法触达原生 |

## 3. 目标架构

```
server（内容生产者）                         app（呈现者）
┌──────────────────────────────┐           ┌────────────────────────────────────────┐
│ 内容片段                      │  HTTP API │ ReaderWebView（唯一 WebView 组件）        │
│  新知 buildBody：片段          ├──────────▶│  壳模板 + reader.css + 主题块 + runtime   │
│  高见 buildBody：片段          │           │  能力开关：标注 / cell / 外链策略          │
│  往事 text/md：原文            │           │ runtime（server 构建，app 取一次缓存）     │
│ reader/ 资产（新增）           │  静态托管   │  markdown 解析、text 分段、cell 渲染     │
│  themes.json（主题单一来源）   ├──────────▶│  与执行（沙箱 iframe）、chart 适配层      │
│  reader.css（版式单一来源）    │           │ ThemeStore（原生 token = themes.json）   │
│  runtime 源码 → esbuild → js  │           └────────────────────────────────────────┘
│ 落盘 renderPage：自包含导出    │
└──────────────────────────────┘
```

职责边界：server 管内容语义（片段结构与语义 class），app 管呈现（版式、主题、交互、执行）。现存的「server 产整页含样式」形态被取代。

## 4. 主题系统

### 4.1 Token 模型（每套 12 色）

| token | 用途 | 对应现状 |
|---|---|---|
| canvas | 页面底色 | Color("Canvas")、--canvas |
| surface | 卡片底色 | Color("CanvasSecondary")、--surface |
| ink、inkSecondary、inkTertiary | 主、次、弱文本 | 同名 |
| hairline | 描边与分隔 | 同名 |
| accent | 强调、链接、选中、tint | Color("Accent")、--primary |
| series[5] | 图表系列与 tag 维度色 | 现为系统 blue/green/orange/purple（Theme.swift:42-45） |

派生规则（无独立 token）：tag 底色 = series 12% 透明；代码块底 = ink 4% 叠 surface；标注高亮底 = accent 12%。

约束：ink、inkSecondary 对 canvas ≥ 4.5:1，inkTertiary ≥ 3:1，accent 对 canvas ≥ 3:1（链接文字加下划线辅助）；series 过数据可视化六项检查（明度带、色度下限、相邻对色觉区分度、正常视觉区分度、对 canvas 与 surface 均 ≥ 3:1）。

### 4.2 六套主题与取值

| id | 来源 |
|---|---|
| defaultLight | 暖纸调色板：底 #FBFAF6、纸卡 #F3EFE5、竹简橙 accent #D96F3A（继承 Markdown 预览的既有调色板与图标品牌，用户确认；与 One Light 拉开色温与色相双重差异） |
| defaultDark | 现 Asset Catalog 值原样迁入（Theme.swift 与 Assets.xcassets） |
| oneLight | Atom One Light 官方（背景 #FAFAFA、面板 #EAEBEB、文本 #424243） |
| oneDark | Atom One Dark 官方（背景 #282C34、文本 #ABB2BF；用户确认「One Black」即指此，内部 id 定名 oneDark），与 defaultDark 的近黑形成区分 |
| dracula | Dracula 官方（背景 #282A36、前景 #F8F8F2、紫 #BD93F9 为 accent） |
| forest | Everforest dark medium 官方（bg0 #2D353B、bg1 #343F44、前景 #D3C6AA、绿 #A7C080 为 accent） |

官方未定义的槽位（Dracula 的 surface 与次级文本、One Black 的次级文本对比度修正）按显式规则派生，全部数值与来源记录在 `server/reader/themes.json` 的字段注释与色值附录。

### 4.3 作用域与切换

- 原生：`ThemeStore`（@Observable 单例）持有当前 Palette；`Color.ink` 等 7 个静态常量改为读取它的计算属性（现 216 处引用零改动）；根视图 `.tint(palette.accent)` 加 `preferredColorScheme(palette.scheme)`（现入口 `NoteOneApp.swift:89` 单点保留）。
- 系统 chrome：macOS 侧边栏内容已是实底（`MainSidebar.swift:296` 叠 Color.canvas），工具栏加 `.toolbarBackground(palette.canvas, for: .windowToolbar)`；iOS tab bar 经 `.tint` 与明暗类别跟随。Dracula 等主题下 chrome 深浅随主题明暗类别，内容区完全主题化。
- WebView：app 在壳 `<head>` 注入六套主题变量块（`[data-theme="id"]{…}`，由 themes.json 生成）并设 `document.documentElement.dataset.theme`；切换主题只改属性，页面不重载（阅读位置与标注状态保留）。
- 选择器：外观分区改为「跟随系统 + 六套主题」，跟随系统时浅色用 defaultLight、深色用 defaultDark（现 `AppTheme` 三档语义保留，`appTheme` 存储键迁移）。
- 分发：themes.json、reader.css、runtime.js 统一由 server 静态托管于 `/reader/`，app 启动时取一次缓存于内存；`ThemeStore` 在 server 就绪前显示加载态（现启动/失败界面本就用系统色）。

## 5. 阅读器内核

### 5.1 文档模型与壳

```swift
struct ReaderDocument {
    enum Body { case html(String); case markdown(String); case text(String) }
    var title: String
    var body: Body
    var capabilities: Set<Capability> = [.cells, .externalLinks]   // .highlighting 仅新知
}
```

`ReaderWebView`（第 2 步合并日报与报告两套包装并新增片段壳，约 250 行；配置页包装在第 6 步随主题化并入）：壳 = `<head>`（reader.css + 主题块）+ body 内容；`loadHTMLString(shell, baseURL: nil)` 保持 null origin（沿用现安全姿态）；仅 html 变化时重载（沿用 NewLoreWebCoordinator.update 的 diff 语义，NewLoreReportDetailView.swift:281-288）；dismantle 清理沿用现写法（:348-353）；外链拦截沿用（:322-336）。

### 5.2 reader.css 与 runtime

- reader.css 由 REPORT_CSS 演化：保留版式与全部语义 class（.report-section/.card/.meta/.tag/.table-wrapper/.summary-block 等），颜色规则改用 12 个 token 引用，删除 `:root` 色值与 `color-scheme: light` 硬编码（report.ts:12-59），顺带删除死规则（.hero/.footer/.toc-entry-count）。
- runtime（`server/reader/runtime.ts`，esbuild IIFE 产物）职责：markdown 到 HTML（marked 18.x，MIT，本地化替代 CDN）；text 按空行分段；cell 化与执行；chart 适配层。app 以 `WKUserScript(atDocumentEnd)` 注入。
- 图表库选 Observable Plot（0.6.x，ISC，输出 SVG 可序列化、API 一行一 mark，适合作 chart(spec) 适配层后端）；ECharts 图型更全但输出 canvas，主题切换需整图重建，放弃。
- 日报片段保留其 TOC 内联脚本（report.ts:402-466）；大纲能力暂不推广到其他文档（见第 9 节）。

### 5.3 三模块接入

| 模块 | 迁移后 | server 改动 |
|---|---|---|
| 新知 | `GET /api/newlore/reports/:date` 的 html 字段从整页变片段；落盘文件仍经 `renderPage` 包壳保持自包含（导出行为不变） | buildUnifiedHtml 拆为 buildBody + renderPage |
| 往事 | text/md 原文交 ReaderWebView，runtime 端上转换；编辑态保持 TextEditor（主题 token 着色）；html 类型（learn-art）保持整页加载，第二阶段迁移 | 无 |
| 高见 | `GET /api/farview/overview` 新增 html 片段字段；原生 FarViewView 替换为 ReaderView；话题代表内容以 `<details>` 内联展开 | farview 新增 buildBody（复用 .card/.meta/.tag）；`GET /api/farview/topics/:id` 路由与原生模型随迁移删除（MCP 工具走 service 层，不受影响） |

## 6. cell

### 6.1 语法与类型（两种）

文档内 fenced code block 的 info string 首词为 cell 类型：

````markdown
```chart
{ "type": "bar", "title": "话题热度", "data": [{"x": "Diffusion", "y": 41}, …] }
```

```run js
const xs = [41, 27, 19];
chart({ type: "bar", data: xs.map((y, i) => ({ x: `t${i}`, y })) });
```
````

- `chart`（声明式）：spec 为 JSON，runtime 自动渲染，无需执行；server 产出的图表（高见热度、来源构成）与 AI 直接生成的图走此类。spec 只支持 4 种图型（bar、line、dot、stacked-bar），字段 6 个（type、title、data、x、y、color）。
- `run`（可执行）：JavaScript（ESM、顶层 await），运行按钮触发；沙箱内可用输出函数为 `chart(spec)`、`print(text)`、`show(html)`。

普通代码块（```js 等）保持纯展示，不执行。人写、盘存、AI 生成共用同一 fenced 语法，闹闹经 `generate_study_report` 或 MCP 写入 md 笔记即可产出 cell。

### 6.2 执行与安全

- 执行体：`<iframe sandbox="allow-scripts">` 加 srcdoc，内嵌 CSP `default-src 'none'; script-src 'unsafe-inline' blob:'`，硬性禁网（connect-src 无）。
- 通信：代码经父窗口 `postMessage` 送入，iframe 内 Blob URL 加 `import()` 执行；输出块 `{cellId, kind: chart|text|html|error|done, payload}` 经 `postMessage` 回传，父窗口校验 `event.source` 后渲染。
- 边界：10 秒超时与停止按钮均为移除 iframe；opaque origin 使 cell 无法访问父窗口与 `messageHandlers`；原生 handler 已有 `isMainFrame` 校验（NewLoreReportDetailView.swift:315）。
- 输出不落盘（重开文档时 chart cell 自动重渲、run cell 待手动运行），与 srcbook 的输出不持久化决策一致。

### 6.3 图表规范（chart 适配层统一保证）

系列色取主题 series（5 色，对应 5 种来源类型）；条形 ≤24px 厚、数据端 4px 圆角；堆叠段间 2px surface 间隙；文本一律文本 token；两系列以上必带图例，值经直接标注加 hover tooltip 加折叠数据表可达；主题切换时重绘（监听 data-theme 变更）。

## 7. 配置

- 阅读偏好（三模块共享，原生）：主题与正文字号（小、标准、大）已随主题系统实现，字号经 dynamicTypeSize 作用于界面文字、经 WKWebView pageZoom 作用于阅读内容；行宽（窄、标准、宽）留待 reader.css 落地后作用于最大宽变量。
- 模块配置入口（原生设置页「模块」分区）：新知与高见指向同一服务端配置页（`/newlore/`，高见带锚点定位其分区），补上高见缺失的原生入口；往事无独立配置项，其显示偏好由阅读偏好覆盖。
- 配置页主题化：`public/newlore/style.css` 的 7 变量改用阅读器同名 token，app 以 `WKUserScript(atDocumentStart)` 注入主题块；浏览器直开时回落 `:root` 默认值加 `prefers-color-scheme`（保留现有暗色能力）。

## 8. 行为差异清单（语义变更，需逐项接受）

1. 外观选择器从三档变为「跟随系统 + 六套主题」；跟随系统浅色的默认观感从系统灰白变为暖纸底加竹简橙（底色与强调色都变），日报紫 accent 在 default 下变橙，One Light 与其余主题按官方色板。
2. 往事纯文本笔记从原生段落渲染改为阅读器渲染：不连续段落勾选复制改为系统连续文本选择复制。
3. 高见从「榜单列表 + 话题详情页」变为单份可折叠报告；话题下钻导航消失。
4. tag 维度色与系统控件 tint 从系统色改为主题 token。
5. Markdown 预览的暖纸橙配色消失，改用主题；marked 从 CDN 变本地（离线可用性改善）。
6. 导出的日报 HTML 内嵌六套主题块（约增 15KB），默认跟随打开环境的系统明暗。
7. 往事 html 类型笔记（learn-art 产物）本期不迁移，主题与其暖纸样式暂不一致（第二阶段）。

## 9. 未纳入（明确出界）

- 轮询 Timer 去重（6 处）与日期分组去重（3 处）：与显示需求无关，按工作区规范不做热心清理；仅在被重写文件内自然消除。
- 大纲（TOC）推广到往事与高见文档；learn-art 模板迁移与 mermaid 本地化；往事与高见的划选标注（存储未实现）；闹闹聊天面板内嵌 cell；iOS 远程 server 连接（现状 iOS 硬编码 localhost:3000 且无拉起逻辑，本次不解决）。
- 每日报告（DailyReport，iOS 遗留 4 风格）不动。

## 10. 实施顺序（每步独立可验证）

1. （已完成）主题系统：themes.json、ThemeStore、Color 常量改造、设置页选择器、tint 与 toolbarBackground、删除 Asset Catalog 8 个颜色集。验证：六套主题下原生界面与系统 chrome 表现、启动加载态。
2. （已完成）阅读器内核：ReaderWebView 合并三套包装、reader.css、日报片段化（buildBody + renderPage）、主题块注入。验证：日报六主题显示、标注桥与外链行为不变、导出文件浏览器打开自包含。
3. 往事接入：text/md 进阅读器，删除 MarkdownRenderer 与原生 text 分支。验证：三类笔记显示、编辑保存、md 预览离线。
4. 高见接入：片段化与 ReaderView 替换。验证：报告内容与图表、刷新轮询仍可用。
5. cell：runtime 构建（marked、图表库、chart 适配层、沙箱执行器）、md 中两种 cell。验证：chart cell 六主题渲染、run cell 执行与超时停止、禁网。
6. 配置：配置页主题化、模块配置入口、行宽偏好（字号偏好已在第 1 步实现）。验证：配置页主题一致、高见入口可达。

每步完成后同步 `docs/ARCHITECTURE.md`。

## 11. 取舍记录

- cell 执行位置（WebView 沙箱替代 server 子进程）：后者需工作区目录、npm 依赖管理、stdout 富输出协议与超时治理，且 srcbook 自认零沙箱为已知缺陷（其 DECISIONS.md #10）；前者以 iframe 沙箱获得真实边界，部件数量约为其三分之一。代价：cell 语言限 JavaScript（TS 支持可后续经转译器增量加入）。
- 主题表分发（server 托管 + app 内存缓存，替代 app bundle 内置）：免去 XcodeGen 外部资源引用与构建产物入库；app 全部内容本就依赖本机 server，未引入新的可用性依赖。
- 日报 API 返回片段（内部契约变更）：唯一消费方为 app 与两处剥离 `<style>` 的代码（`server/src/mcp.ts:269`、`server/src/services/newlore/reports.ts:114`），片段化使后者简化；对外导出物（ZIP 内 HTML）保持自包含。

## 附：色值与来源

数据文件：`server/reader/themes.json`（六套全部 token 的最终值）。全部文本对比度与系列色验证由脚本计算，非目测；调优工作数据与逐项来源记录留存于 /tmp/noteone-theme-tuning/（含 Atom 官方源文件下载件），实施时如需复查可重跑。

### 文本 token 对 canvas 的对比度（WCAG 2.1）

| 主题 | ink | inkSecondary | inkTertiary | accent |
|---|---|---|---|---|
| defaultLight | 16.13 | 9.80 | 4.44 | 3.20 |
| defaultDark | 15.63 | 6.38 | 3.45 | 5.45 |
| oneLight | 9.62 | 5.01 | 3.13 | 3.96 |
| oneDark | 6.57 | 4.54 | 3.07 | 4.33 |
| dracula | 13.36 | 7.01 | 4.52 | 5.90 |
| forest | 7.38 | 5.12 | 3.84 | 6.23 |

全部达标（ink 与 inkSecondary ≥ 4.5，inkTertiary ≥ 3.0）。

### 派生与修正值（其余均为官方原值）

- defaultLight 整套继承 Markdown 预览的既有暖纸调色板（`Views/MarkdownRenderer.swift:19-21` 的 ink、ink-2、ink-3、paper、paper-2、line、accent 一一对应，用户确认 Default 浅色走暖纸橙，与 One Light 拉开区分度）；系列首色橙 #D96F3A 压暗 3% 为 #D26C38，以满足对 surface ≥ 3:1。
- dracula surface #21222C：官方未定义，取 canvas 同色相同饱和度、明度 18% 降到 15%；inkSecondary #B5B6B6 与 inkTertiary #909194：ink 与 canvas 按 alpha 0.68 与 0.50 混合（对比度 7.01 与 4.52）。
- oneDark inkSecondary #8D93A0、inkTertiary #6E7687：官方 mono-2 #828997（3.98:1）与 mono-3 #5C6370（2.32:1）不足，保持色相饱和度逐级提亮到达标；hairline #353B45：官方 base-border #181A1F 比两层底色都暗、作分隔线不可见，改用官方 @level-1-color。
- 系列色：系列色保持官方色相、按明度带（浅色 0.43 到 0.77、深色 0.48 到 0.67）与色度下限 0.10 调整。default 两套源于 iOS 系统色（developer.apple.com/design/human-interface-guidelines/color）；oneLight 与 oneDark 源于 Atom 官方 hue 值；dracula 与 forest 官方语法色全部偏亮，全部降明度入带。

### 系列色验证结论与已知边界

六套主题 5 色对各自 canvas 与 surface 均通过全部检查（无 FAIL、无 WARN）；最差相邻对色觉区分度：defaultLight 15.2、defaultDark 17.8、oneLight 18.5、oneDark 15.4、dracula 14.5、forest 8.9。

已知边界（穷举确认是约束下最优）：oneDark 的青与蓝、forest 的橙与绿、defaultLight 的绿与橙（全对 deutan 5.8）等非相邻对在折线交叉等任意位置相邻的图型中区分度不足。chart 适配层据此规定：折线与散点图系列数 ≤ 3 且强制端点直接标注；堆叠与条形（只有相邻接触）不受限。

### 运行时依赖版本

marked 18.2.1（MIT）、@observablehq/plot 0.6.19（ISC）。
