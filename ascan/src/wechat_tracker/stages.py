"""WeChat tracker pipeline stages — Fetch + Analyze + BuildFragment."""
from __future__ import annotations

from loguru import logger

from src.pipeline.core import PipelineStage, PipelineContext
from src.wechat_tracker.fetcher import fetch_all_mps
from src.wechat_tracker.analyzer import analyze_articles_batch
from src.wechat_tracker.report import wechat_articles_to_html, wechat_articles_to_md
from src.wechat_tracker.models import WeChatAnalysis
from src.database.connection import get_db_session
from src.database.repositories import WeChatArticleRepository


class FetchWeChatStage(PipelineStage):
    """Fetch articles via wechat-article-exporter (WAE) REST API, dedup against DB."""

    def __init__(self):
        super().__init__("fetching_wechat")

    async def execute(self, context: PipelineContext) -> bool:
        from src.config.settings import get_settings
        settings = get_settings()

        wae_url = getattr(settings, "wechat_wae_url", "")
        auth_key = getattr(settings, "wechat_wae_auth_key", "")
        mp_list = getattr(settings, "wechat_mp_ids", [])
        limit = getattr(settings, "wechat_limit_per_mp", 20)
        days_recent = getattr(settings, "wechat_days_recent", 30)

        if not wae_url or not auth_key or not mp_list:
            logger.warning("WeChat tracker 未配置 wae_url / auth_key / mp_ids，跳过")
            context.wechat_articles = []
            return True

        logger.info(f"Fetching WeChat via WAE from {wae_url}, {len(mp_list)} MPs, days_recent={days_recent}")

        all_articles = fetch_all_mps(wae_url, auth_key, mp_list, limit=limit, days_recent=days_recent)

        db = get_db_session()
        repo = WeChatArticleRepository(db)
        known_ids = repo.get_all_known_ids()
        analyzed_ids = repo.get_all_analyzed_ids()
        today = context.date.replace("-", "")

        # Dedup against DB: only carry forward articles never seen before.
        # This matches Blog/Official behavior — daily report shows NEW items only,
        # not a re-listing of everything in the recency window.
        new_articles = [a for a in all_articles if a.article_id not in known_ids]
        skipped_dup = len(all_articles) - len(new_articles)

        for article in new_articles:
            try:
                repo.upsert_discovered(
                    article_id=article.article_id,
                    title=article.title, url=article.url,
                    mp_id=article.mp_id, mp_name=article.mp_name,
                    publish_time=article.publish_time,
                    author=article.author,
                    summary=article.summary or "",
                    content=article.content or "",
                    cover_url=article.cover_url,
                    today=today,
                )
            except Exception as e:
                logger.warning(f"DB upsert failed for {article.article_id}: {e}")

        if skipped_dup:
            logger.info(f"WeChat: 跳过 {skipped_dup} 篇已知文章")
        if new_articles:
            logger.success(f"WeChat: 发现 {len(new_articles)} 篇新文章（最近 {days_recent} 天共 {len(all_articles)} 篇）")
        else:
            logger.info(f"WeChat: 无新文章（最近 {days_recent} 天共 {len(all_articles)} 篇全部已读）")

        context.wechat_articles = new_articles
        context.wechat_analyzed_ids = analyzed_ids
        return True


class AnalyzeWeChatStage(PipelineStage):
    """LLM concurrent analysis of WeChat articles. Cached results restored from DB."""

    def __init__(self, max_concurrency: int = 5):
        super().__init__("analyzing_wechat")
        self.max_concurrency = max_concurrency

    async def execute(self, context: PipelineContext) -> bool:
        articles = context.wechat_articles
        if not articles:
            logger.info("无 WeChat 文章需要 LLM 分析")
            context.wechat_analyses = {}
            return True

        db = get_db_session()
        repo = WeChatArticleRepository(db)
        analyzed_ids: set = getattr(context, "wechat_analyzed_ids", set())

        analyses: dict = {}
        cached_count = 0
        for article in articles:
            if article.article_id not in analyzed_ids:
                continue
            row = repo.get_cached_analysis(article.article_id)
            if row and row.analyzed and row.one_liner:
                kw = row.keywords if isinstance(row.keywords, list) else []
                analyses[article.article_id] = WeChatAnalysis(
                    one_liner=row.one_liner or "",
                    summary_cn=row.summary_cn or "",
                    keywords=kw,
                    core_recommendation=row.core_recommendation or "",
                    relevance=row.relevance or "一般推荐",
                )
                cached_count += 1

        to_analyze = [a for a in articles if a.article_id not in analyses]
        logger.info(f"WeChat analyze: {len(articles)} total, {cached_count} cached, {len(to_analyze)} need LLM")

        if to_analyze:
            new_analyses = await analyze_articles_batch(to_analyze,
                                                        max_concurrency=self.max_concurrency)
            analyses.update(new_analyses)
            for key, analysis in new_analyses.items():
                if analysis:
                    try:
                        repo.save_analysis(key, analysis)
                    except Exception as e:
                        logger.warning(f"Failed to save WeChat analysis for {key}: {e}")

        context.wechat_analyses = analyses
        success = sum(1 for a in analyses.values() if a and a.one_liner != "[分析失败]")
        logger.success(f"WeChat analysis done: {success}/{len(articles)}")
        return True


class BuildWeChatFragmentStage(PipelineStage):
    """Generate HTML + MD fragments for WeChat articles."""

    def __init__(self):
        super().__init__("building_fragment_wechat")

    async def execute(self, context: PipelineContext) -> bool:
        articles = context.wechat_articles
        analyses = getattr(context, "wechat_analyses", {})
        date_compact = context.date.replace("-", "")

        html = wechat_articles_to_html(articles, analyses, date_compact)
        md = wechat_articles_to_md(articles, analyses, date_compact)

        context.wechat_html = html
        context.wechat_md = md

        if articles:
            logger.success(f"WeChat HTML+MD 片段已生成 ({len(html)} chars, {len(articles)} 篇)")
        else:
            logger.info("WeChat: 使用占位符")
        return True
