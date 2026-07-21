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

import sys
from pathlib import Path

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

sys.path.insert(0, str(Path(__file__).parent))

from src.pipeline.core import PipelineContext, Stage
from src.pipeline.runner import run_stage_pipeline, run_module_cli
from src.blog_subs.stages import FetchBlogStage, AnalyzeBlogStage, BuildBlogFragmentStage


async def run_daily(date_compact: str) -> PipelineContext:
    return await run_stage_pipeline(
        [FetchBlogStage(), AnalyzeBlogStage(), BuildBlogFragmentStage()],
        [Stage.FETCHING, Stage.ANALYZING, Stage.GENERATING],
        date_compact,
    )


if __name__ == "__main__":
    run_module_cli("Ascan 独立博客订阅", "ascan_blog", run_daily, "blog_html")
