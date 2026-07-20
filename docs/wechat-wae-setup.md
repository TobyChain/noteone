# 微信公众号抓取配置（基于 WAE）

NoteOne 的"新知"模块支持抓取微信公众号文章，作为 6 个子模块之一。本功能为**可选插件**——不配置时其余 5 个模块（arxiv / github / official / blog / conference）照常运行。

本方案基于 [wechat-article-exporter](https://github.com/wechat-article/wechat-article-exporter)（WAE），采用**原生 Node.js 部署，无需 Docker**。

## 工作原理

WAE 利用微信公众号后台编辑器"搜索其他公众号文章"的接口抓取指定公众号的全部历史文章。用户扫码登录自己的公众号后台（个人订阅号免费注册即可），WAE 服务端把 token + cookies 存到本地 KV 存储，给浏览器发 `auth-key` cookie。之后所有 API 请求带 `Cookie: auth-key=<...>`，WAE 据此代理转发到 `mp.weixin.qq.com`。

**Auth Key 有效期 4 天**，过期需重新扫码。

## 部署步骤

### 1. 克隆并启动 WAE

```bash
git clone https://github.com/wechat-article/wechat-article-exporter
cd wechat-article-exporter
corepack enable && corepack prepare yarn@1.22.22 --activate
yarn
PORT=3001 yarn dev
```

> 端口 3001 用于避让 NoteOne server 默认的 3000 端口。

### 2. 浏览器扫码登录

打开 http://localhost:3001 → 用手机微信扫码登录你的公众号后台。

### 3. 复制 auth-key

浏览器 DevTools（F12）→ Application → Cookies → `http://localhost:3001` → 复制 `auth-key` 的值。

### 4. 在 WAE 搜索目标公众号

在 WAE 网页里搜索公众号（如"老刘说NLP"、"Datawhale"），从搜索结果里复制 `fakeid`（形如 `MzI5MDQyMjg3MA==`）。

### 5. 在 NoteOne 设置面板填入

打开 NoteOne → 设置 → "新知 · 微信公众号抓取（可选）" section：

- **WAE 服务地址**：`http://localhost:3001`
- **WAE Auth Key**：粘上一步复制的 auth-key
- **公众号列表**（每行一个，格式 `fakeid|名称`）：
  ```
  MzI5MDQyMjg3MA==|老刘说NLP
  MzI5NjI4NTg3NQ==|Datawhale
  ```
- 点"测试连接" → 状态徽章应变绿，显示登录账号
- 点"保存"

### 6. 验证抓取

跟闹闹说"补充今日新知"，或直接命令行验证：

```bash
cd ascan
uv run python main_daily.py --module wechat --date $(date +%Y%m%d)
```

## 注意事项

- **必须有微信公众号**：个人订阅号免费注册即可。没有公众号无法用本功能。
- **Auth Key 4 天过期**：过期后状态徽章变橙，按上述步骤重扫 + 更新 auth-key 即可。
- **抓取频率**：WAE 调用微信接口有风控，ascan 每日一次安全；勿高频触发。
- **WAE 项目独立迭代**：若 WAE API 变更可能导致本集成失效，需跟进上游。
- **正文不抓**：当前实现只取文章元数据（标题/作者/链接/摘要），不抓正文 HTML。如需扩展，可在 `ascan/src/wechat_tracker/fetcher.py` 里对每篇文章 link 再发一次请求取正文。

## 故障排查

| 状态徽章 | 含义 | 处理 |
|---------|------|------|
| 灰：未配置 | WAE 地址或 Auth Key 为空 | 填写两个字段 |
| 绿：已就绪 | WAE 可达，auth 有效 | 无需处理 |
| 橙：Auth Key 失效 | auth-key 过期 | 重新扫码 + 更新 auth-key |
| 红：连接失败 | WAE 服务不可达 | 检查 `yarn dev` 是否在跑，端口是否对 |

## 不在当前方案中

- **WKWebView 嵌入扫码**：未来增强，可在 NoteOne 内直接扫码自动抓 auth-key
- **抓评论/阅读量**：需 WAE 的 credentials 抓包流程，不在本次
- **抓正文 HTML**：当前只取元数据，后续可扩展
