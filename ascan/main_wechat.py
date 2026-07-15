"""
Ascan 微信公众号追踪入口
=========================
通过 we-mp-rss 服务的 RSS 端点抓取订阅公众号文章，LLM 分析后生成 HTML+MD 片段。

Usage
-----
    uv run python main_wechat.py
    uv run python main_wechat.py --date 20260708
    uv run python main_wechat.py --init-db
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
from src.wechat_tracker.stages import (
    FetchWeChatStage, AnalyzeWeChatStage, BuildWeChatFragmentStage,
)


async def run_daily(date_compact: str) -> PipelineContext:
    """Run the WeChat tracker pipeline."""
    date_dashed = f"{date_compact[:4]}-{date_compact[4:6]}-{date_compact[6:8]}"
    context = PipelineContext(date=date_dashed, subjects=[])

    stages = [FetchWeChatStage(), AnalyzeWeChatStage(), BuildWeChatFragmentStage()]
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

    parser = argparse.ArgumentParser(description="Ascan 微信公众号追踪")
    parser.add_argument("--date", "-d", help="日期 YYYYMMDD（默认：今天）")
    parser.add_argument("--init-db", action="store_true", help="初始化数据库")
    args = parser.parse_args()

    setup_logging("ascan_wechat", get_settings().log_level)

    if args.init_db:
        logger.info("初始化数据库...")
        init_database()
        logger.success("数据库初始化完成")
        return

    date_compact = args.date if args.date else __import__("datetime").datetime.now().strftime("%Y%m%d")

    context = await run_daily(date_compact)
    if context.wechat_html and "empty-state" not in (context.wechat_html or ""):
        logger.success(f"微信 pipeline 完成 ({len(context.wechat_html)} chars)")
    else:
        logger.info("微信 pipeline 无新文章")

    if context.error_message:
        logger.error(f"Pipeline 异常: {context.error_message}")


if __name__ == "__main__":
    asyncio.run(main())
