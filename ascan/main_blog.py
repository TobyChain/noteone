"""
Ascan 独立博客订阅入口
=====================
抓取阮一峰周刊、Sebastian Raschka、Lilian Weng 的 RSS 订阅文章，
生成 HTML+MD 片段供统一日报合并。

Usage
-----
    uv run python main_blog.py
    uv run python main_blog.py --date 20260609
    uv run python main_blog.py --init-db
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from loguru import logger

project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from src.config.logging import setup_logging
from src.config.settings import get_settings
from src.database.connection import init_database
from src.pipeline.core import PipelineContext, Stage, Status
from src.blog_subs.stages import FetchBlogStage, AnalyzeBlogStage, BuildBlogFragmentStage


async def run_daily(date_compact: str) -> PipelineContext:
    """Run the blog subscription pipeline, return context with HTML+MD fragments."""
    date_dashed = f"{date_compact[:4]}-{date_compact[4:6]}-{date_compact[6:8]}"
    context = PipelineContext(date=date_dashed, subjects=[])

    stages = [FetchBlogStage(), AnalyzeBlogStage(), BuildBlogFragmentStage()]
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


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Ascan 独立博客订阅")
    parser.add_argument("--date", "-d", help="日期 YYYYMMDD（默认：今天）")
    parser.add_argument("--init-db", action="store_true", help="初始化数据库")
    args = parser.parse_args()

    setup_logging("ascan_blog", get_settings().log_level)

    if args.init_db:
        logger.info("初始化数据库...")
        init_database()
        logger.success("数据库初始化完成")
        return

    date_compact = args.date if args.date else __import__("datetime").datetime.now().strftime("%Y%m%d")

    context = await run_daily(date_compact)
    if context.blog_html:
        logger.success(f"博客 pipeline 完成 ({len(context.blog_html)} chars)")
    else:
        logger.info("博客 pipeline 未产出内容")

    if context.error_message:
        logger.error(f"Pipeline 异常: {context.error_message}")


if __name__ == "__main__":
    asyncio.run(main())
