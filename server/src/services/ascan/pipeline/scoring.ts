/**
 * Multi-dimension relevance scoring engine (TS port of ascan/src/core/scoring.py).
 * Focused on five core directions of LLM & agent research:
 *   1. llm_algorithm      — 大模型算法
 *   2. agent_algorithm    — Agent 算法
 *   3. agent_architecture — 智能体架构
 *   4. agent_memory       — 智能体记忆
 *   5. llm_frontier       — 大模型前沿进展
 */

export const RECOMMENDATION_ORDER: Record<string, number> = {
  极度推荐: 5,
  很推荐: 4,
  推荐: 3,
  一般推荐: 2,
  不推荐: 1,
};

export type ResearchDirection =
  | "llm_algorithm"
  | "agent_algorithm"
  | "agent_architecture"
  | "agent_memory"
  | "llm_frontier";

export interface DirectionConfig {
  name: string;
  keywords: string[];
  secondaryKeywords: string[];
  topAuthors: string[];
  weight: number;
  description: string;
}

export const DEFAULT_DIRECTIONS: Record<ResearchDirection, DirectionConfig> = {
  // ── 1. 大模型算法 ────────────────────────────────────────────────────────
  llm_algorithm: {
    name: "大模型算法",
    keywords: [
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
    secondaryKeywords: [
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
    topAuthors: [
      "openai", "google", "deepmind", "anthropic", "meta",
      "microsoft", "nvidia", "alibaba", "bytedance", "tencent",
      "stanford", "berkeley", "tsinghua", "cmu",
    ],
    weight: 1.6,
    description: "大模型训练、推理优化、架构创新、参数高效微调",
  },

  // ── 2. Agent 算法 ───────────────────────────────────────────────────────
  agent_algorithm: {
    name: "Agent算法",
    keywords: [
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
    secondaryKeywords: [
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
    topAuthors: [
      "openai", "anthropic", "google", "deepmind",
      "microsoft", "meta", "stanford", "berkeley",
      "tsinghua", "princeton", "cmu",
    ],
    weight: 1.5,
    description: "Agent 推理、规划、搜索算法、强化学习、代码/数学推理",
  },

  // ── 3. 智能体架构 ────────────────────────────────────────────────────────
  agent_architecture: {
    name: "智能体架构",
    keywords: [
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
    secondaryKeywords: [
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
    topAuthors: [
      "openai", "anthropic", "google", "deepmind",
      "microsoft", "meta", "langchain", "stanford",
      "alibaba", "bytedance", "tsinghua",
    ],
    weight: 1.4,
    description: "智能体系统架构、工具调用、MCP 协议、多智能体编排与协作",
  },

  // ── 4. 智能体记忆 ────────────────────────────────────────────────────────
  agent_memory: {
    name: "智能体记忆",
    keywords: [
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
    secondaryKeywords: [
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
    topAuthors: [
      "openai", "google", "meta", "microsoft",
      "anthropic", "stanford", "berkeley", "cmu",
      "alibaba", "tencent", "bytedance",
    ],
    weight: 1.3,
    description: "RAG、记忆系统、知识检索、向量数据库、上下文管理",
  },

  // ── 5. 大模型前沿进展 ────────────────────────────────────────────────────
  llm_frontier: {
    name: "大模型前沿",
    keywords: [
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
    secondaryKeywords: [
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
    topAuthors: [
      "openai", "anthropic", "google", "deepmind",
      "meta", "microsoft", "xai", "mistral",
      "stanford", "berkeley", "mit", "tsinghua",
    ],
    weight: 1.5,
    description: "scaling laws、对齐安全、多模态、前沿评估、可解释性",
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Data classes
// ──────────────────────────────────────────────────────────────────────────

export interface DimensionScore {
  direction: ResearchDirection;
  score: number;
  matchedKeywords: string[];
  confidence: number;
  reason: string;
}

export interface MultiDimensionScore {
  arxivId: string;
  title: string;
  dimensionScores: DimensionScore[];
  overallScore: number;
  relevanceScore: number;
  noveltyScore: number;
  qualityScore: number;
  recommendationLevel: string;
  primaryDirections: ResearchDirection[];
  timestamp: string;
  version: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ──────────────────────────────────────────────────────────────────────────
// Scorer
// ──────────────────────────────────────────────────────────────────────────

/**
 * 多维度评分器（直译自 Python MultiDimensionScorer）
 *  - 每个方向独立打分（0-100）
 *  - overall_score = 各方向加权均值（高分方向额外加权）
 *  - 推荐门槛：overall_score >= 45 才会进入"推荐"及以上
 *  - 严格过滤：overall_score < 30 标记为"不推荐"，由调用方直接丢弃
 */
export class MultiDimensionScorer {
  private directions: Record<ResearchDirection, DirectionConfig>;
  private patterns: Record<ResearchDirection, Array<[string, RegExp]>>;

  constructor(directions?: Record<ResearchDirection, DirectionConfig>) {
    this.directions = directions || DEFAULT_DIRECTIONS;
    this.patterns = {} as Record<ResearchDirection, Array<[string, RegExp]>>;
    this.compilePatterns();
  }

  private compilePatterns(): void {
    for (const direction of Object.keys(this.directions) as ResearchDirection[]) {
      const config = this.directions[direction];
      const patterns: Array<[string, RegExp]> = [];
      for (const kw of config.keywords) {
        const pat = kw.includes(" ")
          ? new RegExp(escapeRegExp(kw), "i")
          : new RegExp(`\\b${escapeRegExp(kw)}\\b`, "i");
        patterns.push([kw, pat]);
      }
      this.patterns[direction] = patterns;
    }
  }

  scorePaper(
    arxivId: string,
    title: string,
    abstract: string,
    authors?: string[],
  ): MultiDimensionScore {
    const text = `${title} ${abstract}`.toLowerCase();
    const dimensionScores: DimensionScore[] = [];

    for (const direction of Object.keys(this.directions) as ResearchDirection[]) {
      const config = this.directions[direction];
      const { score, matched, confidence, reason } = this.scoreDirection(
        text, direction, config, authors || [],
      );
      dimensionScores.push({
        direction,
        score,
        matchedKeywords: matched,
        confidence,
        reason,
      });
    }

    const overall = this.overall(dimensionScores);

    const primary = dimensionScores
      .filter((s) => s.score >= 35)
      .map((s) => s.direction);
    const scoreOf = (d: ResearchDirection) =>
      dimensionScores.find((s) => s.direction === d)!.score;
    primary.sort((a, b) => scoreOf(b) - scoreOf(a));

    const recommendation = this.recommend(overall, primary);

    return {
      arxivId,
      title,
      dimensionScores,
      overallScore: overall,
      relevanceScore: overall,
      noveltyScore: this.novelty(text, primary),
      qualityScore: this.quality(authors || [], primary),
      recommendationLevel: recommendation,
      primaryDirections: primary.slice(0, 3),
      timestamp: new Date().toISOString(),
      version: "2.0",
    };
  }

  private scoreDirection(
    text: string,
    direction: ResearchDirection,
    config: DirectionConfig,
    authors: string[],
  ): { score: number; matched: string[]; confidence: number; reason: string } {
    let score = 0.0;
    const matched: string[] = [];

    // 核心关键词：每次命中 +30，同一词多次出现不额外加分
    for (const [kw, pat] of this.patterns[direction]) {
      if (pat.test(text)) {
        matched.push(kw);
        score += 30;
      }
    }

    // 次要关键词：每个 +8
    for (const kw of config.secondaryKeywords) {
      if (text.includes(kw.toLowerCase())) {
        score += 8;
        if (!matched.includes(kw)) matched.push(kw);
      }
    }

    // 机构匹配：+15
    for (const author of authors) {
      const al = author.toLowerCase();
      for (const inst of config.topAuthors) {
        if (al.includes(inst.toLowerCase())) {
          score += 15;
          break;
        }
      }
    }

    // 乘以方向权重
    score *= config.weight;

    // 归一化
    score = Math.min(score, 100.0);

    const confidence = Math.min(matched.length / 3.0, 1.0);
    const reason = matched.length
      ? `匹配关键词: ${matched.slice(0, 5).join(", ")}`
      : "未匹配到相关关键词";

    return { score, matched, confidence, reason };
  }

  /** 加权均值，高分维度额外加权 */
  private overall(dimScores: DimensionScore[]): number {
    if (!dimScores.length) return 0.0;
    const scores = dimScores.map((s) => s.score);
    const weights = dimScores.map((s) => 1 + s.score / 100);
    const weightedSum = scores.reduce((acc, s, i) => acc + s * weights[i], 0);
    const weightSum = weights.reduce((acc, w) => acc + w, 0);
    return Math.round((weightedSum / weightSum) * 100) / 100;
  }

  private novelty(text: string, primary: ResearchDirection[]): number {
    let base = 50.0;
    if (primary.length >= 2) base += 20;
    const novelKws = ["novel", "new", "first", "propose", "introduce"];
    for (const kw of novelKws) {
      if (text.includes(kw)) base += 5;
    }
    return Math.min(base, 100.0);
  }

  private quality(authors: string[], _primary: ResearchDirection[]): number {
    let base = 55.0;
    const top = [
      "openai", "google", "deepmind", "anthropic", "meta",
      "microsoft", "stanford", "mit", "berkeley", "tsinghua",
      "xiaomi", "huawei", "apple", "samsung",
    ];
    for (const author of authors) {
      const al = author.toLowerCase();
      for (const inst of top) {
        if (al.includes(inst)) {
          base += 10;
          break;
        }
      }
    }
    return Math.min(base, 100.0);
  }

  /**
   * 推荐门槛：
   *   极度推荐 >= 65  且命中核心方向
   *   很推荐   >= 50  或命中核心方向 >= 45
   *   推荐     >= 38
   *   一般推荐 >= 30
   *   不推荐   <  30
   */
  private recommend(score: number, primary: ResearchDirection[]): string {
    const core = new Set<ResearchDirection>([
      "llm_algorithm",
      "agent_algorithm",
      "agent_architecture",
      "llm_frontier",
    ]);
    const hasCore = primary.some((d) => core.has(d));

    if (score >= 65 && hasCore) return "极度推荐";
    if (score >= 50 || (score >= 45 && hasCore)) return "很推荐";
    if (score >= 38) return "推荐";
    if (score >= 30) return "一般推荐";
    return "不推荐";
  }

}
