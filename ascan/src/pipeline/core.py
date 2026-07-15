"""
流水线核心 - 事件驱动的处理架构
"""

import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from loguru import logger


class Stage(str, Enum):
    """处理阶段枚举"""
    FETCHING = "fetching"           # 获取数据
    PARSING = "parsing"             # 解析数据
    SCORING = "scoring"             # 多维度评分
    ANALYZING = "analyzing"         # LLM 分析
    GENERATING = "generating"       # 生成报告
    UPLOADING = "uploading"         # 上传文档
    COMPLETED = "completed"         # 完成
    FAILED = "failed"               # 失败


class Status(str, Enum):
    """状态枚举"""
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class PipelineContext:
    """流水线上下文"""
    date: str
    subjects: List[str]
    
    # 数据存储
    raw_ids: List[str] = field(default_factory=list)
    papers: List[Dict] = field(default_factory=list)
    analysis_results: List[Dict] = field(default_factory=list)
    report_url: Optional[str] = None

    # arXiv pipeline 输出
    selected_ids: List[str] = field(default_factory=list)   # 经评分过滤后的精选论文 ID
    report_path: Optional[str] = None                       # 统一日报报告本地路径

    # arXiv 报告内容
    arxiv_html: Optional[str] = None
    arxiv_markdown: Optional[str] = None  # 兼容旧字段
    arxiv_md: Optional[str] = None        # 纯 Markdown 片段

    # GitHub Agent 数据
    github_repos: List[Any] = field(default_factory=list)
    github_analyses: Dict[str, Any] = field(default_factory=dict)
    github_analyzed_names: Any = field(default_factory=set)  # set[str] of already-analyzed full_names
    github_report_path: Optional[str] = None
    github_report_url: Optional[str] = None
    github_html: Optional[str] = None
    github_markdown: Optional[str] = None  # 兼容旧字段
    github_md: Optional[str] = None        # 纯 Markdown 片段

    # Part 3 官方动态跟踪
    official_items: List[Any] = field(default_factory=list)
    official_analyses: Dict[str, Any] = field(default_factory=dict)
    official_analyzed_slugs: Any = field(default_factory=set)
    official_html: Optional[str] = None
    official_md: Optional[str] = None

    # Part 4 独立博客订阅
    blog_posts: List[Any] = field(default_factory=list)
    blog_analyses: Dict[str, Any] = field(default_factory=dict)
    blog_analyzed_slugs: Any = field(default_factory=set)
    blog_html: Optional[str] = None
    blog_md: Optional[str] = None

    # Part 5 会议论文追踪
    conference_papers: List[Any] = field(default_factory=list)
    conference_analyses: Dict[str, Any] = field(default_factory=dict)
    conference_analyzed_keys: Any = field(default_factory=set)
    conference_html: Optional[str] = None
    conference_md: Optional[str] = None

    # Part 6 微信公众号追踪
    wechat_articles: List[Any] = field(default_factory=list)
    wechat_analyses: Dict[str, Any] = field(default_factory=dict)
    wechat_analyzed_ids: Any = field(default_factory=set)
    wechat_html: Optional[str] = None
    wechat_md: Optional[str] = None
    
    # 状态追踪
    current_stage: Stage = Stage.FETCHING
    stage_status: Dict[Stage, Status] = field(default_factory=dict)
    stage_messages: Dict[Stage, str] = field(default_factory=dict)
    stage_start_times: Dict[Stage, datetime] = field(default_factory=dict)
    stage_end_times: Dict[Stage, datetime] = field(default_factory=dict)
    
    # 错误信息
    error_message: Optional[str] = None
    error_stage: Optional[Stage] = None
    
    # 统计
    total_papers: int = 0
    processed_count: int = 0
    failed_count: int = 0
    
    def __post_init__(self):
        for stage in Stage:
            self.stage_status[stage] = Status.PENDING
    
    def start_stage(self, stage: Stage):
        """开始一个阶段"""
        self.current_stage = stage
        self.stage_status[stage] = Status.RUNNING
        self.stage_start_times[stage] = datetime.now()
        logger.info(f"[{self.date}] 开始阶段: {stage.value}")
    
    def end_stage(self, stage: Stage, status: Status, message: str = ""):
        """结束一个阶段"""
        self.stage_status[stage] = status
        self.stage_end_times[stage] = datetime.now()
        self.stage_messages[stage] = message
        
        duration = self.get_stage_duration(stage)
        logger.info(
            f"[{self.date}] 阶段 {stage.value} 结束: {status.value} "
            f"(耗时: {duration:.2f}s) {message}"
        )
    
    def get_stage_duration(self, stage: Stage) -> float:
        """获取阶段耗时（秒）"""
        start = self.stage_start_times.get(stage)
        end = self.stage_end_times.get(stage)
        if start and end:
            return (end - start).total_seconds()
        return 0.0
    
    def get_total_duration(self) -> float:
        """获取总耗时"""
        if Stage.FETCHING in self.stage_start_times:
            start = self.stage_start_times[Stage.FETCHING]
            # 找到最后一个结束的时间
            for stage in reversed(list(Stage)):
                if stage in self.stage_end_times:
                    end = self.stage_end_times[stage]
                    return (end - start).total_seconds()
        return 0.0
    
    def to_dict(self) -> Dict:
        """转换为字典"""
        return {
            "date": self.date,
            "subjects": self.subjects,
            "current_stage": self.current_stage.value,
            "total_papers": self.total_papers,
            "processed_count": self.processed_count,
            "failed_count": self.failed_count,
            "report_url": self.report_url,
            "error": self.error_message,
            "stages": {
                stage.value: {
                    "status": self.stage_status[stage].value,
                    "message": self.stage_messages.get(stage, ""),
                    "duration": self.get_stage_duration(stage)
                }
                for stage in Stage if stage != Stage.FAILED
            },
            "total_duration": self.get_total_duration()
        }


class PipelineStage(ABC):
    """流水线阶段基类"""
    
    def __init__(self, name: str, enabled: bool = True):
        self.name = name
        self.enabled = enabled
    
    @abstractmethod
    async def execute(self, context: PipelineContext) -> bool:
        """执行阶段，返回是否成功"""
        pass
    
    async def rollback(self, context: PipelineContext):
        """回滚（可选实现）"""
        pass


