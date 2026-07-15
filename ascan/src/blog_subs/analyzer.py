"""LLM analysis for blog subscription posts."""
from __future__ import annotations

import asyncio
import json
import re
from typing import Optional

from loguru import logger

from src.blog_subs.models import BlogPost, BlogAnalysis


def _build_blog_prompt(post: BlogPost) -> str:
    """Construct LLM prompt for analyzing a blog post."""
    content_preview = (post.content or post.summary or "")[:1500]

    return f"""你是一位技术内容编辑。请为以下技术博客文章生成中文摘要，输出JSON格式。

## 文章信息
- 标题：{post.title or "未知"}
- 日期：{post.date or "未知"}
- 来源：{post.source_label}
- 摘要：{post.summary or ""}
- 内容摘要：{content_preview}

## 输出要求
请输出严格的 JSON 对象，包含以下字段：
- one_liner: 用大白话说清这篇博客讲了什么（中文，≤30字）
- summary_cn: 中文摘要/翻译（2-3句）

只输出 JSON，不要其他内容。"""


def _extract_json(text: str) -> Optional[dict]:
    """Extract JSON from LLM response."""
    if not text:
        return None
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return None


def analyze_post(post: BlogPost, client=None) -> Optional[BlogAnalysis]:
    """Analyze a single blog post using LLM."""
    if client is None:
        from src.tools.call_llm import LLMClient
        client = LLMClient()

    prompt = _build_blog_prompt(post)

    for attempt in range(3):
        try:
            resp = client.chat(prompt)
            data = _extract_json(resp)
            if not data:
                logger.warning(f"JSON extraction failed for {post.slug} (attempt {attempt+1})")
                continue

            return BlogAnalysis(
                one_liner=data.get("one_liner", ""),
                summary_cn=data.get("summary_cn", ""),
                ecommerce_connection="",
                relevance="一般",
            )
        except Exception as e:
            logger.warning(f"LLM analysis failed for {post.slug} (attempt {attempt+1}): {e}")

    logger.error(f"LLM analysis failed after 3 retries for {post.slug}")
    return None


async def analyze_post_async(post: BlogPost, client=None) -> Optional[BlogAnalysis]:
    """Async wrapper for analyze_post."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: analyze_post(post, client))


async def analyze_posts_batch(
    posts: list[BlogPost],
    max_concurrency: int = 5,
    client=None,
) -> dict[str, Optional[BlogAnalysis]]:
    """Analyze multiple posts concurrently. Returns {slug: analysis}."""
    semaphore = asyncio.Semaphore(max_concurrency)

    async def _limited(post):
        async with semaphore:
            return post.slug, await analyze_post_async(post, client)

    tasks = [_limited(post) for post in posts]
    results = await asyncio.gather(*tasks)
    return dict(results)
