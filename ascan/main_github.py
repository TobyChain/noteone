"""
GitHub Agent Entry Point
========================
Daily run (default):
    uv run python main_github.py

Weekly run (Monday):
    uv run python main_github.py --weekly

Force specific date:
    uv run python main_github.py --date 20260420
"""

from __future__ import annotations

import asyncio
import sys
import urllib3
from datetime import datetime
from pathlib import Path

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from loguru import logger

project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from src.config.logging import setup_logging
from src.config.settings import get_settings
from src.database.connection import init_database
from src.pipeline.core import PipelineContext
from src.github_agent.stages import (
    FetchReposStage,
    EnrichReposStage,
    AnalyzeReposStage,
    BuildGithubFragmentStage,
)


async def run_daily(
    date_compact: str,
) -> PipelineContext:
    """
    Daily GitHub report pipeline.
    date_compact: YYYYMMDD
    """
    context = PipelineContext(date=date_compact, subjects=[])
    context.github_report_path = None
    context.github_report_url = None

    logger.info(f"=== GitHub Daily Pipeline: {date_compact} ===")

    stages = [
        FetchReposStage(),
        EnrichReposStage(),
        AnalyzeReposStage(),
        BuildGithubFragmentStage(weekly=False),
    ]

    for stage in stages:
        logger.info(f"-- Stage: {stage.name} --")
        try:
            ok = await stage.execute(context)
        except Exception as e:
            logger.exception(f"Stage {stage.name} raised: {e}")
            ok = False
        if not ok:
            logger.error(f"Stage {stage.name} failed, aborting pipeline")
            context.error_message = f"Stage {stage.name} failed"
            break

    if context.error_message:
        logger.error(f"Pipeline failed: {context.error_message}")
    else:
        logger.success(
            f"Daily pipeline done. "
            f"Repos: {len(context.github_repos)}, "
            f"Report: {context.github_report_path}, "
            f"KM: {context.github_report_url or 'skipped'}"
        )
    return context


async def run_weekly(date_compact: str) -> PipelineContext:
    """
    Weekly GitHub report pipeline.
    Aggregates repos seen over the past 7 days from DB, then generates a
    consolidated weekly report.
    """
    from src.database.connection import get_db_session
    from src.database.repositories import RepoRepository
    from src.github_agent.models import RepoInfo
    from src.github_agent.report import repos_to_weekly_markdown

    logger.info(f"=== GitHub Weekly Pipeline: week ending {date_compact} ===")

    # Pull last 7 days of repos from DB
    db = get_db_session()
    repo_repo = RepoRepository(db)
    recent_db = repo_repo.get_recent(days=7)

    if not recent_db:
        logger.warning(
            "No repos in DB for the past 7 days, running daily fetch first..."
        )
        ctx = await run_daily(date_compact)
        recent_db = repo_repo.get_recent(days=7)

    # Rebuild RepoInfo objects from DB rows
    repos_by_day: dict[str, list[RepoInfo]] = {}
    all_repos_map: dict[str, RepoInfo] = {}

    for row in recent_db:
        repo = RepoInfo(
            full_name=row.full_name,
            owner=row.owner,
            name=row.name,
            description=row.description,
            stars=row.stars,
            forks=row.forks or 0,
            language=row.language,
            topics=row.topics or [],
            url=row.url,
            pushed_at=row.pushed_at,
            created_at=row.repo_created_at,
        )
        day = row.first_seen_date or date_compact
        repos_by_day.setdefault(day, []).append(repo)
        all_repos_map[row.full_name] = repo

    # Rebuild analyses from DB (analyzed rows)
    from src.github_agent.models import RepoAnalysis

    analyses: dict[str, RepoAnalysis | None] = {}
    for row in recent_db:
        if row.analyzed and row.one_liner:
            try:
                analyses[row.full_name] = RepoAnalysis(
                    one_liner=row.one_liner or "",
                    positioning=row.positioning or "",
                    core_tech=row.core_tech or "",
                    use_cases=row.use_cases or "",
                    comparison=row.comparison or "",
                    watch_reason=row.watch_reason or "",
                    relevance=row.relevance or "一般",
                )
            except Exception:
                analyses[row.full_name] = None
        else:
            analyses[row.full_name] = None

    html_fragment = repos_to_weekly_markdown(
        repos_by_day=repos_by_day,
        analyses=analyses,
        week_end_date=date_compact,
    )

    context = PipelineContext(date=date_compact, subjects=[])
    context.github_repos = list(all_repos_map.values())
    context.github_analyses = analyses
    context.github_html = html_fragment
    context.github_markdown = html_fragment  # 兼容旧字段，内容已改为 HTML 片段
    logger.info(
        "Weekly GitHub aggregation generated in memory only; weekly file output is disabled"
    )

    return context


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="GitHub AI Agent")
    parser.add_argument("--date", "-d", help="Date in YYYYMMDD format (default: today)")
    parser.add_argument(
        "--weekly",
        "-w",
        action="store_true",
        help="Generate weekly report (run on Mondays)",
    )
    parser.add_argument(
        "--init-db", action="store_true", help="Initialize database tables"
    )
    args = parser.parse_args()

    setup_logging("github", get_settings().log_level)

    if args.init_db:
        logger.info("Initializing database...")
        init_database()
        logger.success("Database initialized")
        return

    # Determine date
    if args.date:
        date_compact = args.date.replace("-", "")
    else:
        date_compact = datetime.now().strftime("%Y%m%d")

    if args.weekly:
        ctx = await run_weekly(date_compact)
    else:
        ctx = await run_daily(date_compact)

    if ctx.error_message:
        logger.error(f"Exiting with error: {ctx.error_message}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
