"""Shared runner for the per-module daily pipelines (blog/official/conf/wechat).

Collapses the previously copy-pasted run_daily() + argparse main() in each
main_*.py into two helpers.
"""
from __future__ import annotations

import asyncio
from datetime import datetime

from loguru import logger

from src.pipeline.core import PipelineContext, PipelineStage, Stage, Status


async def run_stage_pipeline(
    stages: list[PipelineStage],
    stage_enums: list[Stage],
    date_compact: str,
) -> PipelineContext:
    """Execute stages sequentially with lifecycle tracking; abort on first failure."""
    date_dashed = f"{date_compact[:4]}-{date_compact[4:6]}-{date_compact[6:8]}"
    context = PipelineContext(date=date_dashed, subjects=[])

    for stage, stage_enum in zip(stages, stage_enums):
        context.start_stage(stage_enum)
        try:
            ok = await stage.execute(context)
        except Exception as e:
            logger.error(f"Stage {stage.name} failed: {e}")
            ok = False

        context.end_stage(stage_enum, Status.SUCCESS if ok else Status.FAILED)

        if not ok:
            context.error_message = f"Stage {stage.name} failed"
            break

    return context


def run_module_cli(description: str, log_name: str, run_daily, html_field: str) -> None:
    """Standard CLI for a single-module pipeline: --date / --init-db."""
    import argparse

    from src.config.logging import setup_logging
    from src.config.settings import get_settings
    from src.database.connection import init_database

    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--date", "-d", help="日期 YYYYMMDD（默认：今天）")
    parser.add_argument("--init-db", action="store_true", help="初始化数据库")
    args = parser.parse_args()

    setup_logging(log_name, get_settings().log_level)

    if args.init_db:
        logger.info("初始化数据库...")
        init_database()
        logger.success("数据库初始化完成")
        return

    date_compact = args.date.replace("-", "") if args.date else datetime.now().strftime("%Y%m%d")

    context = asyncio.run(run_daily(date_compact))

    html = getattr(context, html_field, None) or ""
    if html and "empty-state" not in html:
        logger.success(f"{description} pipeline 完成 ({len(html)} chars)")
    else:
        logger.info(f"{description} pipeline 未产出新内容")

    if context.error_message:
        logger.error(f"Pipeline 异常: {context.error_message}")
