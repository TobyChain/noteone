"""
多维度相关性评分系统
聚焦于大模型与智能体的五个核心方向：
  1. LLM_ALGORITHM       — 大模型算法
  2. AGENT_ALGORITHM     — Agent 算法
  3. AGENT_ARCHITECTURE  — 智能体架构
  4. AGENT_MEMORY        — 智能体记忆
  5. LLM_FRONTIER        — 大模型前沿进展
"""

RECOMMENDATION_ORDER = {
    "极度推荐": 5, "很推荐": 4, "推荐": 3, "一般推荐": 2, "不推荐": 1,
}

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from enum import Enum
import re
from loguru import logger


class ResearchDirection(str, Enum):
    """研究方向枚举（聚焦大模型与智能体）"""
    LLM_ALGORITHM      = "llm_algorithm"       # 大模型算法
    AGENT_ALGORITHM    = "agent_algorithm"      # Agent 算法
    AGENT_ARCHITECTURE = "agent_architecture"   # 智能体架构
    AGENT_MEMORY       = "agent_memory"         # 智能体记忆
    LLM_FRONTIER       = "llm_frontier"         # 大模型前沿进展


@dataclass
class DirectionConfig:
    """研究方向配置"""
    name: str
    keywords: List[str]
    secondary_keywords: List[str]
    top_authors: List[str]
    weight: float = 1.0
    description: str = ""


DEFAULT_DIRECTIONS: Dict[ResearchDirection, DirectionConfig] = {

    # ── 1. 大模型算法 ────────────────────────────────────────────────────────
    ResearchDirection.LLM_ALGORITHM: DirectionConfig(
        name="大模型算法",
        keywords=[
            "large language model", "llm training", "llm inference",
            "transformer architecture", "attention mechanism",
            "mixture of experts", "moe", "sparse mixture",
            "efficient training", "distributed training", "parallel training",
            "model compression", "quantization", "pruning",
            "knowledge distillation", "model distillation",
            "fine-tuning", "parameter-efficient", "lora", "qlora", "adapter",
            "long context", "long sequence", "context window extension",
            "tokenization", "tokenizer",
            "speculative decoding", "flash attention",
            "mamba", "state space model", "ssm",
        ],
        secondary_keywords=[
            "pre-training", "pretraining", "continual pretraining",
            "instruction tuning", "sft", "supervised fine-tuning",
            "rlhf", "dpo", "direct preference optimization",
            "mixture of experts", "routing", "expert selection",
            "batch size", "learning rate", "optimizer",
            "gradient checkpointing", "memory optimization",
            "inference optimization", "kv cache", "pagedattention",
            "model parallelism", "tensor parallel", "pipeline parallel",
            "activation function", "positional encoding", "rope",
            "architectural innovation", "model scaling",
        ],
        top_authors=[
            "openai", "google", "deepmind", "anthropic", "meta",
            "microsoft", "nvidia", "alibaba", "bytedance", "tencent",
            "stanford", "berkeley", "tsinghua", "cmu",
        ],
        weight=1.6,
        description="大模型训练、推理优化、架构创新、参数高效微调"
    ),

    # ── 2. Agent 算法 ───────────────────────────────────────────────────────
    ResearchDirection.AGENT_ALGORITHM: DirectionConfig(
        name="Agent算法",
        keywords=[
            "agent planning", "agent reasoning", "agent algorithm",
            "chain of thought", "cot", "tree of thought", "tot",
            "self-reflection", "self-refine", "self-critique",
            "reinforcement learning agent", "rl agent", "rl for llm",
            "reward model", "reward shaping", "process reward",
            "search algorithm", "monte carlo tree search", "mcts",
            "task decomposition", "hierarchical planning",
            "code generation", "code agent", "programming agent",
            "mathematical reasoning", "math reasoning", "theorem proving",
            "multi-step reasoning", "step-by-step reasoning",
            "exploration", "trial and error", "backtracking",
        ],
        secondary_keywords=[
            "reasoning capability", "reasoning benchmark",
            "world model", "mental model", "simulation",
            "curriculum learning", "self-play",
            "agent evaluation", "agent benchmark",
            "instruction following", "complex instruction",
            "tool learning", "tool selection", "tool routing",
            "error recovery", "graceful degradation",
            "planning horizon", "look-ahead", "beam search",
            "verifier", "judge model", "self-evaluation",
        ],
        top_authors=[
            "openai", "anthropic", "google", "deepmind",
            "microsoft", "meta", "stanford", "berkeley",
            "tsinghua", "princeton", "cmu",
        ],
        weight=1.5,
        description="Agent 推理、规划、搜索算法、强化学习、代码/数学推理"
    ),

    # ── 3. 智能体架构 ────────────────────────────────────────────────────────
    ResearchDirection.AGENT_ARCHITECTURE: DirectionConfig(
        name="智能体架构",
        keywords=[
            "multi-agent system", "multi-agent framework",
            "agent architecture", "agent framework",
            "autonomous agent", "llm agent", "ai agent",
            "agentic workflow", "agentic ai",
            "tool use", "tool calling", "function calling",
            "mcp", "model context protocol",
            "agent orchestration", "multi-agent orchestration",
            "agent collaboration", "agent communication",
            "agent protocol", "agent interoperability",
            "orchestration framework", "workflow automation",
            "agent-based simulation", "agent-based model",
            "browser use", "web agent", "gui agent", "computer use",
            "coding agent", "software engineering agent",
        ],
        secondary_keywords=[
            "sub-agent", "hierarchical agent", "agent hierarchy",
            "agent role", "role assignment", "role playing",
            "agent debate", "agent discussion", "consensus",
            "skills library", "tool library", "skill composition",
            "api calling", "tool integration", "plugin system",
            "sandbox", "execution environment", "code execution",
            "task routing", "agent routing", "agent dispatch",
            "multi-agent coordination", "agent scheduling",
            "agent safety", "agent guardrail",
        ],
        top_authors=[
            "openai", "anthropic", "google", "deepmind",
            "microsoft", "meta", "langchain", "stanford",
            "alibaba", "bytedance", "tsinghua",
        ],
        weight=1.4,
        description="智能体系统架构、工具调用、MCP 协议、多智能体编排与协作"
    ),

    # ── 4. 智能体记忆 ────────────────────────────────────────────────────────
    ResearchDirection.AGENT_MEMORY: DirectionConfig(
        name="智能体记忆",
        keywords=[
            "retrieval augmented generation", "rag",
            "memory system", "agent memory", "long-term memory",
            "short-term memory", "working memory", "episodic memory",
            "knowledge retrieval", "knowledge grounding",
            "vector database", "embedding", "dense retrieval",
            "memory management", "context management",
            "knowledge graph", "graph-based retrieval",
            "document retrieval", "passage retrieval",
            "semantic search", "hybrid search",
            "chunking", "chunking strategy", "text splitting",
            "memory compression", "memory summarization",
            "experience replay", "experience memory",
        ],
        secondary_keywords=[
            "reranking", "re-ranker", "cross-encoder",
            "sparse retrieval", "bm25", "lexical retrieval",
            "knowledge base", "knowledge store",
            "external knowledge", "external memory",
            "context window", "context utilization",
            "information extraction", "entity extraction",
            "relation extraction", "knowledge construction",
            "memory-augmented", "memory-augmented neural network",
            "persistent memory", "memory persistence",
            "memory consolidation", "forgetting",
        ],
        top_authors=[
            "openai", "google", "meta", "microsoft",
            "anthropic", "stanford", "berkeley", "cmu",
            "alibaba", "tencent", "bytedance",
        ],
        weight=1.3,
        description="RAG、记忆系统、知识检索、向量数据库、上下文管理"
    ),

    # ── 5. 大模型前沿进展 ────────────────────────────────────────────────────
    ResearchDirection.LLM_FRONTIER: DirectionConfig(
        name="大模型前沿",
        keywords=[
            "scaling law", "emergent ability", "emergent behavior",
            "alignment", "rlhf", "constitutional ai",
            "safety", "red teaming", "jailbreak",
            "multimodal", "vision language model", "vlm",
            "image generation", "text-to-image", "text-to-video",
            "world model", "video understanding", "video generation",
            "omni model", "any-to-any model",
            "reasoning model", "thinking model", "chain of thought",
            "benchmark", "evaluation", "human evaluation",
            "hallucination", "factuality", "grounding",
            "interpretability", "mechanistic interpretability",
            "mechanistic interpretability", "circuit discovery",
            "in-context learning", "few-shot learning",
        ],
        secondary_keywords=[
            "agi", "artificial general intelligence",
            "superintelligence", "ai safety",
            "value alignment", "reward hacking",
            "multimodal reasoning", "visual reasoning",
            "audio understanding", "speech language model",
            "embodied ai", "robotics", "robot learning",
            "scientific discovery", "drug discovery", "protein",
            "data synthesis", "synthetic data", "data quality",
            "model merging", "model ensemble",
            "open source model", "open weight",
            "frontier model", "foundation model",
            "capability evaluation", "capability benchmark",
        ],
        top_authors=[
            "openai", "anthropic", "google", "deepmind",
            "meta", "microsoft", "xai", "mistral",
            "stanford", "berkeley", "mit", "tsinghua",
        ],
        weight=1.5,
        description="scaling laws、对齐安全、多模态、前沿评估、可解释性"
    ),
}


# ──────────────────────────────────────────────────────────────────────────────
# 数据类
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class DimensionScore:
    direction: ResearchDirection
    score: float
    matched_keywords: List[str]
    confidence: float
    reason: str


@dataclass
class MultiDimensionScore:
    arxiv_id: str
    title: str
    dimension_scores: List[DimensionScore] = field(default_factory=list)
    overall_score: float = 0.0
    relevance_score: float = 0.0
    novelty_score: float = 0.0
    quality_score: float = 0.0
    recommendation_level: str = "不推荐"
    primary_directions: List[ResearchDirection] = field(default_factory=list)
    timestamp: str = ""
    version: str = "2.0"

    def get_top_directions(self, n: int = 3) -> List[Tuple[ResearchDirection, float]]:
        sorted_scores = sorted(self.dimension_scores, key=lambda x: x.score, reverse=True)
        return [(s.direction, s.score) for s in sorted_scores[:n] if s.score > 0]

    def to_dict(self) -> dict:
        return {
            "arxiv_id": self.arxiv_id,
            "title": self.title,
            "overall_score": self.overall_score,
            "relevance_score": self.relevance_score,
            "novelty_score": self.novelty_score,
            "quality_score": self.quality_score,
            "recommendation_level": self.recommendation_level,
            "primary_directions": [d.value for d in self.primary_directions],
            "dimension_scores": [
                {
                    "direction": s.direction.value,
                    "score": s.score,
                    "matched_keywords": s.matched_keywords,
                    "confidence": s.confidence,
                    "reason": s.reason,
                }
                for s in self.dimension_scores
            ],
            "timestamp": self.timestamp,
        }


# ──────────────────────────────────────────────────────────────────────────────
# 评分器
# ──────────────────────────────────────────────────────────────────────────────

class MultiDimensionScorer:
    """
    多维度评分器
    评分逻辑：
      - 每个方向独立打分（0-100）
      - overall_score = 各方向加权均值（高分方向额外加权）
      - 推荐门槛提高：overall_score >= 45 才会进入"推荐"及以上
      - 严格过滤：overall_score < 30 标记为"不推荐"，由 main.py 直接丢弃
    """

    # 最低入选分数线（低于此分不写入报告）
    MIN_REPORT_SCORE = 30.0
    # 每日报告最多保留篇数
    MAX_REPORT_PAPERS = 15

    def __init__(self, directions: Optional[Dict[ResearchDirection, DirectionConfig]] = None):
        self.directions = directions or DEFAULT_DIRECTIONS
        self._compile_patterns()

    def _compile_patterns(self):
        self.patterns: Dict[ResearchDirection, List[Tuple[str, re.Pattern]]] = {}
        for direction, config in self.directions.items():
            patterns = []
            for kw in config.keywords:
                if ' ' in kw:
                    pat = re.compile(re.escape(kw), re.IGNORECASE)
                else:
                    pat = re.compile(r'\b' + re.escape(kw) + r'\b', re.IGNORECASE)
                patterns.append((kw, pat))
            self.patterns[direction] = patterns

    def score_paper(
        self,
        arxiv_id: str,
        title: str,
        abstract: str,
        authors: Optional[List[str]] = None,
    ) -> MultiDimensionScore:
        from datetime import datetime

        text = f"{title} {abstract}".lower()
        dimension_scores = []

        for direction, config in self.directions.items():
            score, matched, confidence, reason = self._score_direction(
                text, direction, config, authors or []
            )
            dimension_scores.append(DimensionScore(
                direction=direction,
                score=score,
                matched_keywords=matched,
                confidence=confidence,
                reason=reason,
            ))

        overall = self._overall(dimension_scores)

        primary = [
            s.direction for s in dimension_scores if s.score >= 35
        ]
        primary.sort(
            key=lambda d: next(s.score for s in dimension_scores if s.direction == d),
            reverse=True,
        )

        recommendation = self._recommend(overall, primary)

        return MultiDimensionScore(
            arxiv_id=arxiv_id,
            title=title,
            dimension_scores=dimension_scores,
            overall_score=overall,
            relevance_score=overall,
            novelty_score=self._novelty(text, primary),
            quality_score=self._quality(authors or [], primary),
            recommendation_level=recommendation,
            primary_directions=primary[:3],
            timestamp=datetime.now().isoformat(),
        )

    def _score_direction(
        self,
        text: str,
        direction: ResearchDirection,
        config: DirectionConfig,
        authors: List[str],
    ) -> Tuple[float, List[str], float, str]:
        score = 0.0
        matched = []

        # 核心关键词：每次命中 +30，同一词多次出现不额外加分
        for kw, pat in self.patterns[direction]:
            if pat.search(text):
                matched.append(kw)
                score += 30

        # 次要关键词：每个 +8
        for kw in config.secondary_keywords:
            if kw.lower() in text:
                score += 8
                if kw not in matched:
                    matched.append(kw)

        # 机构匹配：+15
        for author in authors:
            al = author.lower()
            for inst in config.top_authors:
                if inst.lower() in al:
                    score += 15
                    break

        # 乘以方向权重
        score *= config.weight

        # 归一化
        score = min(score, 100.0)

        confidence = min(len(matched) / 3.0, 1.0)
        if matched:
            reason = f"匹配关键词: {', '.join(matched[:5])}"
        else:
            reason = "未匹配到相关关键词"

        return score, matched, confidence, reason

    def _overall(self, dim_scores: List[DimensionScore]) -> float:
        """加权均值，高分维度额外加权"""
        if not dim_scores:
            return 0.0
        scores = [s.score for s in dim_scores]
        weights = [1 + s.score / 100 for s in dim_scores]
        return round(sum(s * w for s, w in zip(scores, weights)) / sum(weights), 2)

    def _novelty(self, text: str, primary: List[ResearchDirection]) -> float:
        base = 50.0
        if len(primary) >= 2:
            base += 20
        novel_kws = ['novel', 'new', 'first', 'propose', 'introduce']
        for kw in novel_kws:
            if kw in text:
                base += 5
        return min(base, 100.0)

    def _quality(self, authors: List[str], primary: List[ResearchDirection]) -> float:
        base = 55.0
        top = ['openai', 'google', 'deepmind', 'anthropic', 'meta',
               'microsoft', 'stanford', 'mit', 'berkeley', 'tsinghua',
               'xiaomi', 'huawei', 'apple', 'samsung']
        for author in authors:
            al = author.lower()
            for inst in top:
                if inst in al:
                    base += 10
                    break
        return min(base, 100.0)

    def _recommend(self, score: float, primary: List[ResearchDirection]) -> str:
        """
        推荐门槛：
          极度推荐 >= 65  且命中核心方向
          很推荐   >= 50  或命中核心方向 >= 45
          推荐     >= 38
          一般推荐 >= 30
          不推荐   <  30
        """
        core = {
            ResearchDirection.LLM_ALGORITHM,
            ResearchDirection.AGENT_ALGORITHM,
            ResearchDirection.AGENT_ARCHITECTURE,
            ResearchDirection.LLM_FRONTIER,
        }
        has_core = any(d in core for d in primary)

        if score >= 65 and has_core:
            return "极度推荐"
        elif score >= 50 or (score >= 45 and has_core):
            return "很推荐"
        elif score >= 38:
            return "推荐"
        elif score >= 30:
            return "一般推荐"
        else:
            return "不推荐"

    def batch_score(
        self,
        papers: List[Dict],
        progress_callback=None,
    ) -> List[MultiDimensionScore]:
        results = []
        total = len(papers)
        for i, paper in enumerate(papers):
            try:
                s = self.score_paper(
                    arxiv_id=paper.get("arxiv_id", ""),
                    title=paper.get("title", ""),
                    abstract=paper.get("abstract", ""),
                    authors=paper.get("authors", []),
                )
                results.append(s)
                if progress_callback:
                    progress_callback(i + 1, total)
            except Exception as e:
                logger.error(f"评分失败 {paper.get('arxiv_id')}: {e}")
                results.append(MultiDimensionScore(
                    arxiv_id=paper.get("arxiv_id", ""),
                    title=paper.get("title", ""),
                    overall_score=0,
                    recommendation_level="不推荐",
                ))
        return results
