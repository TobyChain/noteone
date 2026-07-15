# Ascan

一个基于 AI 的科技前沿日报工具，整合 arXiv 论文挖掘与 GitHub 项目追踪，每个工作日自动生成一份本地 HTML 日报。

做研究的朋友都知道，每天要跟踪的内容太多了，根本看不过来。Ascan 让 AI 帮你做第一轮筛选，你只需要看它觉得值得推荐的就行。

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![uv](https://img.shields.io/badge/package%20manager-uv-blue)](https://docs.astral.sh/uv/)

## 功能特性

- **arXiv 论文精选** — 自动抓取最新论文（支持多个分类，内置 429 退避与 RSS fallback），多维度评分筛选，LLM 翻译中文摘要
- **GitHub 项目挖掘** — 追踪 15 个主题方向的新兴热门项目，LLM 深度分析 Top 20
- **统一日报** — 两路内容合并为 `docs/Ascan-YYYYMMDD.html`，Notion 风格排版
- **并发加速** — LLM 调用 QPS=15 并发，4 篇论文从 4 分钟→1 分钟
- **定时调度** — macOS launchd，工作日 08:30 自动运行，休眠唤醒后补跑
- **幂等保护** — 同一天不重复生成，周末自动跳过
- **Web UI** — Streamlit 可视化浏览、搜索、筛选历史论文

## 项目结构

```
ai-agent-ascan/
├── main_daily.py              # 统一日报入口（推荐）
├── main.py                    # arXiv pipeline 入口
├── main_github.py             # GitHub pipeline 入口
├── requirements.txt
├── .env.example               # 环境变量模板
│
├── src/
│   ├── config/                # 配置管理 + 日志初始化
│   ├── core/                  # 评分系统 / 查询引擎 / 调度器
│   ├── database/              # SQLite ORM + 数据仓储
│   ├── github_agent/          # GitHub 抓取 / 分析 / 报告
│   ├── models/                # Pydantic 数据模型
│   ├── pipeline/              # 流水线框架 + arXiv 阶段
│   └── tools/                 # LLM 客户端 / HTML 报告生成
│
├── scripts/
│   ├── run.sh                 # 定时运行入口（launchd 调用）
│   ├── install_launchd.sh     # 一键安装 LaunchAgent
│   ├── uninstall_launchd.sh   # 一键卸载
│   └── launchd/               # plist 模板
│
├── web/app.py                 # Streamlit Web 界面
├── docs/                      # 生成的 HTML 日报
├── database/                  # SQLite（已 gitignore）
└── logs/                      # 日志（已 gitignore）
```

## 快速开始

### 1. 安装依赖

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh   # 安装 uv（如未安装）
uv venv && uv pip install -r requirements.txt
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入以下必填项：

| 变量 | 说明 |
|------|------|
| `IDEALAB_API_KEY` | IdealAb API Key（必填） |
| `GITHUB_TOKEN` | GitHub Personal Access Token（必填） |

其余配置均有默认值，详见 `.env.example` 中的注释。

> **注意**：pydantic-settings 不支持行内注释，`=` 后面不要写 `# 注释`。

### 3. 初始化数据库

```bash
.venv/bin/python main_daily.py --init-db
```

### 4. 运行日报

```bash
# 生成今日日报（默认取昨天的论文）
.venv/bin/python main_daily.py

# 指定日期
.venv/bin/python main_daily.py --date 20260601

# 跳过 lock 保护，强制重跑
.venv/bin/python main_daily.py --dry-run
```

### 5. 设置定时任务（推荐）

```bash
./scripts/install_launchd.sh
```

安装后每个**工作日 08:30** 自动运行，无需人工干预。

### 6. 启动 Web UI

```bash
.venv/bin/python -m streamlit run web/app.py
```

## 定时调度

### macOS — launchd（推荐）

```bash
# 安装
./scripts/install_launchd.sh

# 查看状态
launchctl list | grep com.ascan.daily

# 查看日志
tail -f logs/launchd_daily.err.log

# 卸载
./scripts/uninstall_launchd.sh
```

**行为说明**：
- **仅工作日运行**：周六/周日 launchd 触发后 `run.sh` 会直接跳过（arXiv 周末不发布）。
- 周一运行时默认取上周五的论文（"昨天"是周日 → 自动回退到周五）。
- 若 08:30 时电脑处于休眠/关机状态，唤醒后 launchd 会自动补跑一次。
- `run.sh` 内置幂等保护：当日日报已存在时静默跳过，不会重复生成。
- 迁移仓库目录后，请重新执行 `./scripts/install_launchd.sh`。

### macOS — cron（备选）

cron 在休眠期间**不会补跑**，仅适合常开机器：

```bash
crontab -e
30 8 * * 1-5 /path/to/ai-agent-ascan/scripts/run.sh
```

## 评分系统

基于关键词匹配 + 方向权重 + 机构识别，对每篇论文多维度打分：

- 每个方向独立打分（0-100），核心词 +30，次要词 +8，机构匹配 +15
- 推荐门槛：`极度推荐 ≥ 65` / `很推荐 ≥ 50` / `推荐 ≥ 38` / `一般推荐 ≥ 30`
- 日报精选：`≥ 30 分`，最多 15 篇

## LLM 调用

通过 **IdealAb OpenAI 兼容 API** 调用大模型：

- 接口：`/chat/completions`（`requests.post` 直调，不依赖 SDK）
- 模型：`Qwen3.6-Plus-DogFooding`（可通过 `.env` 切换）
- 并发：`Semaphore(15)` + `ThreadPoolExecutor(15)`，15 路并行
- 重试：内置 3 次重试 + fallback 兜底

## 日志

使用 `loguru`，按天轮转保留 30 天：
- 业务日志：`logs/ascan_daily_YYYYMMDD.log`
- 调度日志：`logs/launchd_daily.{out,err}.log`

## License

MIT
