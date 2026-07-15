# Add Conference Paper Tracking

## Why

ascan 日报当前覆盖 arXiv 预印本、GitHub 开源项目、官方研究博客和独立博客四个维度，但缺少一个关键信号源：**顶会录用论文**。顶会（NeurIPS、ICML、CVPR 等）的 accepted paper list 是 AI 领域最前沿、最权威的成果发布渠道，论文从录用到正式发表之间往往有 1-6 个月的窗口期，这段时间是技术追踪的最佳时机。

现有 arXiv pipeline 只能追踪预印本，无法区分一篇论文是否被顶会录用。GitHub trending 能捕获工程化实现，但学术论文的源头仍然是会议 proceedings。缺少会议论文追踪意味着：

1. **遗漏高质量信号**：顶会录用论文经过同行评审，信噪比远高于 arXiv 预印本。
2. **无法追踪技术成熟度**：同一项工作从 arXiv 预印本 → 顶会录用 → 开源实现的生命周期无法串联。
3. **竞品情报盲区**：Google/DeepMind/Meta 等头部机构的顶会发表是重要的技术路线信号。

## What Changes

### 新增 `src/conf_tracker/` 模块

遵循 `src/blog_subs/` 的轻量级三阶段模式（Fetch → Analyze → BuildFragment），新增完整的会议论文追踪子系统：

- **数据源**：Semantic Scholar API 为主（venue 过滤 + 引用数 + 摘要 + TLDR），DBLP API 为补（权威 TOC 列表，无摘要但覆盖面最广）。
- **会议分级**：本地维护 CCF A/B 类会议映射表（YAML 格式），支持按等级过滤和标注。
- **主题过滤**：复用现有 `high_priority_keywords` + 新增 `conference_topics` 配置，按 AI/NLP/CV/DM/Agent 等方向筛选相关论文。
- **增量追踪**：基于 Semantic Scholar 的 `publicationDate` 和 DBLP 的年份 + TOC，在可配置时间窗口内（默认 30 天）抓取新录用/发表论文。
- **LLM 分析**：复用现有 `LLMClient` 并发分析论文，生成中文摘要 + 电商关联度评估。
- **DB 持久化**：新增 `conference_papers` 表，增量去重（基于 DOI + venue + title hash）。

### 修改现有模块

- **`src/config/settings.py`**：新增会议追踪配置段（conferences 列表、CCF 映射路径、时间窗口、Semantic Scholar API key）。
- **`src/pipeline/core.py`**：`PipelineContext` 新增 `conference_*` 产物字段。
- **`main_daily.py`**：在 Step 4（博客）和 Step 5（合并）之间插入 Step 5: 会议论文 pipeline，原 Step 5 变为 Step 6。
- **`src/tools/unified_report.py`** + **`src/tools/report_md.py`**：`build_unified_html()` / `build_unified_md()` 新增 `conference_html` / `conference_md` 参数，报告新增 Part 5。
- **`src/database/models.py`**：新增 `ConferencePaperDB` ORM 表。
- **`.env.example`**：新增 `SEMANTIC_SCHOLAR_API_KEY` 占位。

## Capabilities

### Added Capabilities

- **`src/conf_tracker/`**：完整的会议论文追踪模块，包含 fetcher（Semantic Scholar + DBLP 双源）、analyzer（LLM 分析）、report（HTML+MD 片段生成）、stages（三阶段 pipeline 集成）、models（数据模型）。
- **`data/ccf_conferences.yaml`**：CCF A/B 类会议分级映射表，覆盖 AI/NLP/CV/DM/SE/HCI 等方向。
- **`ConferencePaperDB`**：数据库表，存储论文元数据 + LLM 分析结果 + 增量追踪状态。
- **日报 Part 5**：统一日报新增"会议论文追踪"板块，按 A 类 / B 类分组展示。

### Modified Capabilities

- **`PipelineContext`**：新增 `conference_papers`、`conference_analyses`、`conference_html`、`conference_md` 字段。
- **`build_unified_html()` / `build_unified_md()`**：签名新增 `conference_html` / `conference_md` 参数。
- **`main_daily.py`**：新增 Step 5 调用 `main_conf.py` 的 `run_daily()`。

## Impact

- **改动范围**：新增 `src/conf_tracker/`（~5 个文件）、`data/ccf_conferences.yaml`、`main_conf.py`；修改 `src/config/settings.py`、`src/pipeline/core.py`、`main_daily.py`、`src/tools/unified_report.py`、`src/tools/report_md.py`、`src/database/models.py`、`.env.example`。
- **外部依赖**：新增 `pyyaml` 依赖（解析 CCF 映射表）；Semantic Scholar API 需要免费 API key（1 req/sec 限流）。
- **运行时间影响**：会议论文 pipeline 预计增加 30-60 秒（Semantic Scholar API 调用 + LLM 分析 10-30 篇论文）。由于会议论文发布频率远低于 arXiv（按会议周期而非每日），大多数运行周期会发现 0 篇新论文，开销极低。
- **风险**：Semantic Scholar API 的 venue 名称匹配可能不精确（如 "NeurIPS" vs "Advances in Neural Information Processing Systems"），需要维护 venue alias 映射。
- **测试**：建议补充 `tests/test_conf_fetcher.py`（mock Semantic Scholar/DBLP 响应）和 `tests/test_ccf_mapping.py`。
