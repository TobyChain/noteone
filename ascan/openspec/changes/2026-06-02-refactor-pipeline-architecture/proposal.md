# Refactor Pipeline Architecture

## Why

对 ascan 全量代码审查发现 4 个 Critical、10 个 Medium、9 个 Low 级别问题，核心症结是**入口脚本 `main.py` 绕过了自己定义的 pipeline 框架**，导致 fetch/parse/score/report 四阶段的逻辑被内联重写了一遍（约 250 行），与 `src/pipeline/stages.py` 中的 Stage 实现严重分叉。由此衍生出：

1. **Critical — main.py 绕过 pipeline**：`FetchStage` 被 import 但从不 execute，RSS fallback / arXiv API 抓取 / 评分 / LLM 分析全在 `run_multi_dimension_pipeline()` 里手写，而 `src/pipeline/stages.py` 里的 `FetchStage`、`ParseStage`、`GenerateReportStage` 成了死代码，实际只被 `ParseStage.fetch_arxiv_metadata()` 当普通方法调了一次。
2. **Critical — `time.sleep()` 阻塞 event loop**：`main.py:113` 在 async 函数里用同步 sleep，arXiv 429 退避时阻塞整个 asyncio 循环 5-15 秒。
3. **Critical — DBSession 泄漏**：`main.py:264` 不走 context manager，`finally: db.close()` 不可靠。
4. **Critical — web/app.py 裸 import 路径**：`database.models` vs `src.database.models` 不一致。
5. **Medium — 三处代码重复**：`_escape_html` 三份、`_configure_arxiv_client` 两份、`recommendation_order` 两份且值语义相反。
6. **Medium — 大量死代码**：`use_llm` 参数从不读取、`analyze_paper_batch`/`translate_abstract`/三个 `*_markdown` 别名/`DailyReport`/`ProcessingState`/`UserFeedbackDB`/`ArxivSubjectStatDB` 等。
7. **Medium — DB 连接池不支持并发**：`StaticPool` 单连接 + `ThreadPoolExecutor(15)` 并发写入有冲突风险。

这些不是零散 bug，而是**架构不一致**导致的系统性问题。需要一次性重构让 `main.py` 回归到「组装 Stage → Pipeline.run()」的标准路径，消除分叉。

## What Changes

### Phase 1: 统一 arXiv pipeline 到 Stage 框架

- 把 `main.py` 中内联的 250 行 fetch/parse/score/LLM-analyze 逻辑拆回到对应 Stage：
  - `FetchStage`：吸收 RSS fallback + 429 退避逻辑（用 `await asyncio.sleep` 替换 `time.sleep`）
  - `ParseStage`：吸收 RSS entry 识别 + arxiv API 元数据查询的混合路径
  - 新增 `ScoreStage`：封装 `MultiDimensionScorer` 调用 + 过滤精选
  - 新增 `AnalyzeStage`：封装 LLM 并发分析 + DB 写入（使用 context manager）
  - `GenerateReportStage`：保持不变
- `main.py` 的 `run_multi_dimension_pipeline()` 简化为：构造 stages 列表 → `Pipeline(stages).run(context)`，不超过 30 行。
- 删除 `main.py` 中的 `_RssEntry` 类和 `_configure_arxiv_client`，移入 `src/pipeline/stages.py`。

### Phase 2: 消除代码重复

- `_escape_html` → `src/utils/html.py`，三处改为 import。
- `_configure_arxiv_client` → 仅在 `FetchStage` 中定义（唯一调用方）。
- `recommendation_order` → `src/core/scoring.py` 导出为常量 `RECOMMENDATION_ORDER`，统一为高→低语义。

### Phase 3: 清理死代码

- 删除 `use_llm` 参数、`analyze_paper_batch`（同步版）、`translate_abstract`、三个 `*_markdown` 别名函数、`DailyReport`/`ProcessingState` 模型、`UserFeedbackDB`/`ArxivSubjectStatDB` 表定义、`get_db()` 生成器、`DEFAULT_SCHEDULE` 硬编码。
- 删除 `Pipeline` 类中未使用的 `progress_callbacks`/`_notify_progress`/`_notify_error`（如果 Stage 框架重构后不再需要）。

### Phase 4: DB 连接安全

- `StaticPool` → `QueuePool`（或 `NullPool`），允许 ThreadPoolExecutor(15) 并发安全写入。
- 所有 session 使用统一改为 `with DBSession() as db:` 或 `with get_db_session() as db:` context manager。
- 删除 `get_db()` generator（无人使用）。

### Phase 5: web/app.py 修复

- 统一 import 路径为 `src.database.models`。
- `bare except:` → `except Exception:`。
- 去重 `import html`。

## Capabilities

### Modified Capabilities

- `arxiv-pipeline`：FetchStage 吸收 RSS fallback + 429 退避；新增 ScoreStage 和 AnalyzeStage；main.py 简化为 pipeline 编排。
- `github-pipeline`：无逻辑变更，仅受共享工具函数路径调整影响。
- `database`：连接池改为支持并发；session 管理统一。
- `web-ui`：import 路径修复。

### Added Capabilities

- `src/utils/html.py`：共享 `escape_html()` 工具函数。
- `ScoreStage` / `AnalyzeStage`：arXiv pipeline 新阶段。

### Removed Capabilities

- 大量死代码（详见 Phase 3 列表）。

## Impact

- **改动范围**：`main.py`（大幅缩减）、`src/pipeline/stages.py`（大幅扩充）、`src/pipeline/core.py`（连接池）、`src/database/connection.py`（连接池）、`src/tools/call_llm.py`（删死函数）、`src/models/schemas.py`（删死模型）、`src/database/models.py`（删死表）、`src/core/scoring.py`（导出常量）、`web/app.py`（import 修复）、新增 `src/utils/html.py`。
- **行为等价**：重构不改变日报输出内容、评分逻辑、LLM 调用方式，只改代码组织。
- **风险**：arXiv fetch 逻辑从 main.py 搬到 FetchStage，需要端到端验证 RSS fallback 和 429 退避路径。
- **测试**：现有 `tests/test_unified_html_report.py` 不受影响；建议补充 FetchStage 单元测试。
