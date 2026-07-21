"""
Ascan 微信公众号追踪入口
=========================
通过 NoteOne server 内置微信服务抓取订阅公众号文章，LLM 分析后生成 HTML+MD 片段。

Usage
-----
    uv run python main_wechat.py
    uv run python main_wechat.py --date 20260708
    uv run python main_wechat.py --init-db
"""
from __future__ import annotations

import sys
from pathlib import Path

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

sys.path.insert(0, str(Path(__file__).parent))

from src.pipeline.core import PipelineContext, Stage
from src.pipeline.runner import run_stage_pipeline, run_module_cli
from src.wechat_tracker.stages import (
    FetchWeChatStage, AnalyzeWeChatStage, BuildWeChatFragmentStage,
)


async def run_daily(date_compact: str) -> PipelineContext:
    return await run_stage_pipeline(
        [FetchWeChatStage(), AnalyzeWeChatStage(), BuildWeChatFragmentStage()],
        [Stage.FETCHING, Stage.ANALYZING, Stage.GENERATING],
        date_compact,
    )


if __name__ == "__main__":
    run_module_cli("Ascan 微信公众号追踪", "ascan_wechat", run_daily, "wechat_html")
