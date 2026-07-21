# Ascan — 新知 Python Pipeline（⚠️ 已弃用）

> **本目录已弃用**：新知 pipeline 已完整移植为 TypeScript 并入 NoteOne server
> （`server/src/services/ascan/pipeline/`），server 通过进程内调用运行，不再 spawn Python。
> 配置仍以 `config.schema.json` + `.env` 为单一事实源（TS/Python 共用）。
> 本目录保留作历史参考与移植对比验证。

> 每日扫遍 arXiv、GitHub、官方动态、独立博客、会议论文、微信公众号，LLM 筛选翻译，汇成一份科技前沿日报。

## 模块

| 模块 | 数据源 | 时效过滤 | 跨模块去重 |
|------|--------|---------|----------|
| arxiv | arXiv RSS + API（cs.AI/IR/CL/MA/CV 等） | 按发布日期抓取 + DB 跨日去重 | DOI 作为 Conference 去重源 |
| github | GitHub Trending + Topics Search + README/文件树 | 无（Trending 自带新鲜度） | 无 |
| official | Anthropic sitemap + DeepMind sitemap | 30 天 cutoff | URL 作为 Blog 去重源 |
| blog | RSS 订阅（阮一峰/LilianWeng/Sebastian 等） | 30 天 cutoff | 跳过已在 official 的 URL |
| conference | Semantic Scholar + DBLP（CCF A/B 类会议） | `CONFERENCE_DAYS_RECENT`（默认 90 天） | 跳过 DOI 已在 arxiv 的论文 |
| wechat | NoteOne server 内置微信服务 (`/api/wechat/mp/articles`) | `WECHAT_DAYS_RECENT`（默认 30 天） | article_id DB 去重 |

每个模块独立运行 + 持久化片段到 `logs/fragments/{date}/{module}.html|.md`，merge 阶段合并为最终日报 `docs/Ascan-{date}.html|.md`。

## 快速开始

```bash
cd ascan
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env   # 填 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / GITHUB_TOKEN 等

# 跑全部 6 个模块 + 合并日报（并发）
python main_daily.py

# 单跑某模块
python main_daily.py --module arxiv --date 20260720
python main_daily.py --module wechat --date 20260720

# 只合并已跑模块的片段
python main_daily.py --merge --date 20260720

# 列出所有模块
python main_daily.py --list-modules
```

## 配置

所有配置在 `.env` 文件，字段含义见 `.env.example` 注释。关键字段：

| 字段 | 说明 |
|------|------|
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | LLM 凭据（OpenAI 兼容） |
| `LLM_MAX_CONCURRENCY` | LLM 并发上限（默认 5） |
| `GITHUB_TOKEN` | GitHub PAT（需 public_repo read） |
| `ARXIV_SUBJECTS` | arXiv 分类列表 |
| `WECHAT_SERVICE_URL` / `WECHAT_AUTH_KEY` | NoteOne server 地址 + 扫码登录的 auth-key（4 天过期，扫码成功后自动写入） |
| `WECHAT_MP_IDS` | 公众号列表 `[{"id":"<fakeid>","name":"..."}]` |
| `WECHAT_DAYS_RECENT` / `CONFERENCE_DAYS_RECENT` | 时效过滤窗口 |

微信抓取已内置于 NoteOne server，在 App「设置 → 微信公众号」中扫码登录并添加订阅即可。

## 数据库

ascan 使用独立的 PostgreSQL schema（与 NoteOne server 共享 `DATABASE_URL`），表前缀 `ascan_*` 避免 conflict：

- `papers` — arXiv 论文 + LLM 分析
- `github_repos` — GitHub 仓库 + 增量追踪
- `official_items` — 官方动态
- `blog_posts` — 博客文章
- `conference_papers` — 会议论文
- `wechat_articles` — 微信公众号文章
- `ascan_daily_reports` — 日报元数据

初始化：`python main_wechat.py --init-db`（或任意 `main_*.py --init-db`）。

## 文档

- [AUTOMATION_FLOW.md](AUTOMATION_FLOW.md) — launchd 定时任务 + 钉钉上传流程
- [CHANGELOG.md](CHANGELOG.md) — 版本变更
- [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) — 整体架构

## 与 NoteOne server 的协作

NoteOne server 通过 `child_process.spawn` 调起 Python pipeline：

- `POST /api/ascan/trigger` — fire-and-forget 全量跑
- `POST /api/ascan/run-module` — 闹闹编排时单模块跑（blocking）
- `POST /api/ascan/merge` — 合并已跑模块片段
- `GET /api/ascan/status` — 查询运行状态
- `GET /api/ascan/wechat-health` — 探活 WAE 服务

spawn 时会从 `process.env` 删掉 `DATABASE_URL` 防止 server 的连接串泄漏给 Python 子进程（pydantic-settings 优先读 env，会导致 dialect 不匹配）。

## License

MIT
