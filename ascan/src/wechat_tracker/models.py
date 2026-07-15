"""WeChat public account article data models."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class WeChatArticle:
    article_id: str  # unique key: mp_id + url
    title: str
    url: str
    mp_id: str
    mp_name: str
    publish_time: str = ""  # ISO 8601
    author: str = ""
    summary: str = ""
    content: str = ""  # full article body
    cover_url: str = ""


@dataclass
class WeChatAnalysis:
    one_liner: str = ""
    summary_cn: str = ""
    keywords: list[str] = field(default_factory=list)
    core_recommendation: str = ""
    relevance: str = "一般推荐"
