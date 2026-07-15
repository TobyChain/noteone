"""LLM analysis for WeChat public account articles."""
from __future__ import annotations

import asyncio
import json
from typing import Optional

from loguru import logger

from src.wechat_tracker.models import WeChatArticle, WeChatAnalysis


_PROMPT_TEMPLATE = """你是一位 AI 领域的内容分析专家。请分析以下微信公众号文章，生成中文摘要和评估。

文章信息：
- 公众号：{mp_name}
- 标题：{title}
- 作者：{author}
- 内容摘要：{content}

请严格输出 JSON（不要包含 markdown 代码块标记）：
{{
  "one_liner": "一句话中文概括（30字以内）",
  "summary_cn": "中文摘要（200字以内）",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "core_recommendation": "为什么值得关注，与大模型/Agent/智能体的关联（80字以内）",
  "relevance": "极度推荐/很推荐/推荐/一般推荐/不推荐"
}}"""


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


async def _analyze_one(article: WeChatArticle, llm_client, semaphore) -> tuple[str, Optional[WeChatAnalysis]]:
    async with semaphore:
        # Use first 1500 chars of content to avoid token limit
        content = (article.content or article.summary or "（无内容）")[:1500]
        prompt = _PROMPT_TEMPLATE.format(
            mp_name=article.mp_name,
            title=article.title,
            author=article.author or "未知",
            content=content,
        )
        try:
            messages = [{"role": "user", "content": prompt}]
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(None, llm_client._call_api, messages)
            data = _extract_json(result)
            if data:
                return article.article_id, WeChatAnalysis(
                    one_liner=data.get("one_liner", ""),
                    summary_cn=data.get("summary_cn", ""),
                    keywords=data.get("keywords", []),
                    core_recommendation=data.get("core_recommendation", ""),
                    relevance=data.get("relevance", "一般推荐"),
                )
        except Exception as e:
            logger.warning(f"LLM analysis failed for {article.article_id}: {e}")

        return article.article_id, WeChatAnalysis(
            one_liner="[分析失败]",
            summary_cn="",
            keywords=[],
            core_recommendation="",
            relevance="不推荐",
        )


async def analyze_articles_batch(articles: list[WeChatArticle],
                                 max_concurrency: int = 5) -> dict[str, Optional[WeChatAnalysis]]:
    """Analyze WeChat articles concurrently using LLM."""
    from src.tools.call_llm import LLMClient
    client = LLMClient()
    semaphore = asyncio.Semaphore(max_concurrency)

    tasks = [_analyze_one(a, client, semaphore) for a in articles]
    results = await asyncio.gather(*tasks)

    analyses = {}
    for key, analysis in results:
        analyses[key] = analysis

    success = sum(1 for a in analyses.values() if a and a.one_liner != "[分析失败]")
    logger.info(f"WeChat analysis: {success}/{len(articles)} succeeded")
    return analyses
