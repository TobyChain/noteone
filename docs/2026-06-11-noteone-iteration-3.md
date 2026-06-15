# NoteOne 迭代 3 实施记录(P1 多模态捕获闭环)

> 日期:2026-06-11
> 依据:`docs/2026-06-11-noteone-code-review.md` 第 4 节路线图(迭代 3)
> 验证:server `tsc` 通过;**macOS 与 iOS 两端 xcodebuild 均 BUILD SUCCEEDED(含 Share Extension)**

---

## 一、B4/F1 — 图片上传闭环

### 服务端
- 新增 `server/src/routes/uploads.ts`:`POST /api/uploads/image`(multipart,字段名 `file`),`multer` 磁盘存储,UUID 文件名,mime 白名单(png/jpeg/gif/webp/heic/heif),单文件 ≤10MB;multer/校验错误转 400。
- `server/src/index.ts`:`/uploads` 静态服务(UUID 文件名,URL 不可枚举),`/api/uploads` 挂 `requireAuth`。
- `server/src/services/pipeline.ts`:`image`/`video` 类型笔记**跳过 URL 抓取**(sourceUrl 指向媒体本身而非可抓取网页),避免被误判 `failed`。
- 依赖:`multer` + `@types/multer`;`.gitignore` 忽略 `server/uploads/`。

### 客户端
- `APIClient.uploadImage(data:mimeType:fileName:)`:手写 multipart 上传,返回**绝对 URL**(`baseURL + /uploads/xxx`),便于直接渲染。
- `CaptureView`:新增图片状态/预览/删除;`pasteFromClipboard()` 读取剪贴板图片(png/tiff→png);保存时若有图片先上传再建 `image` 笔记(`sourceUrl=图片URL`,`content=标题或"[图片]"`);图片笔记不进离线队列(上传需联网)。
- `NoteDetailView`:`image` 笔记用 `AsyncImage` 渲染(加载中/失败态)。
- iOS Share Extension(`ShareViewController`):图片改为读取 `Data`→写入 App Group 容器 `NoteOne/share-images/<uuid>.png`→`pendingNotes` 写 `imagePath` 条目 + 预览。
- `SyncQueue`:新增 `imageQueue`(持久化 `image_queue.json`);`drainSharedPending` 识别 `imagePath` 条目;`flush()` 先上传图片文件→建 `image` 笔记→成功后删文件,再处理文本队列。

## 二、B11 — macOS 取词稳健化
- `HotkeyManager.captureSelection()`(替代 `captureSelectedText`):
  - 合成 Cmd+C 后**轮询 `changeCount`**(20ms 间隔,最长 0.6s)替代固定 100ms sleep,适配慢应用;
  - 同时抓取剪贴板**图片**(png/tiff→png),回填到捕获面板;
  - 新增 `ensureAccessibilityPermission()`:无辅助功能权限时 `AXIsProcessTrustedWithOptions` 提示并引导;
  - 完成后恢复用户原剪贴板。

## 三、F2(部分)— 拖拽接收
- `CaptureView` 增加 `.onDrop`(图片/链接/纯文本):拖入图片→预览待存;拖入链接→回填来源+内容;拖入文本→回填内容;拖拽时高亮边框。
- 说明:**完整的 iOS"长按片段向上滑动即记"系统手势**(设计 §2.3)依赖系统拖拽源/分享面板,属较大交互设计项,留待后续专项迭代;本轮先打通"作为拖拽目的地接收"的能力。

---

## 四、验证状态

| 项 | 状态 |
|----|------|
| server `npx tsc --noEmit` | ✅ exit 0 |
| `npm install`(multer 等) | ✅ |
| **xcodebuild NoteOne_macOS** | ✅ BUILD SUCCEEDED |
| **xcodebuild NoteOne_iOS(含 ShareExtension)** | ✅ BUILD SUCCEEDED |

> 构建期捕获并修复 1 处 Swift 6 并发错误:`kAXTrustedCheckOptionPrompt` 全局 CFString 非 Sendable,改用字面量 key `"AXTrustedCheckOptionPrompt"`。

---

## 五、后续注意 / 仍待办

1. **图片静态服务为公开 URL**(UUID 不可枚举但无鉴权):如需严格私有,后续可改为带签名的鉴权下载或 OSS 私有桶 + 临时签名。
2. **AI 对图片无视觉理解**:`image` 笔记的摘要/标签基于占位文本,质量有限(设计选用低成本文本模型);如需图像理解需接入多模态模型(成本上升)。
3. **视频**:本轮仅打通图片;视频仍仅存链接。
4. 未纳入(后续迭代):F2 完整 iOS 手势、F3 引用闭环/作者抽取、F4 用户级 LLM Key、F5 混合检索、B7 聊天压缩事务化、B9 客户端 401 自动登出、S8 生产 HTTPS/ATS 收紧、F7 测试补齐。
