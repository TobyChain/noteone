"""LLM analysis for conference papers — arXiv-style output."""
from __future__ import annotations

import asyncio
import json
from typing import Optional

from loguru import logger

from src.conf_tracker.models import ConferencePaper, ConferenceAnalysis


_PROMPT_TEMPLATE = """你是一位 AI 领域的学术论文分析专家。请分析以下会议论文，生成中文摘要和评估。

论文信息：
- 标题：{title}
- 会议：{venue} ({rank}类, {category})
- 作者：{authors}
- 摘要：{abstract}

请严格输出 JSON（不要包含 markdown 代码块标记）：
{{
  "one_liner": "一句话中文概括（20字以内）",
  "summary_cn": "中文摘要翻译+核心贡献（150字以内）",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "core_recommendation": "核心推荐语，说明为什么值得关注和与AI前沿的关联（50字以内）",
  "relevance": "极度推荐/很推荐/推荐/一般推荐/不推荐"
}}

relevance 判断标准：
- 极度推荐：突破性成果，对大模型/Agent/智能体架构有重大影响
- 很推荐：重要创新，对AI前沿有显著贡献
- 推荐：有价值的研究，有一定参考价值
- 一般推荐：相关性较低或增量改进
- 不推荐：与关注方向无关"""


def _extract_json(text: str) -> dict | None:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end])
            except json.JSONDecodeError:
                pass
    return None


async def _analyze_one(paper: ConferencePaper, llm_client, semaphore: asyncio.Semaphore) -> tuple[str, Optional[ConferenceAnalysis]]:
    async with semaphore:
        prompt = _PROMPT_TEMPLATE.format(
            title=paper.title,
            venue=paper.venue,
            rank=paper.rank,
            category=paper.category,
            authors=", ".join(paper.authors[:5]) + ("..." if len(paper.authors) > 5 else ""),
            abstract=paper.abstract or paper.tldr or "（无摘要）",
        )
        try:
            messages = [{"role": "user", "content": prompt}]
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(None, llm_client._call_api, messages)
            data = _extract_json(result)
            if data:
                return paper.paper_key, ConferenceAnalysis(
                    one_liner=data.get("one_liner", ""),
                    summary_cn=data.get("summary_cn", ""),
                    keywords=data.get("keywords", []),
                    core_recommendation=data.get("core_recommendation", ""),
                    relevance=data.get("relevance", "一般推荐"),
                )
        except Exception as e:
            logger.warning(f"LLM analysis failed for {paper.paper_key}: {e}")

        return paper.paper_key, ConferenceAnalysis(
            one_liner="[分析失败]",
            summary_cn="",
            keywords=[],
            core_recommendation="",
            relevance="不推荐",
        )


async def analyze_papers_batch(papers: list[ConferencePaper],
                               max_concurrency: int = 5) -> dict[str, Optional[ConferenceAnalysis]]:
    """Analyze conference papers concurrently using LLM."""
    from src.tools.call_llm import LLMClient
    client = LLMClient()
    semaphore = asyncio.Semaphore(max_concurrency)

    tasks = [_analyze_one(p, client, semaphore) for p in papers]
    results = await asyncio.gather(*tasks)

    analyses = {}
    for key, analysis in results:
        analyses[key] = analysis

    success = sum(1 for a in analyses.values() if a and a.one_liner != "[分析失败]")
    logger.info(f"Conference analysis: {success}/{len(papers)} succeeded")
    return analyses
