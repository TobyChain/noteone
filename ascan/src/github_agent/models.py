"""
Pydantic schemas for GitHub repo data and LLM analysis.
"""
from __future__ import annotations
from typing import Optional, List
from pydantic import BaseModel, Field


class RepoInfo(BaseModel):
    """Raw repo data fetched from GitHub API / Trending."""
    full_name: str                        # e.g. "microsoft/autogen"
    owner: str
    name: str
    description: Optional[str] = None
    stars: int = 0
    forks: int = 0
    language: Optional[str] = None
    topics: List[str] = Field(default_factory=list)
    url: str                              # https://github.com/owner/repo
    homepage: Optional[str] = None
    pushed_at: Optional[str] = None       # ISO 8601
    created_at: Optional[str] = None
    stars_today: Optional[int] = None     # from Trending page
    readme_summary: Optional[str] = None  # first 3000 chars of README
    top_files: List[str] = Field(default_factory=list)  # key source file paths


class RepoAnalysis(BaseModel):
    """LLM analysis output for one repo."""
    one_liner: str = Field(description="用大白话说清这个项目能干什么（中文，≤30字）")
    positioning: str = Field(description="项目定位：解决什么问题，面向什么用户（中文，2-3句）")
    core_tech: str = Field(description="核心技术亮点或架构特点（中文，2-3句）")
    use_cases: str = Field(description="典型使用场景（中文，1-2句）")
    comparison: str = Field(description="与同类项目对比（如AutoGen/LangGraph/CrewAI），或'暂无同类'（中文）")
    watch_reason: str = Field(description="为什么值得关注，star增长原因分析（中文，1-2句）")
    relevance: str = Field(
        description="与大模型及智能体方向的相关性：高度相关/相关/一般/较低"
    )
