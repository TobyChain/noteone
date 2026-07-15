# Tasks: Add Conference Paper Tracking

## Phase 1: 基础设施 — 配置 + 数据模型 + CCF 映射

### Task 1.1: 创建 CCF 会议分级映射表 [x]
- **文件**: `data/ccf_conferences.yaml`（新增）
- **操作**:
  - 创建 `data/` 目录（如不存在）
  - 创建 `data/ccf_conferences.yaml`，包含 18 个会议条目（12 个 A 类 + 6 个 B 类），结构如 design.md Decision 2 所示
  - 每个条目包含：`name`、`full_name`、`rank`（A/B）、`category`（ai/nlp/cv/dm/ir/hci）、`dblp_key`、`s2_venue`、`aliases`
- **验证**: `.venv/bin/python -c "import yaml; data = yaml.safe_load(open('data/ccf_conferences.yaml')); assert len(data['conferences']) == 18; print('OK:', [c['name'] for c in data['conferences']])"`

### Task 1.2: 新增会议追踪配置段 [x]
- **文件**: `src/config/settings.py`（修改）
- **操作**:
  - 在 `# ==================== 独立博客 RSS 源配置 ====================` 之后新增：
    ```python
    # ==================== 会议论文追踪配置 ====================
    semantic_scholar_api_key: Optional[str] = Field(
        default=None,
        description="Semantic Scholar API Key（免费申请，提高限流到 1 req/sec）"
    )
    conference_lookback_days: int = Field(
        default=30,
        description="会议论文回溯天数（滑动窗口）"
    )
    conference_max_papers_per_venue: int = Field(
        default=50,
        description="每个会议最多抓取论文数"
    )
    conference_max_total: int = Field(
        default=100,
        description="送入 LLM 分析的最大论文总数"
    )
    conference_rank_filter: List[str] = Field(
        default=["A", "B"],
        description="追踪的会议等级（A/B）"
    )
    conference_categories: List[str] = Field(
        default=["ai", "nlp", "cv", "dm", "ir"],
        description="追踪的会议方向分类"
    )
    conference_topics: List[str] = Field(
        default=[
            "recommendation", "e-commerce", "dialogue", "agent",
            "multi-modal", "large language model", "LLM", "RAG",
            "knowledge graph", "search", "retrieval",
        ],
        description="会议论文主题过滤关键词"
    )
    conference_ccf_yaml_path: str = Field(
        default="data/ccf_conferences.yaml",
        description="CCF 会议分级映射表路径"
    )
    ```
  - 新增 `field_validator` 处理 `conference_rank_filter` 和 `conference_categories`（逗号分隔字符串 → 列表）
- **验证**: `.venv/bin/python -c "from src.config.settings import get_settings; s = get_settings(); print(s.conference_lookback_days, s.conference_rank_filter, len(s.conference_topics))"`

### Task 1.3: 新增 `ConferencePaperDB` ORM 表 [x]
- **文件**: `src/database/models.py`（修改）
- **操作**:
  - 在文件末尾（`BlogPostDB` 之后）新增：
    ```python
    class ConferencePaperDB(Base):
        """会议论文追踪"""
        __tablename__ = "conference_papers"

        id = Column(Integer, primary_key=True, autoincrement=True)
        paper_key = Column(String(300), unique=True, nullable=False, index=True)  # DOI or s2_id or title_hash
        title = Column(Text, nullable=False)
        authors = Column(JSON, default=list)
        abstract = Column(Text, nullable=True)
        venue = Column(String(100), nullable=False, index=True)      # NeurIPS / ICML / ...
        venue_full_name = Column(String(300), nullable=True)
        rank = Column(String(5), nullable=False, index=True)          # A / B
        category = Column(String(20), nullable=True)                  # ai / nlp / cv / ...
        year = Column(Integer, nullable=True, index=True)
        publication_date = Column(String(10), nullable=True)          # YYYY-MM-DD
        doi = Column(String(200), nullable=True)
        url = Column(String(500), nullable=True)                      # 论文链接
        pdf_url = Column(String(500), nullable=True)                  # 开放获取 PDF
        citation_count = Column(Integer, default=0)
        tldr = Column(Text, nullable=True)                            # S2 自动摘要

        # LLM 分析
        one_liner = Column(String(200), nullable=True)
        summary_cn = Column(Text, nullable=True)
        core_contribution = Column(Text, nullable=True)
        ecommerce_connection = Column(Text, nullable=True)
        relevance = Column(String(20), nullable=True)

        # 增量追踪
        source = Column(String(20), default="s2")                     # s2 / dblp
        first_seen_date = Column(String(10), nullable=True, index=True)
        last_seen_date = Column(String(10), nullable=True, index=True)
        analyzed = Column(Boolean, default=False)

        created_at_ts = Column(DateTime, default=datetime.utcnow)
        updated_at_ts = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    ```
- **验证**: `.venv/bin/python -c "from src.database.models import ConferencePaperDB; print(ConferencePaperDB.__tablename__)"` 输出 `conference_papers`

### Task 1.4: 新增 `ConferencePaperRepository` [x]
- **文件**: `src/database/repositories.py`（修改）
- **操作**:
  - 新增 `ConferencePaperRepository` 类，方法参考 `BlogPostRepository`：
    - `get_all_known_keys() -> set[str]`：查询所有已知 paper_key
    - `get_all_analyzed_keys() -> set[str]`：查询 `analyzed=True` 的 paper_key
    - `upsert_discovered(paper_key, title, authors, abstract, venue, rank, category, year, publication_date, doi, url, pdf_url, citation_count, tldr, source, today)`：新发现论文写入 DB
    - `get_cached_analysis(paper_key) -> ConferencePaperDB | None`：查询已分析结果
    - `save_analysis(paper_key, analysis_dict)`：保存 LLM 分析结果
- **验证**: `.venv/bin/python -c "from src.database.repositories import ConferencePaperRepository; print('OK')"`

### Task 1.5: 新增 `pyyaml` 依赖 [x]
- **文件**: `requirements.txt`（修改）
- **操作**:
  - 添加 `pyyaml>=6.0` 到依赖列表
- **验证**: `.venv/bin/pip install pyyaml --quiet` 成功

---

## Phase 2: 核心模块 — `src/conf_tracker/`

### Task 2.1: 创建模块骨架 + 数据模型 [x]
- **文件**: `src/conf_tracker/__init__.py` + `src/conf_tracker/models.py`（新增）
- **操作**:
  - 创建 `src/conf_tracker/__init__.py`（空文件）
  - 创建 `src/conf_tracker/models.py`，定义 `ConferencePaper` 数据类：
    ```python
    @dataclass
    class ConferencePaper:
        paper_key: str           # DOI or s2_paperId or title_hash
        title: str
        authors: list[str]
        abstract: str | None
        venue: str               # 简称: NeurIPS / ICML / ...
        venue_full_name: str
        rank: str                # A / B
        category: str            # ai / nlp / cv / ...
        year: int | None
        publication_date: str | None
        doi: str | None
        url: str | None
        pdf_url: str | None
        citation_count: int
        tldr: str | None
        source: str              # s2 / dblp

    @dataclass
    class ConferenceAnalysis:
        one_liner: str
        summary_cn: str
        core_contribution: str
        ecommerce_connection: str
        relevance: str           # 高 / 中 / 低
    ```
- **验证**: `.venv/bin/python -c "from src.conf_tracker.models import ConferencePaper, ConferenceAnalysis; print('OK')"`

### Task 2.2: 实现 CCF 映射加载器 [x]
- **文件**: `src/conf_tracker/fetcher.py`（新增，第一部分）
- **操作**:
  - 实现 `load_ccf_conferences(yaml_path: str) -> list[dict]` 函数：
    - 读取 `data/ccf_conferences.yaml`
    - 按 `conference_rank_filter` 和 `conference_categories` 过滤
    - 返回符合条件的会议列表
  - 实现 `_normalize_venue(name: str, aliases: list[str]) -> str` 函数：
    - 将各种 venue 名称变体归一化为 `name` 字段
- **验证**: `.venv/bin/python -c "from src.conf_tracker.fetcher import load_ccf_conferences; confs = load_ccf_conferences('data/ccf_conferences.yaml'); print(len(confs), [c['name'] for c in confs[:3]])"`

### Task 2.3: 实现 Semantic Scholar 抓取器 [x]
- **文件**: `src/conf_tracker/fetcher.py`（追加）
- **操作**:
  - 实现 `fetch_semantic_scholar(conf: dict, lookback_days: int, max_papers: int) -> list[ConferencePaper]` 函数：
    - 构造 API URL：`GET /graph/v1/paper/search?query=&venue={s2_venue}&year={year}&publicationDateOrYear={start}:{end}&fields=title,abstract,authors,citationCount,externalIds,publicationDate,venue,tldr,openAccessPdf&limit={max_papers}`
    - Header: `x-api-key: {SEMANTIC_SCHOLAR_API_KEY}`（如果配置了）
    - 解析响应，构造 `ConferencePaper` 列表
    - `paper_key` 优先使用 DOI，无 DOI 则用 S2 paperId，都没有则用 `hashlib.md5(title.lower().encode()).hexdigest()[:16]`
    - 异常处理：网络失败/限流返回空列表 + 日志警告
  - 实现 `fetch_all_conferences(conferences: list[dict], settings: Settings) -> list[ConferencePaper]` 函数：
    - 遍历会议列表，逐个调用 `fetch_semantic_scholar`
    - 请求间 `time.sleep(1.1)` 保持礼貌
    - 如果 S2 API key 未配置，日志提示并降低频率
- **验证**: `.venv/bin/python -c "from src.conf_tracker.fetcher import fetch_semantic_scholar; print('function OK')"`

### Task 2.4: 实现 DBLP 补充抓取器 [x]
- **文件**: `src/conf_tracker/fetcher.py`（追加）
- **操作**:
  - 实现 `fetch_dblp(conf: dict, year: int) -> list[ConferencePaper]` 函数：
    - 构造 URL：`GET https://dblp.org/search/publ/api?q=toc:db/conf/{dblp_key}/{dblp_key}{year}.bht:&format=json&h=500`
    - 解析 JSON 响应，提取论文列表
    - DBLP 无摘要，`abstract=None`；`source="dblp"`
    - `url` 使用 `ee`（electronic edition）字段
  - 实现 `merge_sources(s2_papers: list, dblp_papers: list) -> list[ConferencePaper]` 函数：
    - 按 `paper_key`（DOI 优先）去重
    - S2 结果优先（有摘要），DBLP 结果补充 S2 遗漏的论文
    - 日志：`"S2: {n} papers, DBLP: {m} papers, merged: {k} unique"`
- **验证**: `.venv/bin/python -c "from src.conf_tracker.fetcher import fetch_dblp, merge_sources; print('functions OK')"`

### Task 2.5: 实现 LLM 分析器 [x]
- **文件**: `src/conf_tracker/analyzer.py`（新增）
- **操作**:
  - 实现 `analyze_papers_batch(papers: list[ConferencePaper], max_concurrency: int = 5) -> dict[str, ConferenceAnalysis | None]` 函数：
    - 复用 `src/tools/call_llm.py` 的 `LLMClient`
    - 构造 prompt（见 design.md Decision 6）
    - `asyncio.gather` + `Semaphore(max_concurrency)` 并发调用
    - JSON 解析容错（复用 `_extract_json` 逻辑）
    - 失败兜底：`ConferenceAnalysis(one_liner="[分析失败]", summary_cn="", core_contribution="", ecommerce_connection="", relevance="低")`
- **验证**: `.venv/bin/python -c "from src.conf_tracker.analyzer import analyze_papers_batch; print('function OK')"`

### Task 2.6: 实现 HTML + MD 报告生成 [x]
- **文件**: `src/conf_tracker/report.py`（新增）
- **操作**:
  - 实现 `conf_papers_to_html(papers: list[ConferencePaper], analyses: dict, date_compact: str) -> str` 函数：
    - 按 rank 分组（A 类 / B 类）
    - 每个 rank 内按 venue 分组
    - 每篇论文：标题(链接) + 作者 + 会议 badge + 引用数 badge + LLM one_liner + summary_cn
    - A 类紫色标签、B 类蓝色标签
    - 引用数 > 50 加 "高引" badge
    - 空数据返回 `<p class="empty-state">近期无新会议论文。</p>`
    - CSS 复用 `unified_report.py` 的 Notion 风格设计 token
  - 实现 `conf_papers_to_md(papers: list[ConferencePaper], analyses: dict, date_compact: str) -> str` 函数：
    - Markdown 格式，结构同 HTML
    - 空数据返回 `"_近期无新会议论文。_"`
- **验证**: `.venv/bin/python -c "from src.conf_tracker.report import conf_papers_to_html, conf_papers_to_md; print('functions OK')"`

---

## Phase 3: Pipeline 集成

### Task 3.1: 实现三阶段 Pipeline Stages [x]
- **文件**: `src/conf_tracker/stages.py`（新增）
- **操作**:
  - 实现 `FetchConfStage(PipelineStage)`：
    - `name = "fetching_conference"`
    - 加载 CCF 映射 → 调用 `fetch_all_conferences` → DB 去重 → 关键词过滤 → 写入 `context.conference_papers`
    - 新发现的论文 upsert 到 DB
    - 日志：`"会议论文: 发现 N 篇新论文（A 类 X 篇，B 类 Y 篇）"`
  - 实现 `AnalyzeConfStage(PipelineStage)`：
    - `name = "analyzing_conference"`
    - 从 DB 缓存恢复已分析的 → LLM 分析未缓存的 → 保存结果到 DB
    - 写入 `context.conference_analyses`
  - 实现 `BuildConfFragmentStage(PipelineStage)`：
    - `name = "building_fragment_conference"`
    - 调用 `conf_papers_to_html` + `conf_papers_to_md`
    - 写入 `context.conference_html` + `context.conference_md`
  - 参考 `src/blog_subs/stages.py` 的结构（~190 行）
- **验证**: `.venv/bin/python -c "from src.conf_tracker.stages import FetchConfStage, AnalyzeConfStage, BuildConfFragmentStage; print('stages OK')"`

### Task 3.2: 扩展 `PipelineContext` [x]
- **文件**: `src/pipeline/core.py`（修改）
- **操作**:
  - 在 `# Part 4 独立博客订阅` 字段之后新增：
    ```python
    # Part 5 会议论文追踪
    conference_papers: List[Any] = field(default_factory=list)
    conference_analyses: Dict[str, Any] = field(default_factory=dict)
    conference_analyzed_keys: Any = field(default_factory=set)
    conference_html: Optional[str] = None
    conference_md: Optional[str] = None
    ```
- **验证**: `.venv/bin/python -c "from src.pipeline.core import PipelineContext; ctx = PipelineContext(date='2026-07-06', subjects=[]); print(ctx.conference_papers, ctx.conference_html)"`

### Task 3.3: 创建 `main_conf.py` 入口脚本 [x]
- **文件**: `main_conf.py`（新增）
- **操作**:
  - 参考 `main_blog.py` 结构，实现 `run_daily(date_compact: str) -> PipelineContext`：
    ```python
    async def run_daily(date_compact: str) -> PipelineContext:
        date_dashed = f"{date_compact[:4]}-{date_compact[4:6]}-{date_compact[6:8]}"
        context = PipelineContext(date=date_dashed, subjects=[])
        stages = [FetchConfStage(), AnalyzeConfStage(), BuildConfFragmentStage()]
        stage_enums = [Stage.FETCHING, Stage.ANALYZING, Stage.GENERATING]
        for stage, stage_enum in zip(stages, stage_enums):
            context.start_stage(stage_enum)
            try:
                ok = await stage.execute(context)
            except Exception as e:
                logger.error(f"Stage {stage.name} failed: {e}")
                ok = False
            status = Status.SUCCESS if ok else Status.FAILED
            context.end_stage(stage_enum, status)
            if not ok:
                context.error_message = f"Stage {stage.name} failed"
                break
        return context
    ```
  - 添加 `if __name__ == "__main__"` 块（CLI 支持 `--date`、`--init-db`）
- **验证**: `.venv/bin/python main_conf.py --help` 显示帮助信息

### Task 3.4: 集成到 `main_daily.py` [x]
- **文件**: `main_daily.py`（修改）
- **操作**:
  - 在 Step 4（独立博客）和 Step 5（合并）之间插入：
    ```python
    # ── Step 5: 会议论文追踪 ────────────────────────────────────────────
    logger.info("Step 5: 运行会议论文 pipeline...")
    conference_html = None
    conference_md = None
    from main_conf import run_daily as run_conf_daily

    try:
        conf_ctx = await run_conf_daily(date_compact=date_compact)
        conference_html = getattr(conf_ctx, "conference_html", None)
        conference_md = getattr(conf_ctx, "conference_md", None)
        if conference_html and "empty-state" not in conference_html:
            logger.success(f"会议论文 pipeline 完成 ({len(conference_html)} chars)")
        else:
            logger.info("会议论文 pipeline 无新论文")
    except Exception as e:
        logger.error(f"会议论文 pipeline 异常（继续合并步骤）: {e}")
        conference_html = None
        conference_md = None
    ```
  - 原 Step 5（合并）变为 Step 6
  - 修改 `build_unified_html()` 和 `build_unified_md()` 调用，新增 `conference_html` / `conference_md` 参数
- **验证**: `.venv/bin/python -c "import main_daily; print('import ok')"`

### Task 3.5: 扩展统一报告模板 [x]
- **文件**: `src/tools/unified_report.py`（修改）
- **操作**:
  - `build_unified_html()` 签名新增 `conference_html: Optional[str] = None` 参数
  - 在 Part 4（独立博客）之后、`</div><!-- .page -->` 之前插入 Part 5：
    ```python
    if conference_html and conference_html.strip() and "empty-state" not in conference_html:
        subtitle_parts.append("会议论文追踪")
    # ... 在 body 拼接中:
    if conference_html and conference_html.strip():
        parts.append(f'''
        <section class="section">
          <h2 class="section-title">Part 5: 会议论文追踪</h2>
          {conference_html}
        </section>
        ''')
    ```
- **验证**: 检查生成的 HTML 中 Part 5 正确出现

### Task 3.6: 扩展 Markdown 报告 [x]
- **文件**: `src/tools/report_md.py`（修改）
- **操作**:
  - `build_unified_md()` 签名新增 `conference_md: Optional[str] = None` 参数
  - 在 Part 4 之后插入 Part 5：
    ```python
    if conference_md and conference_md.strip() and "无新会议论文" not in conference_md:
        subtitle_parts.append("会议论文追踪")
    # ... 在 body 拼接中:
    if conference_md and conference_md.strip():
        sections.append(f"## Part 5: 会议论文追踪\n\n{conference_md}")
    ```
- **验证**: 检查生成的 MD 中 Part 5 正确出现

---

## Phase 4: 环境配置 + 数据库迁移

### Task 4.1: 更新 `.env.example` [x]
- **文件**: `.env.example`（修改）
- **操作**:
  - 在末尾新增：
    ```
    # ==================== 会议论文追踪 ====================
    # Semantic Scholar API Key（免费申请: https://www.semanticscholar.org/product/api#api-key-form）
    SEMANTIC_SCHOLAR_API_KEY=
    # 会议论文回溯天数
    CONFERENCE_LOOKBACK_DAYS=30
    # 追踪的会议等级
    CONFERENCE_RANK_FILTER=A,B
    ```
- **验证**: `grep SEMANTIC_SCHOLAR .env.example` 有输出

### Task 4.2: 数据库自动迁移 [x]
- **文件**: `src/database/connection.py`（确认）
- **操作**:
  - 确认 `init_database()` 中的 `Base.metadata.create_all(engine)` 会自动创建 `conference_papers` 表（SQLAlchemy 的 `create_all` 只创建不存在的表，不修改已有表）
  - 如有必要，在 `init_database()` 中 import `ConferencePaperDB` 确保 ORM 注册
- **验证**: `.venv/bin/python -c "from src.database.connection import init_database; init_database(); from src.database.models import ConferencePaperDB; print('table created')"`

---

## Phase 5: 端到端验证

### Task 5.1: 单独运行会议论文 pipeline [x]
- **操作**:
  - `.venv/bin/python main_conf.py --init-db`（确保表已创建）
  - `.venv/bin/python main_conf.py --date 20260706`
  - 确认日志输出：
    - `发现 N 篇新会议论文（A 类 X 篇，B 类 Y 篇）`（N 可能为 0，取决于当前时间窗口）
    - `Analysis done: N/N (0 cached, N new LLM calls)`
    - `会议论文 HTML+MD 片段已生成`
  - 如果 N=0，确认输出 `<p class="empty-state">近期无新会议论文。</p>`
- **验证**: pipeline 无异常退出，日志中无 `Traceback`

### Task 5.2: 集成到统一日报 [x]
- **操作**:
  - 删除 `logs/ascan_$(date +%Y%m%d).lock` 和 `docs/Ascan-$(date +%Y%m%d).html`
  - `.venv/bin/python main_daily.py --dry-run`
  - 确认日志中可以看到 `Step 5: 运行会议论文 pipeline...`
  - 确认 `docs/Ascan-YYYYMMDD.html` 生成，打开浏览器验证 Part 5 渲染正确
  - 确认 `docs/Ascan-YYYYMMDD.md` 中包含 Part 5 内容
- **验证**: HTML 日报正常打开，Part 5 标题和样式正确

### Task 5.3: 幂等性验证 [x]
- **操作**:
  - 再次 `.venv/bin/python main_conf.py --date 20260706`
  - 确认日志显示 `0 篇新论文（N 篇全部已读）`——第二次运行不重复抓取
  - 确认 DB 中 `conference_papers` 表行数不增加
- **验证**: 幂等——重复运行结果一致

---

## 完成判定

- `data/ccf_conferences.yaml` 包含 18 个会议条目（12 A + 6 B）
- `src/conf_tracker/` 包含 5 个模块文件（__init__ / models / fetcher / analyzer / report / stages）
- `main_conf.py` 可独立运行
- `main_daily.py` 包含 Step 5 会议论文 pipeline 调用
- `build_unified_html()` / `build_unified_md()` 签名包含 `conference_html` / `conference_md` 参数
- `PipelineContext` 包含 `conference_*` 字段
- `conference_papers` 表已在 DB 中创建
- 端到端冒烟测试通过（`--dry-run` 生成包含 Part 5 的日报）
- 幂等性验证通过（重复运行不重复抓取）
