"""
Ascan 会议论文追踪入口
=====================
抓取 A/B 类顶会论文（Semantic Scholar + DBLP），LLM 分析后生成 HTML+MD 片段。

Usage
-----
    uv run python main_conf.py
    uv run python main_conf.py --date 20260706
    uv run python main_conf.py --init-db
"""
from __future__ import annotations

import sys
from pathlib import Path

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

sys.path.insert(0, str(Path(__file__).parent))

from src.pipeline.core import PipelineContext, Stage
from src.pipeline.runner import run_stage_pipeline, run_module_cli
from src.conf_tracker.stages import FetchConfStage, AnalyzeConfStage, BuildConfFragmentStage


async def run_daily(date_compact: str) -> PipelineContext:
    return await run_stage_pipeline(
        [FetchConfStage(), AnalyzeConfStage(), BuildConfFragmentStage()],
        [Stage.FETCHING, Stage.ANALYZING, Stage.GENERATING],
        date_compact,
    )


if __name__ == "__main__":
    run_module_cli("Ascan 会议论文追踪", "ascan_conf", run_daily, "conference_html")
