"""Blog Subscription Pipeline Stages — RSS 抓取 + LLM 分析 + 日报生成。

FetchBlogStage       -> fetch RSS feeds, detect new posts, filter by 180-day recency
AnalyzeBlogStage     -> LLM concurrent analysis (Chinese summaries)
BuildBlogFragmentStage -> generate HTML + MD with LLM analysis
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from loguru import logger

from src.pipeline.core import PipelineStage, PipelineContext, Stage, Status
from src.blog_subs.rss_parser import fetch_all_feeds
from src.blog_subs.models import BlogPost
from src.blog_subs.report import blogs_to_daily_html, blogs_to_daily_md
from src.blog_subs.analyzer import analyze_posts_batch
from src.database.connection import get_db_session
from src.database.repositories import BlogPostRepository

_DAYS_RECENT = 30


def _parse_date_loose(date_str: str) -> datetime | None:
    """Parse date strings like '2026-06-26', 'Sat, 27 Ju', '2026-06-26T00:00:00'."""
    if not date_str:
        return None
    for fmt in ["%Y-%m-%d", "%a, %d %b", "%Y-%m-%dT%H:%M:%S"]:
        try:
            return datetime.strptime(date_str.strip()[: len(fmt)], fmt)
        except ValueError:
            continue
    # Try just YYYY-MM-DD prefix
    try:
        return datetime.strptime(date_str[:10], "%Y-%m-%d")
    except ValueError:
        return None


# ── Stage 1: Fetch ──────────────────────────────────────────────────────────

class FetchBlogStage(PipelineStage):
    """Fetch all RSS feeds, detect new posts, filter by 180-day recency, dedup against official tracker."""

    def __init__(self):
        super().__init__("fetching_blog")

    async def execute(self, context: PipelineContext) -> bool:
        db = get_db_session()
        repo = BlogPostRepository(db)

        known_slugs = repo.get_all_known_slugs()
        analyzed_slugs = repo.get_all_analyzed_slugs()
        official_urls = repo.get_all_official_urls()
        today = context.date.replace("-", "")

        cutoff = datetime.now() - timedelta(days=_DAYS_RECENT)

        from src.config.settings import get_settings
        max_per_source = getattr(get_settings(), "blog_max_per_source", 2)
        all_posts = fetch_all_feeds(max_per_source=max_per_source)

        # Filter: new + within 180 days + not in official tracker
        new_posts = []
        skipped_old = 0
        skipped_dup = 0
        for post in all_posts:
            if post.slug in known_slugs:
                continue
            if post.url in official_urls:
                skipped_dup += 1
                continue
            post_date = _parse_date_loose(post.date or "")
            if post_date and post_date < cutoff:
                skipped_old += 1
                continue
            new_posts.append(post)

        if skipped_old:
            logger.info(f"跳过了 {skipped_old} 篇超过 {_DAYS_RECENT} 天的旧文章")
        if skipped_dup:
            logger.info(f"跳过了 {skipped_dup} 篇与官方动态重复的博客文章")

        # Upsert new posts to DB
        for post in new_posts:
            repo.upsert_discovered(
                slug=post.slug, url=post.url, title=post.title or "",
                date=post.date or "", source_label=post.source_label,
                summary=post.summary or "", today=today,
            )

        if new_posts:
            logger.success(f"发现 {len(new_posts)} 篇新博客文章（共 {len(all_posts)} 篇已知）")
        else:
            logger.info(f"无新博客文章（{len(all_posts)} 篇全部已读）")

        context.blog_posts = new_posts
        context.blog_analyzed_slugs = analyzed_slugs
        return True


# ── Stage 2: Analyze (LLM) ─────────────────────────────────────────────────

class AnalyzeBlogStage(PipelineStage):
    """LLM 并发分析新博客文章，生成中文摘要。已分析的文章从缓存恢复，跳过 LLM 调用。"""

    def __init__(self, max_concurrency: int = 10):
        super().__init__("analyzing_blog")
        self.max_concurrency = max_concurrency

    async def execute(self, context: PipelineContext) -> bool:
        posts: list[BlogPost] = context.blog_posts

        if not posts:
            logger.info("无新博客文章需要 LLM 分析")
            context.blog_analyses = {}
            return True

        db = get_db_session()
        repo = BlogPostRepository(db)
        analyzed_slugs: set[str] = getattr(context, "blog_analyzed_slugs", set())

        from src.blog_subs.models import BlogAnalysis

        analyses: dict[str, Optional[BlogAnalysis]] = {}

        # ── Pass 1: restore already-analyzed from DB ──────────────────
        cached_count = 0
        for post in posts:
            if post.slug not in analyzed_slugs:
                continue
            row = repo.get_cached_analysis(post.slug)
            if row and row.analyzed and row.one_liner:
                analyses[post.slug] = BlogAnalysis(
                    one_liner=row.one_liner or "",
                    summary_cn=row.summary_cn or "",
                    ecommerce_connection=row.ecommerce_connection or "",
                    relevance=row.relevance or "一般",
                )
                cached_count += 1

        # ── Pass 2: LLM 分析未缓存的 ─────────────────────────────────
        to_analyze = [p for p in posts if p.slug not in analyses]
        logger.info(f"Analyze: {len(posts)} total, {cached_count} cached, {len(to_analyze)} need LLM")

        if to_analyze:
            new_analyses = await analyze_posts_batch(
                to_analyze, max_concurrency=self.max_concurrency,
            )
            analyses.update(new_analyses)

            # Save to DB
            for slug, analysis in new_analyses.items():
                if analysis:
                    try:
                        repo.save_analysis(slug, analysis)
                    except Exception as e:
                        logger.warning(f"Failed to save analysis for {slug}: {e}")

        context.blog_analyses = analyses
        success_count = sum(1 for a in analyses.values() if a is not None)
        logger.success(
            f"Analysis done: {success_count}/{len(posts)} "
            f"({cached_count} cached, {len(to_analyze)} new LLM calls)"
        )
        return True


# ── Stage 3: Build Fragment ────────────────────────────────────────────────

class BuildBlogFragmentStage(PipelineStage):
    """Generate HTML + MD fragments with LLM analysis results."""

    def __init__(self):
        super().__init__("building_fragment_blog")

    async def execute(self, context: PipelineContext) -> bool:
        posts: list[BlogPost] = context.blog_posts
        analyses: dict = getattr(context, "blog_analyses", {})

        if not posts:
            logger.info("无博客帖子，使用占位符")
            context.blog_html = '<p class="empty-state">今日无独立博客更新。</p>'
            context.blog_md = "_今日无独立博客更新。_"
            return True

        date_compact = context.date.replace("-", "")
        html_fragment = blogs_to_daily_html(posts, analyses, date_compact)
        md_fragment = blogs_to_daily_md(posts, analyses, date_compact)

        context.blog_html = html_fragment
        context.blog_md = md_fragment
        logger.success(f"博客 HTML+MD 片段已生成 (HTML: {len(html_fragment)} chars, {len(posts)} 篇)")
        return True
