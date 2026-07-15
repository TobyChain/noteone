"""Pydantic schemas for official tracker items and LLM analysis."""
from __future__ import annotations
from typing import Optional, List
from pydantic import BaseModel, Field


class OfficialItem(BaseModel):
    """Raw data from official sources (Anthropic/OpenAI)."""
    source: str                     # anthropic / openai
    slug: str                       # unique identifier
    url: str                        # full URL
    title: Optional[str] = None
    date: Optional[str] = None      # YYYY-MM-DD or ISO date
    category: Optional[str] = None  # Alignment/Interpretability or commit scope
    item_type: str = "article"      # article / commit
    summary: Optional[str] = None   # first paragraph or commit message
    content: Optional[str] = None   # full article body (first 2000 chars)
    sitemap_lastmod: Optional[str] = None


class OfficialAnalysis(BaseModel):
    """LLM analysis output for one official article."""
    one_liner: str = Field(description="用大白话说清这篇研究/更新讲了什么（中文，≤30字）")
    summary_cn: str = Field(description="中文摘要（2-3句）")
    core_insight: str = Field(description="核心技术洞察或贡献（中文，2-3句）")
    ecommerce_connection: str = Field(description="与大模型及智能体方向的关联（中文，1-2句），如Agent架构/LLM训练/RAG/推理等")
    relevance: str = Field(description="与大模型及智能体方向的相关性：高度相关/相关/一般/较低")
