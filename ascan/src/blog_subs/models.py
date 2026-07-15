"""Pydantic schemas for blog subscription posts and LLM analysis."""
from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field


class BlogPost(BaseModel):
    """Raw blog post data from RSS feeds."""
    source: str                     # ruanyifeng / sebastian / lilianweng
    slug: str                       # unique identifier
    url: str                        # full URL
    title: Optional[str] = None
    date: Optional[str] = None      # YYYY-MM-DD
    source_label: str = ""          # Chinese label like "阮一峰周刊"
    summary: Optional[str] = None
    content: Optional[str] = None   # full article body (first 2000 chars)


class BlogAnalysis(BaseModel):
    """LLM analysis output for one blog post."""
    one_liner: str = Field(description="用大白话说清这篇博客讲了什么（中文，≤30字）")
    summary_cn: str = Field(description="中文摘要/翻译（2-3句）")
    ecommerce_connection: str = Field(description="与大模型及智能体方向的关联（中文，1-2句），如Agent架构/LLM训练/RAG/推理等")
    relevance: str = Field(description='与大模型及智能体方向的相关性，只能是"高度相关"或"相关"或"一般"或"较低" 中的一个')
