"""
Ascan 统一日报入口
==================
将 arXiv 论文精选 + GitHub 项目挖掘合并为一个本地 HTML 日报，标题格式：Ascan-YYYYMMDD

Usage
-----
    # 今日日报（默认，基于 ARXIV_DATE_OFFSET_DAYS 偏移）
    uv run python main_daily.py

    # 指定日期
    uv run python main_daily.py --date 20260420

    # 跳过 lock 保护，可重复运行同一天
    uv run python main_daily.py --dry-run
"""

from __future__ import annotations

import asyncio
import sys
import urllib3
from datetime import datetime, timedelta
from pathlib import Path

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from loguru import logger

project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from src.config.logging import setup_logging
from src.config.settings import get_settings
from src.database.connection import init_database
from src.tools.unified_report import build_unified_html


async def run_daily_unified(
    date_compact: str,  # YYYYMMDD
) -> None:
    """
    Run arXiv + GitHub pipelines and merge them into one local HTML report.

    Parameters
    ----------
    date_compact : str
        Target date in YYYYMMDD format.
    """
    settings = get_settings()

    # arXiv 周末不发布：如果数据日期是周六/周日，arXiv 查询回退到周五
    arxiv_dt = datetime.strptime(date_compact, "%Y%m%d")
    weekday = arxiv_dt.weekday()
    if weekday == 5:  # Saturday → Friday
        arxiv_dt -= timedelta(days=1)
    elif weekday == 6:  # Sunday → Friday
        arxiv_dt -= timedelta(days=2)
    date_dashed = arxiv_dt.strftime("%Y-%m-%d")
    if date_dashed != f"{date_compact[:4]}-{date_compact[4:6]}-{date_compact[6:8]}":
        logger.info(f"arXiv 数据日期回退到周五: {date_dashed}（报告日期: {date_compact}）")

    run_date = datetime.now().strftime("%Y%m%d")
    logger.info(f"=== Ascan 统一日报: {run_date} (数据日期: {date_compact}) ===")

    arxiv_ctx = None
    github_ctx = None

    # ── Step 1: arXiv pipeline ──────────────────────────────────────────────
    logger.info("Step 1: 运行 arXiv pipeline...")
    from main import run_multi_dimension_pipeline

    try:
        arxiv_ctx = await run_multi_dimension_pipeline(
            date=date_dashed,
        )
        arxiv_html = arxiv_ctx.arxiv_html or arxiv_ctx.arxiv_markdown
        if arxiv_html:
            logger.success(
                f"arXiv pipeline 完成，获取到 HTML 片段 ({len(arxiv_html)} chars)"
            )
        else:
            logger.warning("arXiv pipeline 未产出 HTML 片段（今日可能无论文）")
    except Exception as e:
        logger.error(f"arXiv pipeline 异常（继续 GitHub 部分）: {e}")
        arxiv_html = None

    # ── Step 2: GitHub daily pipeline ─────────────────────────────────────────
    logger.info("Step 2: 运行 GitHub pipeline...")
    from main_github import run_daily as run_github_daily

    try:
        github_ctx = await run_github_daily(
            date_compact=date_compact,
        )
        github_html = github_ctx.github_html or github_ctx.github_markdown
        if github_html:
            logger.success(
                f"GitHub pipeline 完成，获取到 HTML 片段 ({len(github_html)} chars)"
            )
        else:
            logger.warning("GitHub pipeline 未产出 HTML 片段（今日可能无新仓库）")
    except Exception as e:
        logger.error(f"GitHub pipeline 异常（继续合并步骤）: {e}")
        github_html = None

    # ── Step 3: 官方动态跟踪 ────────────────────────────────────────────
    logger.info("Step 3: 运行官方动态 pipeline...")
    official_html = None
    official_md = None
    from main_official import run_daily as run_official_daily

    try:
        official_ctx = await run_official_daily(date_compact=date_compact)
        official_html = getattr(official_ctx, "official_html", None)
        official_md = getattr(official_ctx, "official_md", None)
        if official_html and "empty-state" not in official_html:
            logger.success(f"官方动态 pipeline 完成 ({len(official_html)} chars)")
        else:
            logger.info("官方动态 pipeline 无新文章")
    except Exception as e:
        logger.error(f"官方动态 pipeline 异常（继续合并步骤）: {e}")
        official_html = None
        official_md = None

    # ── Step 4: 独立博客订阅 ────────────────────────────────────────────
    logger.info("Step 4: 运行独立博客 pipeline...")
    blog_html = None
    blog_md = None
    from main_blog import run_daily as run_blog_daily

    try:
        blog_ctx = await run_blog_daily(date_compact=date_compact)
        blog_html = getattr(blog_ctx, "blog_html", None)
        blog_md = getattr(blog_ctx, "blog_md", None)
        if blog_html and "empty-state" not in blog_html:
            logger.success(f"独立博客 pipeline 完成 ({len(blog_html)} chars)")
        else:
            logger.info("独立博客 pipeline 无新文章")
    except Exception as e:
        logger.error(f"独立博客 pipeline 异常（继续合并步骤）: {e}")
        blog_html = None
        blog_md = None

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

    # ── Step 6: 微信公众号追踪 ────────────────────────────────────────────
    logger.info("Step 6: 运行微信公众号 pipeline...")
    wechat_html = None
    wechat_md = None

    try:
        from src.wechat_tracker.stages import (
            FetchWeChatStage, AnalyzeWeChatStage, BuildWeChatFragmentStage,
        )
        ws = get_settings()
        if ws.wechat_mp_ids and ws.wechat_rss_base_url:
            from main_wechat import run_daily as run_wechat_daily
            wechat_ctx = await run_wechat_daily(date_compact)
            wechat_html = getattr(wechat_ctx, "wechat_html", None)
            wechat_md = getattr(wechat_ctx, "wechat_md", None)
            if wechat_html and "empty-state" not in wechat_html:
                logger.success(f"微信 pipeline 完成 ({len(wechat_html)} chars)")
            else:
                logger.info("微信 pipeline 无新文章")
        else:
            logger.info("微信 tracker 未配置（wechat_mp_ids 或 wechat_rss_base_url 为空），跳过")
    except Exception as e:
        logger.error(f"微信 pipeline 异常（继续合并步骤）: {e}")
        wechat_html = None
        wechat_md = None

    # ── Step 7: Merge HTML ────────────────────────────────────────────────
    logger.info("Step 7: 合并统一日报...")
    from src.tools.unified_report import build_unified_html

    unified_html = build_unified_html(run_date, arxiv_html, github_html, official_html, blog_html, conference_html, wechat_html)

    output_dir = Path(settings.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    doc_title = f"Ascan-{run_date}"
    report_path = output_dir / f"{doc_title}.html"
    report_path.write_text(unified_html, encoding="utf-8")
    logger.success(f"HTML 日报已保存: {report_path}")

    # ── Step 4: Merge MD + 钉钉上传 ───────────────────────────────────
    from src.tools.report_md import build_unified_md

    arxiv_md = getattr(arxiv_ctx, "arxiv_md", None) if arxiv_ctx else None
    github_md = getattr(github_ctx, "github_md", None) if github_ctx else None
    unified_md = build_unified_md(run_date, arxiv_md, github_md, official_md, blog_md, conference_md, wechat_md)

    md_path = output_dir / f"{doc_title}.md"
    md_path.write_text(unified_md, encoding="utf-8")
    logger.success(f"Markdown 日报已保存: {md_path}")

    if settings.dingtalk_workspace_id:
        logger.info(f"钉钉上传提示：请在 Claude Code 中执行 /upload-ascan 将 {md_path.name} 上传到钉钉知识库")

    logger.success(f"统一日报流水线完成: {doc_title}")


async def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Ascan 统一日报 — arXiv + GitHub 合并为本地 HTML"
    )
    parser.add_argument("--date", "-d", help="日期 YYYYMMDD（默认：今天）")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="跳过 lock 文件保护，可重复运行同一天的日报",
    )
    parser.add_argument(
        "--init-db", action="store_true", help="初始化数据库（首次运行）"
    )
    args = parser.parse_args()

    setup_logging("ascan", get_settings().log_level)

    if args.init_db:
        logger.info("初始化数据库...")
        init_database()
        logger.success("数据库初始化完成")
        return

    if args.date:
        date_compact = args.date.replace("-", "")
    else:
        # arXiv 在 UTC 14:00 (北京 22:00) 发布当日论文,早上跑取"今天"会返回 0。
        # 因此默认取昨天 (offset=1)。
        # arXiv 周末不发布:周一的"昨天"是周日 → 回退到周五。
        settings = get_settings()
        target_dt = datetime.now() - timedelta(days=settings.arxiv_date_offset_days)
        weekday = target_dt.weekday()  # 0=Mon … 6=Sun
        if weekday == 5:  # Saturday → Friday
            target_dt -= timedelta(days=1)
        elif weekday == 6:  # Sunday → Friday
            target_dt -= timedelta(days=2)
        date_compact = target_dt.strftime("%Y%m%d")

    # ── Lock file guard: skip if this date's report already ran successfully ──
    # Protects against duplicate runs triggered by macOS launchd / cron.
    # Only applies to automatic (no --date) non-dry-run invocations.
    if not args.dry_run and not args.date:
        today_compact = datetime.now().strftime("%Y%m%d")
        lock_path = Path("./logs") / f"ascan_{today_compact}.lock"
        if lock_path.exists():
            # Stale lock detection: if lock is older than 4 hours, treat as stale
            STALE_LOCK_SECONDS = 4 * 3600
            try:
                lock_age = datetime.now().timestamp() - lock_path.stat().st_mtime
                if lock_age > STALE_LOCK_SECONDS:
                    logger.warning(
                        f"Lock 文件已过期（{lock_age/3600:.1f}h > 4h），视为残留锁，删除并重试"
                    )
                    lock_path.unlink(missing_ok=True)
                else:
                    logger.info(f"今日报告已运行完成（lock: {lock_path}），跳过重复执行")
                    return
            except OSError:
                lock_path.unlink(missing_ok=True)
        lock_path.parent.mkdir(exist_ok=True)
        lock_path.write_text(f"{datetime.now().isoformat()}\n", encoding="utf-8")
        logger.info(f"Lock 文件已创建: {lock_path}")
        try:
            await run_daily_unified(date_compact)
        except BaseException:
            lock_path.unlink(missing_ok=True)
            logger.warning("运行失败或被中断，已移除 lock 文件（下次触发将重试）")
            raise
    else:
        await run_daily_unified(date_compact)


if __name__ == "__main__":
    asyncio.run(main())
