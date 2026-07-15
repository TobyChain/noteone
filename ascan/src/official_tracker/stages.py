"""Official Tracker Pipeline Stages.

FetchOfficialStage    -> fetch from Anthropic/OpenAI, merge, detect new, filter 180d
EnrichArticlesStage   -> scrape article content for new articles
AnalyzeOfficialStage  -> LLM batch analysis
BuildOfficialFragmentStage -> generate HTML + MD fragments
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from loguru import logger

from src.pipeline.core import PipelineStage, PipelineContext, Stage, Status
from src.official_tracker.fetcher import OfficialFetcher
from src.official_tracker.models import OfficialItem, OfficialAnalysis
from src.official_tracker.analyzer import analyze_articles_batch
from src.official_tracker.report import officials_to_daily_html, officials_to_daily_md
from src.database.connection import get_db_session
from src.database.repositories import OfficialItemRepository

_DAYS_RECENT = 30
from src.config.settings import get_settings


# ── Stage 1: Fetch ──────────────────────────────────────────────────────────

class FetchOfficialStage(PipelineStage):
    """Fetch from all official sources, detect new vs already-known."""

    def __init__(self):
        super().__init__("fetching_official")

    async def execute(self, context: PipelineContext) -> bool:
        settings = get_settings()
        fetcher = OfficialFetcher(github_token=settings.github_token)
        db = get_db_session()
        repo = OfficialItemRepository(db)

        known_slugs = repo.get_all_known_slugs()
        today = context.date.replace("-", "")

        all_items_data = []

        # ── Source 1: Anthropic Research ──────────────────────────────
        try:
            anth_items = fetcher.fetch_anthropic_sitemap(settings.anthropic_sitemap_url)
            all_items_data.extend(anth_items)
            logger.info(f"Anthropic: {len(anth_items)} articles from sitemap")
        except Exception as e:
            logger.warning(f"Anthropic fetch failed: {e}")

        # ── Source 2: Google DeepMind Blog ────────────────────────────
        try:
            dm_items = fetcher.fetch_deepmind_sitemap()
            all_items_data.extend(dm_items)
            logger.info(f"DeepMind: {len(dm_items)} articles from sitemap")
        except Exception as e:
            logger.warning(f"DeepMind fetch failed: {e}")

        # ── Dedup: keep only articles not already seen in DB ──────────
        new_items_data = [
            item_data for item_data in all_items_data
            if item_data["slug"] not in known_slugs
        ]

        # Build OfficialItem list from NEW items only
        official_items = []
        for item_data in new_items_data:
            source = item_data["slug"].split(":")[0]
            official_items.append(OfficialItem(
                source=source,
                slug=item_data["slug"],
                url=item_data["url"],
                title=item_data.get("title"),
                date=item_data.get("date") or item_data.get("lastmod", "")[:10] if item_data.get("lastmod") else None,
                category=item_data.get("category"),
                item_type=item_data.get("item_type", "article"),
                summary=item_data.get("summary"),
                sitemap_lastmod=item_data.get("lastmod"),
            ))

        # ── Filter by 30-day recency ──────────────────────────────────
        cutoff = datetime.now() - timedelta(days=_DAYS_RECENT)
        recent_items = []
        skipped_old = 0
        for item in official_items:
            item_date = item.date or item.sitemap_lastmod or ""
            try:
                dt = datetime.strptime(item_date[:10], "%Y-%m-%d")
                if dt < cutoff:
                    skipped_old += 1
                    continue
            except ValueError:
                pass  # keep items with unparseable dates
            recent_items.append(item)
        if skipped_old:
            logger.info(f"跳过了 {skipped_old} 篇超过 {_DAYS_RECENT} 天的旧文章")

        # ── Take up to N latest per source (sorted by date desc) ──────
        max_per_source = getattr(settings, "official_max_per_source", 3)

        def _date_key(it) -> str:
            return (it.date or it.sitemap_lastmod or "")[:10]

        by_source: dict[str, list] = {}
        for item in recent_items:
            by_source.setdefault(item.source, []).append(item)

        filtered = []
        for source, items in by_source.items():
            items.sort(key=_date_key, reverse=True)
            filtered.extend(items[:max_per_source])

        # Upsert selected items to DB (so they won't reappear tomorrow)
        if filtered:
            to_upsert = [
                item_data for item_data in new_items_data
                if item_data["slug"] in {it.slug for it in filtered}
            ]
            repo.upsert_batch(to_upsert, today)
            logger.success(f"Upserted {len(to_upsert)} new items")

        # Get set of already-analyzed slugs
        analyzed_slugs = repo.get_all_analyzed_slugs()

        context.official_items = filtered
        context.official_analyzed_slugs = analyzed_slugs
        logger.success(
            f"Fetch done: {len(filtered)} new items "
            f"(每源≤{max_per_source}篇), {len(analyzed_slugs)} already analyzed"
        )
        return True


# ── Stage 2: Enrich ────────────────────────────────────────────────────────

class EnrichArticlesStage(PipelineStage):
    """Scrape article content for new articles (skip commits and already-enriched)."""

    def __init__(self):
        super().__init__("enriching_official")

    async def execute(self, context: PipelineContext) -> bool:
        items: list[OfficialItem] = context.official_items
        if not items:
            logger.info("No items to enrich, skipping")
            return True

        settings = get_settings()
        fetcher = OfficialFetcher(github_token=settings.github_token)
        db = get_db_session()
        repo = OfficialItemRepository(db)

        # Only scrape articles without content and not commits
        # First, restore content from DB for previously-seen articles
        known_slugs = repo.get_all_known_slugs()
        for item in items:
            if item.item_type != "article" or item.content:
                continue
            if item.slug in known_slugs:
                row = repo.get_by_slug(item.slug)
                if row and row.content:
                    item.title = row.title or item.title
                    item.date = row.date or item.date
                    item.category = row.category or item.category
                    item.summary = row.summary or item.summary
                    item.content = row.content

        to_scrape = [item for item in items if item.item_type == "article" and not item.content]
        if not to_scrape:
            logger.info("No articles to scrape, skipping")
            return True

        logger.info(f"Scraping content for {len(to_scrape)} articles...")
        enriched = fetcher.scrape_articles_batch(to_scrape, delay=settings.official_scrape_delay)

        # Save scraped content to DB
        for item in enriched:
            if item.content:
                repo.save_scraped_content(item.slug, item.title or "", item.date or "",
                                          item.category or "", item.summary or "", item.content or "")

        # Replace in context
        slug_map = {item.slug: item for item in enriched}
        context.official_items = [slug_map.get(item.slug, item) for item in items]

        logger.success(f"Enrich done: {len(to_scrape)} articles scraped")
        return True


# ── Stage 3: Analyze ───────────────────────────────────────────────────────

class AnalyzeOfficialStage(PipelineStage):
    """LLM batch analysis of new articles, skip already-analyzed ones."""

    def __init__(self):
        super().__init__("analyzing_official")

    async def execute(self, context: PipelineContext) -> bool:
        items: list[OfficialItem] = context.official_items
        if not items:
            logger.info("No items to analyze, skipping")
            context.official_analyses = {}
            return True

        db = get_db_session()
        repo = OfficialItemRepository(db)
        analyzed_slugs: set[str] = getattr(context, "official_analyzed_slugs", set())

        analyses: dict[str, Optional[OfficialAnalysis]] = {}

        # ── Pass 1: restore already-analyzed from DB ──────────────────
        cached_count = 0
        for item in items:
            if item.slug not in analyzed_slugs:
                continue
            row = repo.get_cached_analysis(item.slug)
            if row and row.analyzed and row.one_liner:
                analyses[item.slug] = OfficialAnalysis(
                    one_liner=row.one_liner or "",
                    summary_cn=row.summary_cn or "",
                    core_insight=row.core_insight or "",
                    ecommerce_connection=row.ecommerce_connection or "",
                    relevance=row.relevance or "一般",
                )
                cached_count += 1

        # ── Pass 2: LLM 并发分析 ─────────────────────────────────────
        to_analyze = [item for item in items if item.slug not in analyses]
        logger.info(f"Analyze: {len(items)} total, {cached_count} cached, {len(to_analyze)} need LLM")

        if to_analyze:
            from src.tools.call_llm import LLMClient
            client = LLMClient()

            new_analyses = await analyze_articles_batch(to_analyze, client=client)
            analyses.update(new_analyses)

            # Save to DB
            for slug, analysis in new_analyses.items():
                if analysis:
                    try:
                        repo.save_analysis(slug, analysis)
                    except Exception as e:
                        logger.warning(f"Failed to save analysis for {slug}: {e}")

        context.official_analyses = analyses
        success_count = sum(1 for a in analyses.values() if a is not None)
        logger.success(
            f"Analysis done: {success_count}/{len(items)} "
            f"({cached_count} cached, {len(to_analyze)} new LLM calls)"
        )
        return True


# ── Stage 4: Build Fragment ────────────────────────────────────────────────

class BuildOfficialFragmentStage(PipelineStage):
    """Generate HTML + MD fragments for the unified daily report."""

    def __init__(self):
        super().__init__("building_fragment_official")

    async def execute(self, context: PipelineContext) -> bool:
        items: list[OfficialItem] = context.official_items
        analyses: dict[str, Optional[OfficialAnalysis]] = context.official_analyses

        if not items:
            logger.info("No items for official report, using placeholder")
            context.official_html = '<p class="empty-state">今日无 Anthropic Research 或 DeepMind 新文章。</p>'
            context.official_md = "_今日无 Anthropic Research 或 DeepMind 新文章。_"
            return True

        date_compact = context.date.replace("-", "")
        html_fragment = officials_to_daily_html(items, analyses, date_compact)
        md_fragment = officials_to_daily_md(items, analyses, date_compact)

        context.official_html = html_fragment
        context.official_md = md_fragment
        logger.success(f"Official HTML+MD 片段已生成 (HTML: {len(html_fragment)} chars)")
        return True
