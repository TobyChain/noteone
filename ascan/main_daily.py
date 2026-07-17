"""
Ascan 统一日报入口（薄 CLI）
================================
委托 orchestrator.py 运行单个模块或合并日报。无 lock —— 编排由闹闹 / run_all 协调。

Usage
-----
    # 今日全量（并发跑各模块 + 合并）
    uv run python main_daily.py

    # 指定日期全量
    uv run python main_daily.py --date 20260716

    # 单模块（片段落盘到 logs/fragments/{date}/）
    uv run python main_daily.py --module arxiv --date 20260716
    uv run python main_daily.py --module wechat

    # 合并已跑模块的片段为日报
    uv run python main_daily.py --merge --date 20260716

    # 列出可用模块
    uv run python main_daily.py --list-modules

    # 初始化数据库
    uv run python main_daily.py --init-db
"""
from __future__ import annotations

import asyncio
import json
import sys
import urllib3
from pathlib import Path

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from loguru import logger

project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from src.config.logging import setup_logging
from src.config.settings import get_settings
from src.database.connection import init_database

import orchestrator


async def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Ascan 统一日报 — 模块编排 + 合并（无 lock）")
    parser.add_argument("--date", "-d", help="报告日期 YYYYMMDD（默认：今天）")
    parser.add_argument("--module", "-m", help="只跑单个模块（arxiv/github/official/blog/conference/wechat）")
    parser.add_argument("--merge", action="store_true", help="只合并已跑模块的片段为日报")
    parser.add_argument("--list-modules", action="store_true", help="列出可用模块后退出")
    parser.add_argument("--init-db", action="store_true", help="初始化数据库")
    args = parser.parse_args()

    setup_logging("ascan", get_settings().log_level)

    if args.init_db:
        logger.info("初始化数据库...")
        init_database()
        logger.success("数据库初始化完成")
        return

    if args.list_modules:
        print("\n".join(orchestrator.module_names()))
        return

    date_compact = (args.date.replace("-", "") if args.date else orchestrator.today_compact())

    if args.merge:
        result = await orchestrator.merge_report(date_compact)
        print(json.dumps(result, ensure_ascii=False))
        return

    if args.module:
        result = await orchestrator.run_module(args.module, date_compact)
        print(json.dumps(result, ensure_ascii=False))
        return

    # Default: run all modules concurrently + merge
    result = await orchestrator.run_all(date_compact)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
