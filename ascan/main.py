"""
ArXiv AI Agent — arXiv 论文精选 pipeline 入口

Usage
-----
    # 默认运行（取昨天论文）
    .venv/bin/python main.py

    # 指定日期
    .venv/bin/python main.py --date 2026-06-01

    # 查询 / 热点 / 方向
    .venv/bin/python main.py --query "agent"
    .venv/bin/python main.py --hot
    .venv/bin/python main.py --direction "智能体框架"
"""

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
from src.pipeline.core import PipelineContext, Stage, Status
from src.pipeline.stages import (
    FetchStage,
    ParseStage,
    ScoreStage,
    AnalyzeStage,
    GenerateReportStage,
)


async def run_multi_dimension_pipeline(
    date: str = None,
    subjects: list = None,
) -> PipelineContext:
    settings = get_settings()

    if date is None:
        target_date = datetime.now() - timedelta(days=settings.arxiv_date_offset_days)
        date = target_date.strftime("%Y-%m-%d")

    if subjects is None:
        subjects = settings.arxiv_subjects

    logger.info(f"🚀 启动多维度评分流水线: {date}, 主题: {subjects}")

    context = PipelineContext(date=date, subjects=subjects)
    stages = [
        FetchStage(max_results=settings.max_papers_per_subject),
        ParseStage(max_papers=settings.max_total_papers),
        ScoreStage(),
        AnalyzeStage(),
        GenerateReportStage(output_dir=settings.output_dir),
    ]

    stage_enums = [Stage.FETCHING, Stage.PARSING, Stage.SCORING, Stage.ANALYZING, Stage.GENERATING]

    for stage, stage_enum in zip(stages, stage_enums):
        context.start_stage(stage_enum)
        try:
            ok = await stage.execute(context)
        except Exception as e:
            logger.exception(f"阶段 {stage.name} 异常: {e}")
            ok = False
        status = Status.SUCCESS if ok else Status.FAILED
        context.end_stage(stage_enum, status)
        if not ok:
            context.error_message = f"阶段 {stage.name} 失败"
            break

    return context


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="ArXiv AI Agent — 论文精选")
    parser.add_argument("--date", "-d", help="目标日期 (YYYY-MM-DD)")
    parser.add_argument("--subjects", "-s", help="主题列表，逗号分隔")
    parser.add_argument("--init-db", action="store_true", help="初始化数据库")
    parser.add_argument("--scheduler", action="store_true", help="启动定时调度器")
    parser.add_argument("--query", "-q", help="查询关键词")
    parser.add_argument("--hot", action="store_true", help="显示热点论文")
    parser.add_argument("--weekly", action="store_true", help="生成周报")
    parser.add_argument("--direction", help="查看特定研究方向")

    args = parser.parse_args()
    setup_logging("arxiv_v3", get_settings().log_level)

    if args.init_db:
        init_database()
        return

    if args.scheduler:
        from src.core.scheduler import init_default_schedule
        scheduler = init_default_schedule()
        scheduler.start()
        try:
            while True:
                await asyncio.sleep(1)
        except KeyboardInterrupt:
            scheduler.stop()
        return

    if args.query:
        from src.core.query_engine import PaperQueryEngine, SearchCriteria
        results = PaperQueryEngine().search(SearchCriteria(keywords=args.query.split(",")), limit=20)
        print(f"\n🔍 搜索 '{args.query}' 的结果:\n")
        for p in results:
            print(f"  [{p['recommendation']}] {p['title'][:80]}")
        return

    if args.hot:
        from src.core.query_engine import PaperQueryEngine
        results = PaperQueryEngine().get_hot_papers(days=7, limit=20)
        print("\n🔥 最近 7 天热点论文:\n")
        for p in results:
            print(f"  [{p['recommendation']}] {p['title'][:80]}")
        return

    if args.weekly:
        from src.core.query_engine import TrendAnalyzer
        report = TrendAnalyzer().generate_weekly_report()
        print(f"\n📅 周报: {report['period']}\n总论文数: {report['total_papers']}")
        return

    if args.direction:
        from src.core.query_engine import PaperQueryEngine
        from src.core.scoring import ResearchDirection
        results = PaperQueryEngine().get_by_direction(ResearchDirection(args.direction), limit=20)
        print(f"\n📊 {args.direction} 方向论文:\n")
        for p in results:
            print(f"  [{p['recommendation']}] {p['title'][:80]}")
        return

    subjects = args.subjects.split(",") if args.subjects else None
    result = await run_multi_dimension_pipeline(date=args.date, subjects=subjects)

    if result.error_message:
        logger.error(f"执行失败: {result.error_message}")
        sys.exit(1)
    else:
        logger.success("执行完成")


if __name__ == "__main__":
    asyncio.run(main())
