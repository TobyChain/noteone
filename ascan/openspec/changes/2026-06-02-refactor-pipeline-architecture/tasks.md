# Tasks: Refactor Pipeline Architecture

## Phase 1: 基础设施准备

### Task 1.1: 新建 `src/utils/html.py` [x]
- **文件**: `src/utils/__init__.py` + `src/utils/html.py`（新增）
- **操作**:
  - 创建 `src/utils/__init__.py`（空文件）
  - 创建 `src/utils/html.py`，从 `src/tools/report2md.py:15` 提取 `escape_html()` 函数
  - 替换三处调用方：`src/tools/report2md.py`、`src/tools/unified_report.py`、`src/github_agent/report.py`，改为 `from src.utils.html import escape_html`
  - 删除三处的本地 `_escape_html` 定义
- **验证**: `grep -rn "_escape_html" src/` 无输出；`.venv/bin/python -c "from src.utils.html import escape_html; print(escape_html('<b>test</b>'))"` 输出 `&lt;b&gt;test&lt;/b&gt;`

### Task 1.2: DB 连接池改为 NullPool + WAL [x]
- **文件**: `src/database/connection.py`（修改）
- **操作**:
  - `from sqlalchemy.pool import StaticPool` → `from sqlalchemy.pool import NullPool`
  - `create_engine(...)` 中 `poolclass=StaticPool` → `poolclass=NullPool`
  - 移除 `connect_args={"check_same_thread": False}`（NullPool 每线程独立连接,不需要此参数）
  - engine 创建后添加: `@event.listens_for(engine, "connect") def set_wal(dbapi_conn, ...): dbapi_conn.execute("PRAGMA journal_mode=WAL")` + `connect_args={"timeout": 30}`
  - 删除 `get_db()` generator 函数（无调用方）
- **验证**: `.venv/bin/python -c "from src.database.connection import get_engine; e = get_engine(); print(e.pool.__class__.__name__)"` 输出 `NullPool`

### Task 1.3: 导出 `RECOMMENDATION_ORDER` 常量 [x]
- **文件**: `src/core/scoring.py`（修改）
- **操作**:
  - 在模块顶部新增：`RECOMMENDATION_ORDER = {"极度推荐": 5, "很推荐": 4, "推荐": 3, "一般推荐": 2, "不推荐": 1}`
  - 替换 `src/pipeline/stages.py:218-220` 和 `src/core/query_engine.py:107-113` 中的本地定义为 `from src.core.scoring import RECOMMENDATION_ORDER`
  - `query_engine.py` 中如果排序语义相反（0=高），统一改为高=大的语义
- **验证**: `grep -rn "recommendation_order" src/` 只在 `scoring.py` 定义，其余为 import

---

## Phase 2: arXiv pipeline Stage 拆分

### Task 2.1: 重写 FetchStage — 吸收 RSS fallback + 429 退避 [x]
- **文件**: `src/pipeline/stages.py`（修改）
- **操作**:
  - 把 `main.py:96-191` 的 fetch 逻辑移入 `FetchStage.execute()`
  - `_RssEntry` 类从 `main.py` 移入 `src/pipeline/stages.py` 作为模块级类
  - `_configure_arxiv_client` 从 `main.py` 移入 `src/pipeline/stages.py` 作为模块级函数（删除 `main.py` 中的副本）
  - **关键修复**: `time.sleep(wait)` → `await asyncio.sleep(wait)`
  - 输出: `context.raw_ids`（list[str]）、`context._rss_entries`（list[RssEntry]）、`context.total_papers`
  - 在 FetchStage 顶部 `import asyncio, arxiv, requests, feedparser, re`
- **验证**: `main.py` 中不再有任何 fetch/RSS/429 相关代码

### Task 2.2: 重写 ParseStage — RSS 识别 + arxiv 元数据混合路径 [x]
- **文件**: `src/pipeline/stages.py`（修改）
- **操作**:
  - 吸收 `main.py:198-231` 的解析逻辑
  - 若 `context._rss_entries` 数量等于 `context.raw_ids` 数量，跳过 API 查询，直接用 RSS 数据
  - 否则调 `fetch_arxiv_metadata(ids)` 查 arxiv API
  - 将结果统一转为 `list[dict]` 格式写入 `context.parsed_papers`（包含 arxiv_id, title, authors, abstract, abs_url, pdf_url）
  - 现有的 `_save_to_db` 方法保留（不在 parse 阶段写 DB，此方法可能在后续被 AnalyzeStage 调用）
- **验证**: `context.parsed_papers` 格式统一，无论来源是 RSS 还是 API

### Task 2.3: 新建 ScoreStage [x]
- **文件**: `src/pipeline/stages.py`（修改，新增 class）
- **操作**:
  - 新建 `class ScoreStage(PipelineStage):`，`name="scoring"`
  - 吸收 `main.py:233-260` 的评分逻辑：构造 `MultiDimensionScorer` → 评分 → 过滤(≥30分, ≤15篇)
  - 输出: `context.scored_papers`（list[PaperScore]）、`context.selected_ids`（list[str]）
  - 日志: `📊 过滤结果: 原始 N 篇 → 相关 M 篇 → 精选 K 篇（上限 15）`
- **验证**: ScoreStage 可独立运行：构造一个含 `parsed_papers` 的 mock context，执行后 `context.scored_papers` 非空

### Task 2.4: 新建 AnalyzeStage — LLM 并发分析 + DB 写入 [x]
- **文件**: `src/pipeline/stages.py`（修改，新增 class）
- **操作**:
  - 新建 `class AnalyzeStage(PipelineStage):`，`name="analyzing"`
  - 吸收 `main.py:264-365` 的 LLM 分析 + DB 写入逻辑
  - **关键修复**: session 管理改为 `with DBSession() as db:`
  - 使用已有的 `llm_client.analyze_paper_async()` 并发路径
  - 内部的 `asyncio.gather(*tasks)` 已在上一次改动中实现，直接复用
- **验证**: 使用 mock LLM client 执行 AnalyzeStage，DB 中应有写入记录

### Task 2.5: 简化 main.py — pipeline 编排 [x]
- **文件**: `main.py`（大幅修改）
- **操作**:
  - `run_multi_dimension_pipeline()` 缩减为:
    ```python
    async def run_multi_dimension_pipeline(date=None, subjects=None):
        settings = get_settings()
        date = date or _compute_default_date(settings)
        subjects = subjects or settings.arxiv_subjects
        context = PipelineContext(date=date, subjects=subjects)
        stages = [FetchStage(), ParseStage(), ScoreStage(), AnalyzeStage(), GenerateReportStage()]
        for stage in stages:
            context.start_stage(...)
            ok = await stage.execute(context)
            context.end_stage(...)
            if not ok:
                break
        return context
    ```
  - 删除: `_RssEntry` 类、`_configure_arxiv_client` 函数、`use_llm` 参数、所有内联 fetch/parse/score/analyze 代码
  - 保留: CLI 模式（`--query`、`--hot`、`--direction`、`--scheduler`、`--init-db`）
  - `main.py` 应从 ~470 行缩减到 ~150 行
- **验证**: `.venv/bin/python -c "import main; print('import ok')"` 成功；`main.py` 行数 < 200

---

## Phase 3: 死代码清理

### Task 3.1: 删除 call_llm.py 死函数 [x]
- **文件**: `src/tools/call_llm.py`
- **操作**: 删除 `analyze_paper_batch()`（同步版，已被 `analyze_paper_batch_concurrent` 替代）、`translate_abstract()`、`get_client()` 和 `_default_client` 全局变量
- **验证**: `grep -n "analyze_paper_batch\b\|translate_abstract\|get_client\|_default_client" src/tools/call_llm.py` 无输出

### Task 3.2: 删除 *_markdown 别名函数 [x]
- **文件**: `src/tools/report2md.py`、`src/tools/unified_report.py`、`src/github_agent/report.py`
- **操作**: 删除 `papers_to_markdown()`、`build_unified_markdown()`、`repos_to_daily_markdown()` 这三个只是调另一个函数的别名
- **验证**: `grep -rn "to_markdown\|_markdown(" src/tools/ src/github_agent/report.py` 无输出

### Task 3.3: 删除死模型和死表 [x]
- **文件**: `src/models/schemas.py`、`src/database/models.py`
- **操作**:
  - `schemas.py`: 删除 `DailyReport` 和 `ProcessingState` 类
  - `models.py`: 删除 `UserFeedbackDB` 和 `ArxivSubjectStatDB` 类
  - `connection.py` 的 `init_database()` 中 `Base.metadata.create_all()` 会自动跳过已删除的表
- **验证**: `grep -n "DailyReport\|ProcessingState\|UserFeedbackDB\|ArxivSubjectStatDB" src/` 无输出

### Task 3.4: 删除 Pipeline 编排器类 [x]
- **文件**: `src/pipeline/core.py`
- **操作**:
  - 删除 `Pipeline` 类（含 `add_stage`、`run`、`progress_callbacks`、`_notify_progress`、`_notify_error`）
  - 保留 `PipelineContext`、`PipelineStage`、`Stage`(enum)、`Status`(enum)
- **验证**: `grep -rn "class Pipeline\b\|Pipeline(" src/ main.py main_daily.py main_github.py` 无输出

### Task 3.5: 清理 scheduler 和 query_engine 死代码 [x]
- **文件**: `src/core/scheduler.py`、`src/core/query_engine.py`
- **操作**:
  - `scheduler.py`: `DEFAULT_SCHEDULE` 中 `"subjects": ["cs.AI"]` 改为 `"subjects": get_settings().arxiv_subjects`（或删除整个 DEFAULT_SCHEDULE 如果 scheduler 本身不被使用——确认 `--scheduler` CLI 是否有人用）
  - `query_engine.py`: 删除 `add_feedback()` 方法（无调用方）
- **验证**: `grep -n "add_feedback" src/core/query_engine.py` 无输出

---

## Phase 4: web/app.py 修复

### Task 4.1: 修复 import 路径和异常处理 [x]
- **文件**: `web/app.py`
- **操作**:
  - 搜索 `from database.models import` → 改为 `from src.database.models import`
  - `bare except:` → `except Exception:`（约 2 处）
  - 去重 `import html`（只保留一处）
- **验证**: `.venv/bin/python -c "import web.app"` 无报错（或 streamlit 环境下验证）

---

## Phase 5: 端到端验证

### Task 5.1: 冒烟测试 [x]
- **操作**:
  - 删除 `logs/ascan_$(date +%Y%m%d).lock` 和 `docs/Ascan-$(date +%Y%m%d).html`
  - `.venv/bin/python main_daily.py --dry-run`
  - 确认 `docs/Ascan-YYYYMMDD.html` 生成，体积 > 10KB
  - 确认 `logs/ascan_daily_YYYYMMDD.log` 中可以看到 5 个 Stage 的日志（fetching → parsing → scoring → analyzing → generating）
  - 确认日志中**无** `vmsg`、`call_km`、`feishu` 字样
  - 确认**无** `time.sleep` 阻塞（429 退避应使用 asyncio.sleep）
- **验证**: 日报 HTML 正常打开，内容包含 arXiv 和 GitHub 两部分

### Task 5.2: 幂等 + 周末跳过验证 [x]
- **操作**:
  - 再次 `.venv/bin/python main_daily.py`（无 --dry-run）→ 应显示 `lock 已存在，跳过`
  - `./scripts/run.sh` → 应显示 `[skip] today's report already exists`

---

## 完成判定

- `main.py` 行数 < 200（从 ~470 缩减）
- `src/pipeline/stages.py` 包含 5 个 Stage class：Fetch、Parse、Score、Analyze、GenerateReport
- 零 `_escape_html` 本地定义（统一在 `src/utils/html.py`）
- 零 `StaticPool`（改为 `NullPool`）
- 零 `time.sleep` 在 async 函数中
- 零 bare `except:`
- 零死代码（Task 3.1-3.5 全部完成）
- 端到端冒烟通过
