"""
GitHub Agent Pipeline Stages.

FetchReposStage   -> fetch trending + search API repos
EnrichReposStage  -> fetch README/file-tree for top-N repos
AnalyzeReposStage -> LLM batch analysis
PublishReportStage -> generate HTML fragment for unified daily report
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from loguru import logger

from src.pipeline.core import PipelineStage, PipelineContext, Stage, Status
from src.github_agent.fetcher import GitHubFetcher
from src.github_agent.analyzer import analyze_repos_batch
from src.github_agent.models import RepoInfo, RepoAnalysis
from src.github_agent.report import repos_to_daily_html, repos_to_weekly_markdown
from src.database.connection import get_db_session
from src.database.repositories import RepoRepository
from src.config.settings import get_settings


# ── Stage 1: Fetch ────────────────────────────────────────────────────────────

class FetchReposStage(PipelineStage):
    """
    Fetch repos from GitHub Trending + Search API.

    Key behaviour:
    - Already-analyzed repos are pushed to the END of the list so the
      top-N analysis window always sees fresh repos first.
    - search_by_topic_skip_known() keeps fetching extra pages until it
      has enough NEW repos to fill the per-topic quota.
    - The final list = [new repos sorted by stars] + [old repos sorted by stars]
      so the daily table still shows the full landscape.
    """

    def __init__(self):
        super().__init__("fetching")

    async def execute(self, context: PipelineContext) -> bool:
        settings = get_settings()
        fetcher = GitHubFetcher(token=settings.github_token)

        # Pull the set of all repos we've already LLM-analyzed
        db = get_db_session()
        repo_repo = RepoRepository(db)
        analyzed_names: set[str] = repo_repo.get_all_analyzed_names()
        logger.info(f"Already analyzed in DB: {len(analyzed_names)} repos")

        new_repos: list[RepoInfo] = []   # never-analyzed repos
        old_repos: list[RepoInfo] = []   # already-analyzed repos (shown in table but not re-analyzed)

        # 1. Trending (daily) — classify into new / old
        try:
            trending = fetcher.fetch_trending_ai(since="daily")
            for r in trending:
                (old_repos if r.full_name in analyzed_names else new_repos).append(r)
            logger.info(
                f"Trending daily: {len(trending)} total "
                f"({len(trending) - len([r for r in trending if r.full_name in analyzed_names])} new)"
            )
        except Exception as e:
            logger.warning(f"Trending fetch failed (non-fatal): {e}")

        # 2. Search API by topic — use skip_known to prioritize fresh repos
        for topic in settings.github_topics:
            try:
                fresh = fetcher.search_by_topic_skip_known(
                    topic=topic,
                    skip_names=analyzed_names,
                    min_stars=settings.github_min_stars,
                    want=settings.github_max_repos_per_topic,
                    sort="updated",
                    max_pages=5,
                )
                new_repos.extend(fresh)
                logger.info(f"Topic '{topic}': {len(fresh)} new repos")
            except Exception as e:
                logger.warning(f"Topic search '{topic}' failed (non-fatal): {e}")

        # Deduplicate within each bucket
        new_repos = fetcher.deduplicate(new_repos)
        new_repos = fetcher.filter_ai_relevant(new_repos, min_stars=settings.github_min_stars)
        new_repos.sort(key=lambda r: r.stars, reverse=True)

        old_repos = fetcher.deduplicate(old_repos)
        old_repos = [r for r in old_repos if r.full_name not in {x.full_name for x in new_repos}]
        old_repos.sort(key=lambda r: r.stars, reverse=True)

        # Final list: new first, then old — analysis window will naturally hit new ones
        repos = new_repos + old_repos

        logger.success(
            f"Fetch done: {len(new_repos)} new + {len(old_repos)} known = {len(repos)} total"
        )

        # Persist to DB
        today = context.date.replace("-", "")
        for repo in repos:
            repo_repo.upsert(repo, today)

        context.github_repos = repos
        context.github_analyzed_names = analyzed_names   # carry forward for later stages
        return True


# ── Stage 2: Enrich ──────────────────────────────────────────────────────────

class EnrichReposStage(PipelineStage):
    """Fetch README + file tree for top-N repos that haven't been analyzed yet."""

    def __init__(self):
        super().__init__("parsing")

    async def execute(self, context: PipelineContext) -> bool:
        settings = get_settings()
        repos: list[RepoInfo] = context.github_repos
        if not repos:
            logger.warning("No repos to enrich, skipping")
            return True

        # Use the analyzed_names set carried from FetchReposStage (avoids per-row DB query)
        analyzed_names: set[str] = getattr(context, "github_analyzed_names", set())

        fetcher = GitHubFetcher(token=settings.github_token)
        top_n = settings.github_top_analyze

        # Only enrich repos that are NOT already analyzed, up to top_n
        to_enrich = [r for r in repos[:top_n] if r.full_name not in analyzed_names]
        skip_count = top_n - len(to_enrich)

        logger.info(
            f"Enrich: top_n={top_n}, already_analyzed={skip_count}, "
            f"need_enrich={len(to_enrich)}"
        )

        for i, repo in enumerate(to_enrich, 1):
            try:
                enriched = fetcher.enrich_repo(repo)
                # Replace in the original list
                idx = repos.index(repo)
                repos[idx] = enriched
                logger.debug(f"[{i}/{len(to_enrich)}] Enriched {repo.full_name}")
            except Exception as e:
                logger.warning(f"Enrich failed for {repo.full_name}: {e}")

        context.github_repos = repos
        return True


# ── Stage 3: Analyze ─────────────────────────────────────────────────────────

class AnalyzeReposStage(PipelineStage):
    """LLM batch analysis of top-N repos, skipping already-analyzed ones."""

    def __init__(self):
        super().__init__("analyzing")

    async def execute(self, context: PipelineContext) -> bool:
        settings = get_settings()
        repos: list[RepoInfo] = context.github_repos
        if not repos:
            logger.warning("No repos to analyze, skipping")
            context.github_analyses = {}
            return True

        db = get_db_session()
        repo_repo = RepoRepository(db)
        top_n = settings.github_top_analyze
        top_repos = repos[:top_n]

        # Thanks to FetchReposStage ordering, top_repos should be mostly new repos.
        # Any already-analyzed repo that sneaked in (e.g. from Trending) is restored from DB.
        analyzed_names: set[str] = getattr(context, "github_analyzed_names", set())

        analyses: dict[str, Optional[RepoAnalysis]] = {}

        # ── Pass 1: restore already-analyzed repos from DB ───────────────────
        cached_count = 0
        for repo in top_repos:
            if repo.full_name not in analyzed_names:
                continue
            row = repo_repo.get_by_full_name(repo.full_name)
            if row and row.analyzed and row.one_liner:
                try:
                    analyses[repo.full_name] = RepoAnalysis(
                        one_liner=row.one_liner or "",
                        positioning=row.positioning or "",
                        core_tech=row.core_tech or "",
                        use_cases=row.use_cases or "",
                        comparison=row.comparison or "",
                        watch_reason=row.watch_reason or "",
                        relevance=row.relevance or "一般",
                    )
                    cached_count += 1
                    logger.info(f"[cache] {repo.full_name}: {row.one_liner[:40]}")
                except Exception as e:
                    logger.warning(f"Failed to restore cached analysis for {repo.full_name}: {e}")
                    analyses[repo.full_name] = None

        # ── Pass 2: LLM 并发分析（QPS=15）──────────────────────────────
        to_analyze = [r for r in top_repos if r.full_name not in analyses]
        logger.info(
            f"Analyze: top_n={top_n}, cached={cached_count}, "
            f"need_llm={len(to_analyze)}"
        )

        if to_analyze:
            import asyncio
            from src.tools.call_llm import LLMClient
            from src.github_agent.analyzer import analyze_repo_async
            client = LLMClient()

            async def _run_one(repo):
                logger.info(f"Analyzing: {repo.full_name}")
                return repo, await analyze_repo_async(repo, client)

            pair_results = await asyncio.gather(*[_run_one(r) for r in to_analyze])
            for repo, analysis in pair_results:
                analyses[repo.full_name] = analysis
                if analysis:
                    try:
                        repo_repo.save_analysis(repo.full_name, analysis)
                    except Exception as e:
                        logger.warning(f"Failed to save analysis for {repo.full_name}: {e}")

        context.github_analyses = analyses
        success_count = sum(1 for a in analyses.values() if a is not None)
        logger.success(
            f"Analysis done: {success_count}/{len(top_repos)} total "
            f"({cached_count} from cache, {len(to_analyze)} new LLM calls)"
        )
        return True


# ── Stage 4: Build HTML fragment ─────────────────────────────────────────────

class BuildGithubFragmentStage(PipelineStage):
    """Generate GitHub HTML fragment for the unified daily report."""

    def __init__(self, weekly: bool = False):
        super().__init__("building_fragment")
        self.weekly = weekly

    async def execute(self, context: PipelineContext) -> bool:
        settings = get_settings()
        repos: list[RepoInfo] = context.github_repos
        analyses: dict[str, Optional[RepoAnalysis]] = context.github_analyses

        if not repos:
            logger.warning("No repos for report, skipping")
            return True

        date_compact = context.date.replace("-", "")

        # ── Generate HTML fragment for unified daily report ─────────────────
        if self.weekly:
            repos_by_day = {context.date: repos}
            html_fragment = repos_to_weekly_markdown(
                repos_by_day=repos_by_day,
                analyses=analyses,
                week_end_date=date_compact,
            )
        else:
            html_fragment = repos_to_daily_html(
                repos=repos,
                analyses=analyses,
                report_date=date_compact,
            )

        from src.tools.report_md import repos_to_daily_md
        md_fragment = repos_to_daily_md(repos=repos, analyses=analyses, report_date=date_compact)

        context.github_html = html_fragment
        context.github_markdown = html_fragment
        context.github_md = md_fragment
        logger.success("GitHub HTML + MD 片段已生成，等待统一日报合并")

        return True
