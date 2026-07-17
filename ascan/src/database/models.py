"""
数据库模型定义 - SQLAlchemy ORM
"""

from datetime import datetime
from typing import Optional, List

from sqlalchemy import (
    Column, Integer, String, Text, DateTime,
    Float, ForeignKey, JSON, Boolean, create_engine, Index
)
from sqlalchemy.orm import relationship, declarative_base
from sqlalchemy.sql import func

Base = declarative_base()


class PaperDB(Base):
    """论文数据表"""
    __tablename__ = "papers"
    
    id = Column(Integer, primary_key=True, index=True)
    arxiv_id = Column(String(20), unique=True, index=True, nullable=False)
    title = Column(Text, nullable=False)
    authors = Column(JSON, default=list)  # 存储为 JSON 数组
    abstract = Column(Text, default="")
    abs_url = Column(String(500), nullable=False)
    pdf_url = Column(String(500), nullable=True)
    doi = Column(String(100), nullable=True)
    doi_url = Column(String(500), nullable=True)
    published = Column(String(10), index=True)  # YYYY-MM-DD
    bibtex = Column(Text, nullable=True)
    
    # 机构和主图
    affiliations = Column(JSON, default=list)  # 作者机构列表
    primary_image_url = Column(String(500), nullable=True)  # 主图URL
    
    # LLM 分析结果
    trans_abs = Column(Text, default="")
    compressed = Column(Text, default="")
    keywords = Column(JSON, default=list)
    sub_topic = Column(String(100), index=True, default="未知")
    recommendation = Column(String(20), index=True, default="一般推荐")
    one_liner = Column(Text, nullable=True)
    core_recommendation = Column(Text, nullable=True)
    
    # 处理状态
    status = Column(String(20), default="pending")  # pending, processing, completed, failed
    error_message = Column(Text, nullable=True)
    processed_at = Column(DateTime, nullable=True)
    
    # 元数据
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    
    # 关联
    daily_reports = relationship(
        "DailyReportDB", 
        secondary="paper_daily_report",
        back_populates="papers"
    )
    
    def __repr__(self):
        return f"<Paper({self.arxiv_id}: {self.title[:50]}...)>"
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "id": self.id,
            "arxiv_id": self.arxiv_id,
            "title": self.title,
            "authors": self.authors or [],
            "affiliations": self.affiliations or [],
            "primary_image_url": self.primary_image_url,
            "abstract": self.abstract,
            "abs_url": self.abs_url,
            "pdf_url": self.pdf_url,
            "doi": self.doi,
            "doi_url": self.doi_url,
            "published": self.published,
            "bibtex": self.bibtex,
            "trans_abs": self.trans_abs,
            "compressed": self.compressed,
            "keywords": self.keywords or [],
            "sub_topic": self.sub_topic,
            "recommendation": self.recommendation,
            "one_liner": self.one_liner,
            "core_recommendation": self.core_recommendation,
            "status": self.status,
            "processed_at": self.processed_at.isoformat() if self.processed_at else None,
        }


class DailyReportDB(Base):
    """每日报告表"""
    __tablename__ = "ascan_daily_reports"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(String(10), unique=True, index=True, nullable=False)  # YYYY-MM-DD
    total_count = Column(Integer, default=0)
    highly_recommended_count = Column(Integer, default=0)
    recommended_count = Column(Integer, default=0)
    file_url = Column(String(500), nullable=True)
    status = Column(String(20), default="pending")  # pending, generating, completed, failed
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    completed_at = Column(DateTime, nullable=True)

    # 关联
    papers = relationship(
        "PaperDB",
        secondary="paper_daily_report",
        back_populates="daily_reports"
    )

    def __repr__(self):
        return f"<DailyReport({self.date}: {self.total_count} papers)>"


class PaperDailyReport(Base):
    """论文与日报的关联表"""
    __tablename__ = "paper_daily_report"

    paper_id = Column(Integer, ForeignKey("papers.id"), primary_key=True)
    daily_report_id = Column(Integer, ForeignKey("ascan_daily_reports.id"), primary_key=True)


class ProcessingLogDB(Base):
    """处理日志表 - 用于追踪状态"""
    __tablename__ = "processing_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    date = Column(String(10), index=True, nullable=False)
    stage = Column(String(50), nullable=False)  # fetching, parsing, analyzing, etc.
    status = Column(String(20), nullable=False)  # started, success, failed
    message = Column(Text, nullable=True)
    progress = Column(Integer, default=0)  # 0-100
    duration_seconds = Column(Float, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    
    # 索引
    __table_args__ = (
        Index('idx_date_stage', 'date', 'stage'),
    )
    
    def __repr__(self):
        return f"<ProcessingLog({self.date} {self.stage}: {self.status})>"


class RepoDB(Base):
    """GitHub 仓库记录表"""
    __tablename__ = "github_repos"

    id = Column(Integer, primary_key=True, autoincrement=True)
    full_name = Column(String(200), unique=True, nullable=False, index=True)
    owner = Column(String(100), nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    stars = Column(Integer, default=0)
    forks = Column(Integer, default=0)
    language = Column(String(50), nullable=True)
    topics = Column(JSON, default=list)
    url = Column(String(500), nullable=False)
    pushed_at = Column(String(30), nullable=True)
    repo_created_at = Column(String(30), nullable=True)

    # LLM 分析字段
    one_liner = Column(String(200), nullable=True)
    positioning = Column(Text, nullable=True)
    core_tech = Column(Text, nullable=True)
    use_cases = Column(Text, nullable=True)
    comparison = Column(Text, nullable=True)
    watch_reason = Column(Text, nullable=True)
    relevance = Column(String(20), nullable=True)

    # 追踪字段
    first_seen_date = Column(String(10), nullable=True, index=True)   # YYYY-MM-DD
    last_seen_date = Column(String(10), nullable=True, index=True)    # YYYY-MM-DD
    seen_count = Column(Integer, default=1)
    stars_history = Column(JSON, default=dict)   # {"2026-04-20": 4200, ...}
    analyzed = Column(Boolean, default=False)

    created_at_ts = Column(DateTime, default=datetime.utcnow)
    updated_at_ts = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "full_name": self.full_name,
            "owner": self.owner,
            "name": self.name,
            "description": self.description,
            "stars": self.stars,
            "forks": self.forks,
            "language": self.language,
            "topics": self.topics or [],
            "url": self.url,
            "pushed_at": self.pushed_at,
            "one_liner": self.one_liner,
            "positioning": self.positioning,
            "core_tech": self.core_tech,
            "use_cases": self.use_cases,
            "comparison": self.comparison,
            "watch_reason": self.watch_reason,
            "relevance": self.relevance,
            "first_seen_date": self.first_seen_date,
            "last_seen_date": self.last_seen_date,
            "seen_count": self.seen_count,
            "stars_history": self.stars_history or {},
        }


class OfficialItemDB(Base):
    """官方动态跟踪（Anthropic/OpenAI）"""
    __tablename__ = "official_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source = Column(String(30), nullable=False, index=True)   # anthropic/openai
    slug = Column(String(300), unique=True, nullable=False, index=True)
    url = Column(String(500), nullable=False)
    title = Column(Text, nullable=True)
    date = Column(String(30), nullable=True)
    category = Column(String(100), nullable=True)              # Alignment/Interpretability 等
    item_type = Column(String(20), default="article")          # article/commit
    summary = Column(Text, nullable=True)                      # 首段/commit message
    content = Column(Text, nullable=True)                      # 全文截取前2000字

    # LLM 分析
    one_liner = Column(String(200), nullable=True)
    summary_cn = Column(Text, nullable=True)
    core_insight = Column(Text, nullable=True)
    ecommerce_connection = Column(Text, nullable=True)
    relevance = Column(String(20), nullable=True)

    # 增量追踪
    sitemap_lastmod = Column(String(30), nullable=True)        # sitemap lastmod 或 commit sha
    first_seen_date = Column(String(10), nullable=True, index=True)
    last_seen_date = Column(String(10), nullable=True, index=True)
    analyzed = Column(Boolean, default=False)

    created_at_ts = Column(DateTime, default=datetime.utcnow)
    updated_at_ts = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class BlogPostDB(Base):
    """独立博客订阅（RSS）"""
    __tablename__ = "blog_posts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source = Column(String(30), nullable=False, index=True)    # ruanyifeng/sebastian/lilianweng
    slug = Column(String(300), unique=True, nullable=False, index=True)
    url = Column(String(500), nullable=False)
    title = Column(Text, nullable=True)
    date = Column(String(30), nullable=True)                   # YYYY-MM-DD
    source_label = Column(String(50), nullable=True)           # 中文如"阮一峰周刊"
    summary = Column(Text, nullable=True)
    content = Column(Text, nullable=True)                      # 全文截取前2000字

    # LLM 分析
    one_liner = Column(String(200), nullable=True)
    summary_cn = Column(Text, nullable=True)
    ecommerce_connection = Column(Text, nullable=True)
    relevance = Column(String(20), nullable=True)

    # 增量追踪
    first_seen_date = Column(String(10), nullable=True, index=True)
    last_seen_date = Column(String(10), nullable=True, index=True)
    analyzed = Column(Boolean, default=False)

    created_at_ts = Column(DateTime, default=datetime.utcnow)
    updated_at_ts = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ConferencePaperDB(Base):
    """会议论文追踪"""
    __tablename__ = "conference_papers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    paper_key = Column(String(300), unique=True, nullable=False, index=True)
    title = Column(Text, nullable=False)
    authors = Column(JSON, default=list)
    abstract = Column(Text, nullable=True)
    venue = Column(String(100), nullable=False, index=True)
    venue_full_name = Column(String(300), nullable=True)
    rank = Column(String(5), nullable=False, index=True)
    category = Column(String(20), nullable=True)
    year = Column(Integer, nullable=True, index=True)
    publication_date = Column(String(10), nullable=True)
    doi = Column(String(200), nullable=True)
    url = Column(String(500), nullable=True)
    pdf_url = Column(String(500), nullable=True)
    citation_count = Column(Integer, default=0)
    tldr = Column(Text, nullable=True)
    keywords = Column(JSON, default=list)
    paper_type = Column(String(50), nullable=True)

    one_liner = Column(String(200), nullable=True)
    summary_cn = Column(Text, nullable=True)
    core_contribution = Column(Text, nullable=True)
    ecommerce_connection = Column(Text, nullable=True)
    relevance = Column(String(20), nullable=True)

    source = Column(String(20), default="papers_cool")
    first_seen_date = Column(String(10), nullable=True, index=True)
    last_seen_date = Column(String(10), nullable=True, index=True)
    analyzed = Column(Boolean, default=False)

    created_at_ts = Column(DateTime, default=datetime.utcnow)
    updated_at_ts = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class WeChatArticleDB(Base):
    """微信公众号文章追踪"""
    __tablename__ = "wechat_articles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    article_id = Column(String(500), unique=True, nullable=False, index=True)
    title = Column(Text, nullable=False)
    url = Column(String(800), nullable=False)
    mp_id = Column(String(100), nullable=False, index=True)
    mp_name = Column(String(200), nullable=True)
    publish_time = Column(String(50), nullable=True)
    author = Column(String(200), nullable=True)
    summary = Column(Text, nullable=True)
    content = Column(Text, nullable=True)
    cover_url = Column(String(800), nullable=True)

    one_liner = Column(String(200), nullable=True)
    summary_cn = Column(Text, nullable=True)
    keywords = Column(JSON, default=list)
    core_recommendation = Column(Text, nullable=True)
    relevance = Column(String(20), nullable=True)

    first_seen_date = Column(String(10), nullable=True, index=True)
    last_seen_date = Column(String(10), nullable=True, index=True)
    analyzed = Column(Boolean, default=False)

    created_at_ts = Column(DateTime, default=datetime.utcnow)
    updated_at_ts = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
