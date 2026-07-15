# Design: Refactor Pipeline Architecture

## Context

`main.py` 有 ~470 行，其中 ~250 行是 `run_multi_dimension_pipeline()` 内联的 fetch/parse/score/analyze 逻辑。`src/pipeline/stages.py` 定义了 `FetchStage`/`ParseStage`/`GenerateReportStage`，但 `main.py` 只用了 `ParseStage.fetch_arxiv_metadata()` 这一个方法，其余全部绕过。`Pipeline` 编排器虽然存在但从未被任何入口调用。

目标：让 `main.py` 回到「组装 Stage → Pipeline.run(context)」的标准路径，消除代码分叉，同时修复审查发现的 Critical 级问题。

## Decision 1: arXiv pipeline 拆分为 5 个 Stage

**选择**：

```
FetchStage → ParseStage → ScoreStage → AnalyzeStage → GenerateReportStage
```

每个 Stage 职责：

| Stage | 输入 | 输出（写入 context） | 关键逻辑 |
|-------|------|---------------------|----------|
| `FetchStage` | `context.date`, `context.subjects` | `context.raw_ids`, `context._rss_entries` | arXiv API + 429 退避(`asyncio.sleep`) + RSS fallback |
| `ParseStage` | `context.raw_ids`, `context._rss_entries` | `context.parsed_papers` (list of dict) | 若全部来自 RSS 则跳过 API 查询；否则调 arxiv lib 查元数据 |
| `ScoreStage` | `context.parsed_papers` | `context.scored_papers`, `context.selected_ids` | `MultiDimensionScorer` 评分 + 过滤精选(≥30分, ≤15篇) |
| `AnalyzeStage` | `context.scored_papers`, `context.parsed_papers` | 写入 DB (ArxivPaper + PaperAnalysis) | LLM 并发翻译(Semaphore 15) + DB 写入(context manager) |
| `GenerateReportStage` | DB 中已分析的论文 | `context.arxiv_html` | 从 DB 读取 → HTML 片段生成 |

**为什么**：
- 每个 Stage 可独立测试（mock context 即可）。
- `main.py` 只需组装 stages 列表并调 `Pipeline.run()`，不到 30 行。
- RSS fallback 和 429 退避逻辑收进 `FetchStage`，不再泄漏到入口脚本。
- `_RssEntry` 类移入 `src/pipeline/stages.py`，作为 FetchStage 的内部类。

**为什么不**：
- 不用 3 个 Stage（fetch+parse 合并、score+analyze 合并）：粒度太粗，score 和 analyze 的关注点完全不同（CPU 密集 vs IO 密集），分开后可独立优化。
- 不引入新的 `src/pipeline/arxiv_stages.py` 文件：现有 `stages.py` 只有 ~230 行，加上新 Stage 也就 ~450 行，不需要拆文件。

## Decision 2: `main.py` 简化为 pipeline 编排 + CLI 模式

**选择**：

```python
async def run_multi_dimension_pipeline(date=None, subjects=None) -> PipelineContext:
    settings = get_settings()
    date = date or compute_default_date(settings)
    subjects = subjects or settings.arxiv_subjects

    context = PipelineContext(date=date, subjects=subjects)
    stages = [FetchStage(), ParseStage(), ScoreStage(), AnalyzeStage(), GenerateReportStage()]

    for stage in stages:
        ok = await stage.execute(context)
        if not ok:
            break

    return context
```

CLI 部分（`--query`、`--hot`、`--direction`、`--scheduler`）保留在 `main.py` 的 `if __name__` 块中，不搬动。

**为什么**：
- CLI 模式用的是 `query_engine` 和 `scheduler`，跟 pipeline 无关，放在 `main.py` 合理。
- 不用 `Pipeline` 类的 `run()` 方法：当前 `Pipeline` 类有 ~100 行回调/通知逻辑但无人使用。直接用简单 for 循环比引入一个 over-engineered 的编排器更清晰。`Pipeline` 类在本次重构中标记为死代码删除。

## Decision 3: `_escape_html` 抽到 `src/utils/html.py`

**选择**：新建 `src/utils/__init__.py` + `src/utils/html.py`，导出 `escape_html()`。三处调用方改为 `from src.utils.html import escape_html`。

**为什么**：
- 三个文件独立维护同一个函数，改一处忘另一处就是 XSS 隐患。
- `src/utils/` 目录在项目结构中已预留（README 历史版本提过），但一直是空的。

## Decision 4: DB 连接池从 `StaticPool` 改为 `NullPool`

**选择**：`NullPool`——每次 `get_db_session()` / `DBSession()` 创建新连接，用完即关。

**为什么**：
- SQLite 不支持真正的并发写入（只有 WAL 模式下允许并发读 + 串行写）。`StaticPool` 单连接在 `ThreadPoolExecutor(15)` 下会序列化所有操作，性能瓶颈。
- `QueuePool` 对 SQLite 没意义（文件锁决定并发度，不是连接池）。
- `NullPool` 最简单：每个线程/协程拿自己的连接，SQLite 的文件锁保证写入安全。对本项目的写入量（每天 ~20 次 repo + ~15 次 paper），连接开销可忽略。
- 同时开启 WAL 模式：`engine` 创建后执行 `PRAGMA journal_mode=WAL`。

## Decision 5: 统一 session 管理

**选择**：所有 DB 操作统一使用 `with DBSession() as db:` context manager 模式。删除 `get_db()` generator（FastAPI Depends 风格，本项目不用 FastAPI）。`get_db_session()` 保留但返回值改为支持 context manager 的包装。

**为什么**：
- `main.py:264` 的 `db = DBSession().session` 是唯一不走 context manager 的调用点，也是 Critical 级 session 泄漏源。改成 `with` 后问题消失。
- `get_db()` 的 `yield` 模式在本项目无消费者，纯死代码。

## Decision 6: 死代码删除清单

一次性删除，不分 phase：

| 位置 | 内容 |
|------|------|
| `src/tools/call_llm.py` | `analyze_paper_batch()`、`translate_abstract()`、`get_client()` |
| `src/tools/report2md.py` | `papers_to_markdown()` 别名 |
| `src/tools/unified_report.py` | `build_unified_markdown()` 别名 |
| `src/github_agent/report.py` | `repos_to_daily_markdown()` 别名 |
| `src/models/schemas.py` | `DailyReport`、`ProcessingState` 类 |
| `src/database/models.py` | `UserFeedbackDB`、`ArxivSubjectStatDB` 类 |
| `src/database/connection.py` | `get_db()` generator |
| `src/core/scheduler.py` | `DEFAULT_SCHEDULE` 硬编码（改为读 settings） |
| `src/core/query_engine.py` | `add_feedback()` 方法（无调用方） |
| `src/pipeline/core.py` | `Pipeline` 类（含 `progress_callbacks`/`_notify_*`） |
| `main.py` | `_RssEntry` 类、`_configure_arxiv_client`、`use_llm` 参数 |

## Risks

- **RSS fallback 行为变更风险**：搬进 FetchStage 时需要保证 `context._rss_entries` 的数据结构和下游 ParseStage 的消费方式完全一致。验证方法：在 arXiv API 返回 429 时手动触发 fallback 路径。
- **Pipeline 类删除**：`web/app.py` 如果引用了 `Pipeline`，需要同步清理。（审查结论：web 不引用 Pipeline，安全。）
- **DB 并发写入**：`NullPool` + WAL 模式在 15 并发线程下需验证不出现 `database is locked` 错误。SQLite 默认 busy timeout 5 秒，可能需要在 engine 创建时设置 `connect_args={"timeout": 30}`。

## Out of Scope

- GitHub pipeline 重构（`main_github.py` + `src/github_agent/stages.py` 架构已较合理，本次不动）。
- 新增测试（本次只做结构重构，测试在后续 change 中补充）。
- `web/app.py` 全面重构（只修 import 和 bare except，不改 UI 逻辑）。
