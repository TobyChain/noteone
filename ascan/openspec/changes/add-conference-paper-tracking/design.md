# Design: Add Conference Paper Tracking

## Context

ascan 日报已有 4 条 pipeline（arXiv / GitHub / 官方动态 / 独立博客），每条遵循 `Fetch → (Enrich →) Analyze → BuildFragment` 模式，输出 HTML+MD 片段后由 `main_daily.py` 合并为统一日报。新增会议论文追踪需要遵循同样的模式，最小化对现有代码的侵入。

核心挑战：
1. **会议论文不是每日发布**——与 arXiv 每天出新不同，会议按年度周期录用论文，大多数日子无新数据。
2. **数据源碎片化**——没有一个统一的 API 能覆盖所有顶会，需要多源融合。
3. **venue 名称归一化**——同一会议在不同数据源中名称不同（NeurIPS / NIPS / Advances in Neural Information Processing Systems）。

## Decision 1: 数据源选择 — Semantic Scholar 主 + DBLP 补

**选择**：

```
Semantic Scholar Graph API (主)
  → venue 过滤 + 摘要 + 引用数 + TLDR + 作者机构
  → https://api.semanticscholar.org/graph/v1/paper/search/bulk
      ?query={keywords}&venue={venue_name}&year={year}&fields=...

DBLP API (补)
  → 权威 TOC 列表，确认论文是否属于目标会议
  → https://dblp.org/search/publ/api?q=toc:db/conf/{key}/{conf}{year}.bht:&format=json
```

**为什么**：
- Semantic Scholar 是唯一同时提供 venue 过滤 + 摘要 + 引用数 + 开放获取 PDF 的免费 API，字段丰富度远超 DBLP（无摘要）和 OpenAlex（2025 年起收费）。
- DBLP 作为补充源解决 Semantic Scholar 的 venue 匹配遗漏问题：DBLP 使用规范化的 venue key（如 `nips`, `icml`），TOC 查询精确到每一届会议。
- 不选 OpenAlex：2025 年 2 月起需要 API key + 付费，对本项目性价比不高。
- 不选 arXiv comment 字段解析（如 "Accepted at NeurIPS 2024"）：非结构化文本，解析不可靠，且大量会议论文不标注录用信息。

**为什么不只用 Semantic Scholar**：
- Semantic Scholar 的 venue 字段是 canonical name，但覆盖不完整——部分论文缺少 venue 标注。
- DBLP 的 TOC 查询是最权威的会议论文列表来源，能补充 Semantic Scholar 遗漏的论文。
- 双源交叉验证提高覆盖率：Semantic Scholar 提供丰富元数据，DBLP 提供权威论文列表。

## Decision 2: CCF 会议分级 — 本地 YAML 映射表

**选择**：创建 `data/ccf_conferences.yaml`，手动维护 CCF A/B 类会议列表。

```yaml
# data/ccf_conferences.yaml
conferences:
  # ── CCF-A 类 ──
  - name: NeurIPS
    full_name: "Advances in Neural Information Processing Systems"
    rank: A
    category: ai
    dblp_key: nips
    s2_venue: NeurIPS
    aliases: ["NIPS", "NeurIPS"]

  - name: ICML
    full_name: "International Conference on Machine Learning"
    rank: A
    category: ai
    dblp_key: icml
    s2_venue: ICML
    aliases: ["ICML"]

  - name: ICLR
    full_name: "International Conference on Learning Representations"
    rank: A
    category: ai
    dblp_key: iclr
    s2_venue: ICLR
    aliases: ["ICLR"]

  - name: CVPR
    full_name: "IEEE/CVF Conference on Computer Vision and Pattern Recognition"
    rank: A
    category: cv
    dblp_key: cvpr
    s2_venue: CVPR
    aliases: ["CVPR"]

  - name: ICCV
    full_name: "IEEE International Conference on Computer Vision"
    rank: A
    category: cv
    dblp_key: iccv
    s2_venue: ICCV
    aliases: ["ICCV"]

  - name: ACL
    full_name: "Annual Meeting of the Association for Computational Linguistics"
    rank: A
    category: nlp
    dblp_key: acl
    s2_venue: ACL
    aliases: ["ACL"]

  - name: AAAI
    full_name: "AAAI Conference on Artificial Intelligence"
    rank: A
    category: ai
    dblp_key: aaai
    s2_venue: AAAI
    aliases: ["AAAI"]

  - name: KDD
    full_name: "ACM SIGKDD Conference on Knowledge Discovery and Data Mining"
    rank: A
    category: dm
    dblp_key: kdd
    s2_venue: KDD
    aliases: ["KDD", "SIGKDD"]

  - name: SIGIR
    full_name: "International ACM SIGIR Conference on Research and Development in Information Retrieval"
    rank: A
    category: ir
    dblp_key: sigir
    s2_venue: SIGIR
    aliases: ["SIGIR"]

  - name: WWW
    full_name: "The Web Conference"
    rank: A
    category: ir
    dblp_key: www
    s2_venue: WWW
    aliases: ["WWW", "TheWebConf"]

  - name: CHI
    full_name: "ACM Conference on Human Factors in Computing Systems"
    rank: A
    category: hci
    dblp_key: chi
    s2_venue: CHI
    aliases: ["CHI"]

  # ── CCF-B 类 ──
  - name: EMNLP
    full_name: "Conference on Empirical Methods in Natural Language Processing"
    rank: B
    category: nlp
    dblp_key: emnlp
    s2_venue: EMNLP
    aliases: ["EMNLP"]

  - name: NAACL
    full_name: "Conference of the North American Chapter of the Association for Computational Linguistics"
    rank: B
    category: nlp
    dblp_key: naacl
    s2_venue: NAACL
    aliases: ["NAACL", "HLT-NAACL"]

  - name: COLING
    full_name: "International Conference on Computational Linguistics"
    rank: B
    category: nlp
    dblp_key: coling
    s2_venue: COLING
    aliases: ["COLING"]

  - name: IJCAI
    full_name: "International Joint Conference on Artificial Intelligence"
    rank: B
    category: ai
    dblp_key: ijcai
    s2_venue: IJCAI
    aliases: ["IJCAI"]

  - name: ECAI
    full_name: "European Conference on Artificial Intelligence"
    rank: B
    category: ai
    dblp_key: ecai
    s2_venue: ECAI
    aliases: ["ECAI"]

  - name: ECCV
    full_name: "European Conference on Computer Vision"
    rank: B
    category: cv
    dblp_key: eccv
    s2_venue: ECCV
    aliases: ["ECCV"]

  - name: AISTATS
    full_name: "International Conference on Artificial Intelligence and Statistics"
    rank: B
    category: ai
    dblp_key: aistats
    s2_venue: AISTATS
    aliases: ["AISTATS"]

  - name: UAI
    full_name: "Conference on Uncertainty in Artificial Intelligence"
    rank: B
    category: ai
    dblp_key: uai
    s2_venue: UAI
    aliases: ["UAI"]
```

**为什么**：
- 各 API 都不内置 CCF 分级，必须本地维护。
- YAML 比 Python dict 更易读、更易手动编辑，且能被其他工具消费。
- 每个会议同时记录 `dblp_key`、`s2_venue`、`aliases`，解决跨源 venue 名称归一化问题。
- `category` 字段（ai/nlp/cv/dm/ir/hci）支持按方向过滤，与现有 `conference_topics` 配置联动。

**为什么不**：
- 不从 `ccfddl/ccf-deadlines` GitHub 仓库动态拉取：引入网络依赖 + 格式变更风险，不如本地 YAML 可控。
- 不用 Python dict 硬编码在 settings.py 中：YAML 更清晰，且不污染 settings 类。

## Decision 3: 模块结构 — 遵循 blog_subs 模式

**选择**：

```
src/conf_tracker/
├── __init__.py
├── models.py          # ConferencePaper 数据类（类似 BlogPost）
├── fetcher.py         # Semantic Scholar + DBLP 双源抓取
├── analyzer.py        # LLM 并发分析（复用 call_llm.py）
├── report.py          # HTML + MD 片段生成
└── stages.py          # FetchConfStage / AnalyzeConfStage / BuildConfFragmentStage

main_conf.py           # 入口脚本（类似 main_blog.py）
data/ccf_conferences.yaml  # CCF 分级映射
```

三阶段 pipeline：

| Stage | 输入 | 输出 | 关键逻辑 |
|-------|------|------|----------|
| `FetchConfStage` | `context.date`, settings | `context.conference_papers` | Semantic Scholar bulk search + DBLP TOC 查询，去重 against DB |
| `AnalyzeConfStage` | `context.conference_papers` | `context.conference_analyses` | LLM 并发分析，已分析的从 DB 缓存恢复 |
| `BuildConfFragmentStage` | papers + analyses | `context.conference_html` + `context.conference_md` | 按 A/B 类分组生成 HTML+MD |

**为什么**：
- `blog_subs` 是项目中最轻量的数据源模块（3 阶段 vs GitHub 的 4 阶段），代码结构清晰（~350 行），是最合适的参考模板。
- 会议论文与博客文章有相似的数据流：抓取 → LLM 分析 → 生成片段。不需要评分阶段（arXiv 特有的 6 维评分不适用于已录用的顶会论文）。
- 独立 `main_conf.py` 入口支持单独调试，与 `main_blog.py` / `main_official.py` 保持一致的入口风格。

## Decision 4: 抓取策略 — 滑动窗口 + 幂等去重

**选择**：

```
每次运行：
1. 遍历配置的会议列表
2. 对每个会议，查询 Semantic Scholar：
   - venue={s2_venue}, year={当前年 or 上一年}
   - publicationDate >= {今天 - conference_lookback_days}
   - 按 publicationDate 倒序
3. 对 DBLP 做补充查询：
   - toc:db/conf/{dblp_key}/{dblp_key}{year}.bht
   - 与 S2 结果按 DOI/title 去重
4. 与 DB 中已有记录去重（基于 paper_key = DOI or s2_paperId or title_hash）
5. 只保留与 conference_topics 关键词匹配的论文
```

**默认配置**：
- `conference_lookback_days = 30`：抓取最近 30 天内发表的论文
- `conference_max_papers_per_venue = 50`：每个会议最多 50 篇
- `conference_max_total = 100`：总共最多 100 篇送入 LLM 分析
- `conference_rank_filter = ["A", "B"]`：默认同时追踪 A 类和 B 类

**为什么**：
- 会议论文不是每日发布，用滑动窗口（30 天）而非固定日期（昨天）更合理。
- 窗口 + DB 去重 = 幂等：同一天跑多次不会重复分析，也不会遗漏窗口内的新论文。
- 按 DOI 优先、title hash 兜底去重：部分会议论文没有 DOI（如 ICLR），需要 title + venue 的组合作为唯一键。

## Decision 5: Semantic Scholar API 调用策略

**选择**：

```python
# fetcher.py 核心逻辑
async def fetch_semantic_scholar(conference: dict, keywords: list[str], lookback_days: int) -> list[dict]:
    """
    Semantic Scholar bulk search:
    GET /graph/v1/paper/search/bulk
        ?query={keyword}
        &venue={s2_venue}
        &year={current_year}
        &publicationDateOrYear={lookback_start}:{today}
        &fields=title,abstract,authors,citationCount,externalIds,publicationDate,venue,tldr,openAccessPdf
        &limit=50
    """
    # 每个会议只请求 1 次（用空 query 匹配全部 + venue 过滤）
    # 如果 API key 不可用，回退到 DBLP-only 模式
```

- API key 从 `.env` 的 `SEMANTIC_SCHOLAR_API_KEY` 读取，无 key 时使用匿名模式（1 req/sec 共享限流）。
- 每个会议 1 次 API 调用（空 query + venue 过滤），18 个会议 = 18 次调用，~18 秒。
- 使用 `asyncio.sleep(1.1)` 在请求间保持礼貌（Semantic Scholar 要求 1 req/sec）。
- 如果 S2 不可用（网络/限流），自动回退到 DBLP-only 模式。

**为什么不**：
- 不用 bulk search 的 cursor 翻页：每个会议 50 篇上限足够，不需要翻页。
- 不用推荐 API（`/recommendations`）：那是基于 seed paper 的推荐，不适合会议论文追踪。

## Decision 6: LLM 分析 Prompt 设计

**选择**：复用 `call_llm.py` 的 `LLMClient`，为会议论文设计专用 prompt：

```
你是一位 AI 领域的学术论文分析专家。请分析以下会议论文，生成中文摘要和评估。

论文信息：
- 标题：{title}
- 会议：{venue} ({rank}类, {category})
- 作者：{authors}
- 摘要：{abstract}
- 引用数：{citation_count}

请输出 JSON：
{
  "one_liner": "一句话中文概括（20字以内）",
  "summary_cn": "中文摘要翻译+核心贡献（100字以内）",
  "core_contribution": "核心技术创新点（50字以内）",
  "ecommerce_connection": "与电商AI的潜在关联（30字以内，无关联则写'无直接关联'）",
  "relevance": "高/中/低"
}
```

- 并发度：`Semaphore(5)`，与 arXiv 分析一致。
- 缓存：已分析的论文（`analyzed=True`）从 DB 恢复，跳过 LLM 调用。
- 失败兜底：`one_liner="[分析失败]"`、`relevance="低"`。

## Decision 7: 日报展示 — Part 5 会议论文追踪

**选择**：

HTML 片段结构：
```
Part 5: 会议论文追踪
├── 统计概览（N 篇新论文，A 类 X 篇，B 类 Y 篇）
├── A 类会议论文
│   ├── 按会议分组（NeurIPS 2025 / ICML 2025 / ...）
│   └── 每篇：标题(链接) + 作者 + 一句话概括 + LLM 摘要 + 引用数 badge
├── B 类会议论文
│   └── 同上结构
└── 无数据时显示占位符
```

- A 类论文用紫色标签（与 arXiv "极度推荐" 一致的视觉语言）。
- B 类论文用蓝色标签。
- 引用数 > 50 的论文加 "高引" badge。

## Risks

- **Semantic Scholar API 稳定性**：S2 API 偶尔出现 venue 匹配不准确（如 "NeurIPS" 匹配到 workshop papers）。缓解：DBLP 补充 + 结果按 `publicationTypes` 过滤掉 "Review" 类型。
- **venue 名称漂移**：会议更名（如 "NIPS" → "NeurIPS"，"SIGKDD" → "KDD"）。缓解：`aliases` 字段覆盖历史名称，fetcher 中做归一化。
- **LLM 成本**：如果某次会议集中录用 100+ 篇论文，LLM 分析成本可能较高。缓解：`conference_max_total=100` 硬上限 + DB 缓存跳过已分析论文。
- **DBLP 无摘要**：DBLP-only 回退模式下论文缺少摘要，LLM 分析质量下降。缓解：S2 不可用时从 OpenAlex 补查摘要（可选，作为后续优化）。

## Out of Scope

- **论文 PDF 下载与全文分析**：只分析 abstract，不下载 PDF。
- **arXiv ↔ 会议论文关联**：不将 arXiv 预印本与会议录用论文做匹配去重（后续优化）。
- **OpenReview 集成**：不使用 OpenReview API 获取审稿意见（复杂度高，收益有限）。
- **Web UI 扩展**：Streamlit 看板暂不展示会议论文数据（仅日报 HTML/MD 输出）。
- **会议 deadline 提醒**：不追踪论文投稿截止日期（这是另一个工具的职责）。
