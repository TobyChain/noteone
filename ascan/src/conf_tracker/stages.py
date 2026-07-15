"""Conference Paper Pipeline Stages — Fetch + Analyze + BuildFragment."""
from __future__ import annotations

from loguru import logger

from src.pipeline.core import PipelineStage, PipelineContext
from src.conf_tracker.fetcher import (
    load_ccf_conferences, fetch_all_conferences,
)
from src.conf_tracker.analyzer import analyze_papers_batch
from src.conf_tracker.report import conf_papers_to_html, conf_papers_to_md
from src.conf_tracker.models import ConferenceAnalysis
from src.database.connection import get_db_session
from src.database.repositories import ConferencePaperRepository


class FetchConfStage(PipelineStage):
    """Fetch conference papers from Semantic Scholar + DBLP, dedup against DB."""

    def __init__(self):
        super().__init__("fetching_conference")

    async def execute(self, context: PipelineContext) -> bool:
        from src.config.settings import get_settings
        settings = get_settings()

        conferences = load_ccf_conferences(
            settings.conference_ccf_yaml_path,
            rank_filter=settings.conference_rank_filter,
            category_filter=settings.conference_categories,
        )
        if not conferences:
            logger.warning("无会议配置，跳过会议论文抓取")
            context.conference_papers = []
            return True

        logger.info(f"加载 {len(conferences)} 个会议配置")

        all_papers = fetch_all_conferences(conferences, settings)

        db = get_db_session()
        repo = ConferencePaperRepository(db)
        known_keys = repo.get_all_known_keys()
        analyzed_keys = repo.get_all_analyzed_keys()
        today = context.date.replace("-", "")

        # Don't filter by known_keys — show all current-year papers each day.
        # LLM analysis stage uses analyzed_keys cache to skip re-analyzing.
        new_papers = list(all_papers)

        for paper in all_papers:
            try:
                repo.upsert_discovered(
                    paper_key=paper.paper_key, title=paper.title,
                    authors=paper.authors, abstract=paper.abstract or "",
                    venue=paper.venue, venue_full_name=paper.venue_full_name,
                    rank=paper.rank, category=paper.category,
                    year=paper.year or 0, publication_date=paper.publication_date or "",
                    doi=paper.doi or "", url=paper.url or "",
                    pdf_url=paper.pdf_url or "", citation_count=paper.citation_count,
                    tldr=paper.tldr or "", source=paper.source, today=today,
                    keywords=paper.keywords.split(",") if paper.keywords else [],
                    paper_type=paper.paper_type,
                )
            except Exception as e:
                logger.warning(f"DB upsert failed for {paper.paper_key}: {e}")

        a_count = sum(1 for p in new_papers if p.rank == "A")
        b_count = sum(1 for p in new_papers if p.rank == "B")
        if new_papers:
            logger.success(f"会议论文: 发现 {len(new_papers)} 篇新论文（A 类 {a_count} 篇，B 类 {b_count} 篇）")
        else:
            logger.info(f"无新会议论文（{len(all_papers)} 篇全部已读）")

        context.conference_papers = new_papers
        context.conference_analyzed_keys = analyzed_keys
        return True


class AnalyzeConfStage(PipelineStage):
    """LLM concurrent analysis of conference papers. Cached results restored from DB."""

    def __init__(self, max_concurrency: int = 5):
        super().__init__("analyzing_conference")
        self.max_concurrency = max_concurrency

    async def execute(self, context: PipelineContext) -> bool:
        papers = context.conference_papers
        if not papers:
            logger.info("无会议论文需要 LLM 分析")
            context.conference_analyses = {}
            return True

        db = get_db_session()
        repo = ConferencePaperRepository(db)
        analyzed_keys: set = getattr(context, "conference_analyzed_keys", set())

        analyses: dict = {}
        cached_count = 0
        for paper in papers:
            if paper.paper_key not in analyzed_keys:
                continue
            row = repo.get_cached_analysis(paper.paper_key)
            if row and row.analyzed and row.one_liner:
                kw = row.keywords if isinstance(row.keywords, list) else []
                analyses[paper.paper_key] = ConferenceAnalysis(
                    one_liner=row.one_liner or "",
                    summary_cn=row.summary_cn or "",
                    keywords=kw,
                    core_recommendation=row.core_contribution or "",
                    relevance=row.relevance or "一般推荐",
                )
                cached_count += 1

        to_analyze = [p for p in papers if p.paper_key not in analyses]
        logger.info(f"Conference analyze: {len(papers)} total, {cached_count} cached, {len(to_analyze)} need LLM")

        if to_analyze:
            new_analyses = await analyze_papers_batch(to_analyze, max_concurrency=self.max_concurrency)
            analyses.update(new_analyses)

            for key, analysis in new_analyses.items():
                if analysis:
                    try:
                        repo.save_analysis(key, analysis)
                    except Exception as e:
                        logger.warning(f"Failed to save conference analysis for {key}: {e}")

        context.conference_analyses = analyses
        success_count = sum(1 for a in analyses.values() if a and a.one_liner != "[分析失败]")
        logger.success(f"Conference analysis done: {success_count}/{len(papers)} ({cached_count} cached)")
        return True


class BuildConfFragmentStage(PipelineStage):
    """Generate HTML + MD fragments for conference papers."""

    def __init__(self):
        super().__init__("building_fragment_conference")

    async def execute(self, context: PipelineContext) -> bool:
        papers = context.conference_papers
        analyses = getattr(context, "conference_analyses", {})

        date_compact = context.date.replace("-", "")

        html_fragment = conf_papers_to_html(papers, analyses, date_compact)
        md_fragment = conf_papers_to_md(papers, analyses, date_compact)

        context.conference_html = html_fragment
        context.conference_md = md_fragment

        if papers:
            logger.success(f"会议论文 HTML+MD 片段已生成 (HTML: {len(html_fragment)} chars, {len(papers)} 篇)")
        else:
            logger.info("会议论文: 使用占位符")
        return True
