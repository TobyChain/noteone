"""Conference paper data models."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ConferencePaper:
    paper_key: str
    title: str
    authors: list[str] = field(default_factory=list)
    abstract: Optional[str] = None
    keywords: str = ""
    paper_type: str = ""
    venue: str = ""
    venue_full_name: str = ""
    rank: str = "A"
    category: str = "ai"
    year: Optional[int] = None
    publication_date: Optional[str] = None
    doi: Optional[str] = None
    url: Optional[str] = None
    pdf_url: Optional[str] = None
    citation_count: int = 0
    tldr: Optional[str] = None
    source: str = "papers_cool"


@dataclass
class ConferenceAnalysis:
    one_liner: str = ""
    summary_cn: str = ""
    keywords: list[str] = field(default_factory=list)
    core_recommendation: str = ""
    relevance: str = "一般推荐"
