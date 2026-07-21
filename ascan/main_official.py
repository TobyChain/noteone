"""
Ascan 官方动态跟踪入口
=====================
抓取 Anthropic Research、OpenAI Research 的最新动态，
生成 HTML+MD 片段供统一日报合并。

Usage
-----
    uv run python main_official.py
    uv run python main_official.py --date 20260609
    uv run python main_official.py --init-db
"""
from __future__ import annotations

import sys
from pathlib import Path

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

sys.path.insert(0, str(Path(__file__).parent))

from src.pipeline.core import PipelineContext, Stage
from src.pipeline.runner import run_stage_pipeline, run_module_cli
from src.official_tracker.stages import (
    FetchOfficialStage,
    EnrichArticlesStage,
    AnalyzeOfficialStage,
    BuildOfficialFragmentStage,
)


async def run_daily(date_compact: str) -> PipelineContext:
    return await run_stage_pipeline(
        [FetchOfficialStage(), EnrichArticlesStage(), AnalyzeOfficialStage(), BuildOfficialFragmentStage()],
        [Stage.FETCHING, Stage.PARSING, Stage.ANALYZING, Stage.GENERATING],
        date_compact,
    )


if __name__ == "__main__":
    run_module_cli("Ascan 官方动态跟踪", "ascan_official", run_daily, "official_html")
