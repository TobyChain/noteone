"""
配置管理 - 使用 Pydantic Settings 集中管理
"""

from typing import List, Optional
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置类"""
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"  # 忽略未定义的环境变量
    )
    
    # ==================== LLM 配置（OpenAI 兼容 API）====================
    llm_api_key: str = Field(
        default="",
        description="LLM API Key（主后端）"
    )
    llm_base_url: str = Field(
        default="https://yunwu.ai/v1",
        description="LLM API Base URL（主后端，OpenAI 兼容）"
    )
    llm_model: str = Field(
        default="deepseek-v4-pro",
        description="LLM 模型名称"
    )
    llm_timeout: int = Field(
        default=120,
        description="LLM 请求超时时间（秒）"
    )
    llm_max_retries: int = Field(
        default=3,
        description="LLM 请求最大重试次数"
    )
    llm_max_concurrency: int = Field(
        default=5,
        description="LLM 最大并发请求数"
    )

    # 备用 LLM 后端（IdealAb）
    idealab_api_key: str = Field(
        default="",
        description="IdealAb API Key（备用）"
    )
    idealab_base_url: str = Field(
        default="https://idealab.alibaba-inc.com/api/openai/v1",
        description="IdealAb API Base URL（备用）"
    )

    # ==================== GitHub Agent 配置 ====================
    github_token: Optional[str] = Field(
        default=None,
        description="GitHub Personal Access Token (public_repo read scope)"
    )
    github_topics: List[str] = Field(
        default=[
            "digital-twin", "digital-avatar", "virtual-human",
            "recommendation-system", "product-recommendation", "e-commerce",
            "product-inspection", "compliance-detection", "content-moderation",
            "customer-service", "chatbot", "conversational-ai",
            "llm-agent", "ai-agent", "rag", "multi-agent",
        ],
        description="GitHub topic labels to search"
    )
    github_max_repos_per_topic: int = Field(
        default=8,
        description="每个 topic 最多抓取的仓库数"
    )
    github_min_stars: int = Field(
        default=500,
        description="最低 star 数过滤"
    )
    github_top_analyze: int = Field(
        default=20,
        description="送入 LLM 深度分析的 Top N 仓库数（分析结果用于相关性过滤表格）"
    )

    # ==================== ArXiv 配置 ====================
    arxiv_subjects: List[str] = Field(
        default=["cs.AI"],
        description="要抓取的 ArXiv 主题列表"
    )
    arxiv_date_offset_days: int = Field(
        default=1,
        description="抓取日期偏移（天）"
    )
    max_papers_per_subject: int = Field(
        default=200,
        description="每个主题最大论文数"
    )
    max_total_papers: int = Field(
        default=500,
        description="总共最大论文数"
    )
    
    # ==================== 推荐配置 ====================
    # 高优先级关键词（极度推荐触发词）
    high_priority_keywords: List[str] = Field(
        default=[
            # 大模型算法
            "large language model", "llm training", "llm inference",
            "mixture of experts", "moe", "flash attention",
            "lora", "qlora", "parameter-efficient",
            "long context", "speculative decoding",
            # Agent 算法
            "chain of thought", "tree of thought",
            "agent planning", "agent reasoning",
            "reinforcement learning agent", "rlhf",
            "mathematical reasoning", "code generation",
            # 智能体架构
            "multi-agent system", "agent framework",
            "tool calling", "function calling",
            "mcp", "model context protocol",
            "autonomous agent", "llm agent",
            "browser use", "web agent", "computer use",
            # 智能体记忆
            "retrieval augmented generation", "rag",
            "agent memory", "long-term memory",
            "knowledge retrieval", "vector database",
            "dense retrieval", "knowledge graph",
            # 大模型前沿
            "scaling law", "emergent ability",
            "alignment", "multimodal",
            "vision language model", "world model",
            "hallucination", "interpretability",
        ],
        description="高优先级关键词（极度推荐触发）"
    )

    # 头部机构（极度推荐触发）
    top_institutions: List[str] = Field(
        default=[
            "google", "openai", "meta", "deepmind",
            "anthropic", "microsoft", "apple", "samsung",
            "xiaomi", "huawei", "oppo",
            "百度", "腾讯", "阿里", "字节", "智谱"
        ],
        description="头部研究机构"
    )
    
    # ==================== 应用配置 ====================
    output_dir: str = Field(
        default="./docs",
        description="输出目录"
    )
    database_url: str = Field(
        default="postgresql://noteone:noteone@localhost:5432/noteone",
        description="数据库连接字符串"
    )
    log_level: str = Field(
        default="INFO",
        description="日志级别"
    )

    # ==================== 钉钉知识库上传 ====================
    dingtalk_workspace_id: Optional[str] = Field(
        default=None,
        description="钉钉知识库 Workspace ID"
    )
    dingtalk_parent_node_id: Optional[str] = Field(
        default=None,
        description="钉钉知识库父文件夹 Node ID"
    )

    # ==================== 官方动态跟踪配置 ====================
    anthropic_sitemap_url: str = Field(
        default="https://www.anthropic.com/sitemap.xml",
        description="Anthropic Research sitemap URL"
    )
    openai_research_sitemap_url: str = Field(
        default="https://openai.com/sitemap.xml/research/",
        description="OpenAI Research sitemap URL"
    )
    official_scrape_delay: float = Field(
        default=1.0,
        description="文章抓取间隔秒数（礼貌爬取）"
    )
    official_max_per_source: int = Field(
        default=3,
        description="每个官方动态源最多取几篇最新文章"
    )

    # ==================== 独立博客 RSS 源配置 ====================
    blog_rss_sources: List[dict] = Field(
        default=[
            {"name": "ruanyifeng", "url": "https://www.ruanyifeng.com/blog/atom.xml", "label": "阮一峰周刊"},
            {"name": "sebastian", "url": "https://magazine.sebastianraschka.com/feed", "label": "Sebastian Raschka"},
            {"name": "lilianweng", "url": "https://lilianweng.github.io/index.xml", "label": "Lilian Weng"},
            {"name": "huyenchip", "url": "https://huyenchip.com/feed.xml", "label": "Chip Huyen"},
            {"name": "simonw", "url": "https://simonwillison.net/atom/everything/", "label": "Simon Willison"},
            {"name": "eugeneyan", "url": "https://eugeneyan.com/rss/", "label": "Eugene Yan"},
            {"name": "karpathy", "url": "https://karpathy.github.io/feed.xml", "label": "Andrej Karpathy"},
            {"name": "bair", "url": "https://bair.berkeley.edu/blog/feed.xml", "label": "BAIR (Berkeley AI)"},
            {"name": "openai", "url": "https://openai.com/news/rss.xml", "label": "OpenAI Blog"},
            {"name": "apple_ml", "url": "https://machinelearning.apple.com/rss.xml", "label": "Apple ML Research"},
            {"name": "huggingface", "url": "https://huggingface.co/blog/feed.xml", "label": "HuggingFace Blog"},
            {"name": "nvidia_tech", "url": "https://developer.nvidia.com/blog/feed", "label": "NVIDIA Tech Blog"},
            {"name": "nvidia", "url": "https://blogs.nvidia.com/feed/", "label": "NVIDIA Blog"},
            {"name": "aws_ml", "url": "https://aws.amazon.com/blogs/machine-learning/feed/", "label": "AWS ML Blog"},
            {"name": "github_eng", "url": "https://github.blog/engineering/feed/", "label": "GitHub Engineering"},
            {"name": "tldr_ai", "url": "https://tldr.tech/api/rss/ai", "label": "TLDR AI"},
            {"name": "import_ai", "url": "https://importai.substack.com/feed", "label": "Import AI"},
            {"name": "aws_china", "url": "https://aws.amazon.com/cn/blogs/china/feed/", "label": "AWS 中国博客"},
        ],
        description="独立博客 RSS 源列表"
    )
    blog_max_per_source: int = Field(
        default=2,
        description="每个独立博客源最多取几篇最新文章"
    )

    # ==================== 会议论文追踪配置 ====================
    semantic_scholar_api_key: Optional[str] = Field(
        default=None,
        description="Semantic Scholar API Key（免费申请，提高限流到 1 req/sec）"
    )
    conference_lookback_days: int = Field(
        default=30,
        description="会议论文回溯天数（滑动窗口）"
    )
    conference_max_papers_per_venue: int = Field(
        default=50,
        description="每个会议最多抓取论文数"
    )
    conference_max_total: int = Field(
        default=20,
        description="送入 LLM 分析的最大论文总数"
    )
    conference_rank_filter: List[str] = Field(
        default=["A", "B"],
        description="追踪的会议等级（A/B）"
    )
    conference_categories: List[str] = Field(
        default=["ai", "nlp", "cv", "dm", "ir"],
        description="追踪的会议方向分类"
    )
    conference_topics: List[str] = Field(
        default=[
            "large language model", "LLM", "transformer",
            "agent", "multi-agent", "agentic",
            "reasoning", "planning", "chain of thought",
            "retrieval augmented", "RAG", "memory",
            "tool calling", "function calling", "MCP",
            "alignment", "safety", "multimodal",
            "scaling", "fine-tuning", "reinforcement learning",
        ],
        description="会议论文主题过滤关键词"
    )
    conference_ccf_yaml_path: str = Field(
        default="data/ccf_conferences.yaml",
        description="CCF 会议分级映射表路径"
    )

    # ==================== 微信公众号追踪配置 ====================
    wechat_rss_base_url: str = Field(
        default="http://localhost:8001",
        description="we-mp-rss 服务地址"
    )
    wechat_mp_ids: List[dict] = Field(
        default=[],
        description="订阅的公众号列表 [{\"id\": \"MP_WXS_xxx\", \"name\": \"xxx\"}]"
    )
    wechat_limit_per_mp: int = Field(
        default=20,
        description="每个公众号最多抓取文章数"
    )

    @field_validator('github_topics', mode='before')
    @classmethod
    def parse_github_topics(cls, v):
        if isinstance(v, str):
            return [t.strip() for t in v.split(',') if t.strip()]
        return v

    @field_validator('arxiv_subjects', mode='before')
    @classmethod
    def parse_subjects(cls, v):
        """解析主题配置（支持逗号分隔字符串或列表）"""
        if isinstance(v, str):
            return [s.strip() for s in v.split(',') if s.strip()]
        return v
    
    @field_validator('high_priority_keywords', 'top_institutions', mode='before')
    @classmethod
    def parse_list(cls, v):
        """解析列表配置"""
        if isinstance(v, str):
            return [s.strip().lower() for s in v.split(',') if s.strip()]
        if isinstance(v, list):
            return [s.lower() for s in v]
        return v
    
    @field_validator('conference_rank_filter', 'conference_categories', 'conference_topics', mode='before')
    @classmethod
    def parse_conference_list(cls, v):
        """解析会议追踪列表配置"""
        if isinstance(v, str):
            return [s.strip() for s in v.split(',') if s.strip()]
        if isinstance(v, list):
            return [s.strip() if isinstance(s, str) else s for s in v]
        return v

    @field_validator('log_level')
    @classmethod
    def validate_log_level(cls, v):
        """验证日志级别"""
        valid_levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']
        v = v.upper()
        if v not in valid_levels:
            raise ValueError(f"无效的日志级别: {v}，可选: {valid_levels}")
        return v


# 全局配置实例
_settings: Optional[Settings] = None


def get_settings() -> Settings:
    """获取配置实例（单例模式）"""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def reload_settings() -> Settings:
    """重新加载配置"""
    global _settings
    _settings = Settings()
    return _settings
