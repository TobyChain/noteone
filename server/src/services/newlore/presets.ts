import type { NewLoreConfig } from "./config.js";

export interface NewLorePreset {
  id: string;
  name: string;
  description: string;
  config: Partial<NewLoreConfig>;
}

export const PRESETS: NewLorePreset[] = [
  {
    id: "default",
    name: "默认推荐",
    description: "覆盖 AI + 全栈 + 电商方向，适合大多数用户",
    config: {
      enabled_modules: ["official", "blog", "github", "arxiv", "conference", "wechat"],
      github_topics: [
        "ai-agent", "llm-agent", "rag", "multi-agent", "chatbot",
        "recommendation-system", "e-commerce", "web-framework",
        "react", "typescript", "rust", "go",
      ],
      github_min_stars: 500,
      github_top_analyze: 20,
      arxiv_subjects: ["cs.AI", "cs.CL", "cs.SE"],
      conference_categories: ["ai", "nlp", "cv", "dm", "ir", "se"],
      blog_sources: [
        "阮一峰周刊|https://www.ruanyifeng.com/blog/atom.xml",
        "Sebastian Raschka|https://magazine.sebastianraschka.com/feed",
        "Lilian Weng|https://lilianweng.github.io/index.xml",
        "Simon Willison|https://simonwillison.net/atom/everything/",
        "GitHub Engineering|https://github.blog/engineering/feed/",
        "TLDR AI|https://tldr.tech/api/rss/ai",
      ],
      max_total_papers: 300,
    },
  },
  {
    id: "ai-researcher",
    name: "AI 研究者",
    description: "聚焦大模型、Agent、多模态前沿研究",
    config: {
      enabled_modules: ["arxiv", "conference", "github", "blog", "official"],
      github_topics: [
        "llm-agent", "ai-agent", "multi-agent", "rag",
        "transformer", "fine-tuning", "alignment", "multimodal",
        "reinforcement-learning", "world-model",
      ],
      github_min_stars: 1000,
      github_top_analyze: 30,
      arxiv_subjects: ["cs.AI", "cs.CL", "cs.LG", "cs.CV"],
      conference_categories: ["ai", "nlp", "cv"],
      conference_rank_filter: ["A", "B"],
      blog_sources: [
        "Sebastian Raschka|https://magazine.sebastianraschka.com/feed",
        "Lilian Weng|https://lilianweng.github.io/index.xml",
        "Chip Huyen|https://huyenchip.com/feed.xml",
        "Andrej Karpathy|https://karpathy.github.io/feed.xml",
        "BAIR (Berkeley AI)|https://bair.berkeley.edu/blog/feed.xml",
        "OpenAI Blog|https://openai.com/news/rss.xml",
        "Apple ML Research|https://machinelearning.apple.com/rss.xml",
        "HuggingFace Blog|https://huggingface.co/blog/feed.xml",
        "Import AI|https://importai.substack.com/feed",
        "TLDR AI|https://tldr.tech/api/rss/ai",
      ],
      max_papers_per_subject: 300,
      max_total_papers: 500,
    },
  },
  {
    id: "fullstack-dev",
    name: "全栈开发者",
    description: "关注工程实践、开源项目、Web 开发趋势",
    config: {
      enabled_modules: ["github", "blog", "official"],
      github_topics: [
        "react", "vue", "nextjs", "typescript", "rust", "go",
        "nodejs", "tailwind", "postgres", "docker", "kubernetes",
        "web-framework", "graphql", "vite",
      ],
      github_min_stars: 300,
      github_top_analyze: 15,
      arxiv_subjects: ["cs.SE"],
      conference_categories: ["se"],
      blog_sources: [
        "阮一峰周刊|https://www.ruanyifeng.com/blog/atom.xml",
        "Simon Willison|https://simonwillison.net/atom/everything/",
        "Eugene Yan|https://eugeneyan.com/rss/",
        "GitHub Engineering|https://github.blog/engineering/feed/",
        "AWS ML Blog|https://aws.amazon.com/blogs/machine-learning/feed/",
      ],
      max_total_papers: 100,
    },
  },
  {
    id: "minimal",
    name: "极简模式",
    description: "只跟踪官方动态和精选博客，低信息量",
    config: {
      enabled_modules: ["official", "blog"],
      github_topics: ["ai-agent", "llm-agent"],
      arxiv_subjects: ["cs.AI"],
      blog_sources: [
        "TLDR AI|https://tldr.tech/api/rss/ai",
        "Simon Willison|https://simonwillison.net/atom/everything/",
      ],
      github_min_stars: 2000,
      github_top_analyze: 10,
      max_total_papers: 100,
      blog_max_per_source: 1,
    },
  },
];

export function applyPreset(preset: NewLorePreset): Partial<NewLoreConfig> {
  return structuredClone(preset.config);
}
