# 高见（HighFeel）产品与技术设计

> 来源：GitHub Issue #1《日报增加“本周上升话题”榜》  
> 状态：需求整理，尚未实施

## 1. 产品定位

高见回答一个独立于“往事”和“新知”的问题：**最近哪些技术方向正在显著升温，为什么值得关注？**

| 模块 | 用户问题 | 核心对象 | 时间尺度 |
|---|---|---|---|
| 往事 OldScene | 我过去保存了什么？ | 私人笔记 | 任意 |
| 新知 NewSee | 今天有哪些内容值得看？ | 论文、仓库、文章 | 日 |
| 高见 HighFeel | 圈子正在往哪里走？ | 归一化话题与趋势 | 周 / 月 |
| 闹闹 Notty | 我现在想完成什么？ | 会话与工具任务 | 实时 |

高见不是 NewSee 日报中的一个长板块。它复用 NewSee 的采集结果，但拥有独立入口、时间尺度和交互方式。NewSee 负责“看条目”，高见负责“看趋势”。

英文名使用 `HighFeel`，与 `OldScene`、`NewSee` 保持组合词命名风格。界面中文统一显示“高见”。

## 2. 导航与页面结构

### 2.1 macOS

在左侧主导航中增加与“往事”“新知”同级的模块标题：

```text
往事  OldScene
新知  NewSee
高见  HighFeel
```

- 图标：`chart.line.uptrend.xyaxis`。
- 点击模块标题进入高见首页。
- 模块可折叠；展开时显示“本周上升”“持续升温”“历史回看”三个快捷入口。
- 中间主区域展示趋势榜或话题详情；右侧闹闹抽屉保持可用。

### 2.2 iOS / iPadOS

在底部 `TabView` 增加“高见”Tab，位于“新知”之后、闹闹/设置之前。

- 高见内部使用 `NavigationStack`。
- 首页点击话题进入详情页。
- iPad 分栏模式可沿用 macOS 的榜单 + 详情布局。

## 3. 高见首页

默认周期为“本周”，顶部提供周期切换：

- 本周：最近 7 天相对过去 8 周基线。
- 本月：最近 28 天相对过去 6 个月基线。
- 自定义：后续版本支持。

首页由四部分组成。

### 3.1 概览

显示：

- 本周期共识别多少个有效话题；
- 多少个首次进入上升榜；
- 数据覆盖的论文、仓库、博客、官方动态、会议论文和公众号数量；
- 数据是否达到可信门槛。

数据不足时不生成伪榜单，显示“至少需要 3 个有效周的数据”，并提供“补充新知”入口。

### 3.2 本周上升话题

最多 10 条，每条卡片显示：

- 排名与归一化话题名；
- 状态：初现 / 快速上升 / 持续升温 / 高位稳定 / 降温；
- 最近 3 个周期走势，例如 `3 → 7 → 19`；
- 当前出现次数和基线均值；
- 突发分，但默认使用“升温强度”文字，不要求普通用户理解 z-score；
- 来源构成，例如“论文 12 · GitHub 4 · 博客 3”；
- 一句“这是什么”，仅对上榜话题调用 LLM；
- 3 个代表条目。

榜单支持按“综合、论文、开源、行业内容”筛选。

### 3.3 持续升温

展示连续两个以上周期保持增长的话题。它与突发榜分开，避免只有突然爆发的短期话题占满首页。

### 3.4 与我相关

使用用户的 `ascanPreferences.focus/topics` 对已算出的趋势结果做重排和标记，不改变全局趋势分：

- “与你的长期兴趣相关”；
- “符合今日重点”；
- “圈子整体上升，但不在你的关注范围”。

这样保留趋势统计的客观性，同时让已有偏好真正影响用户看到的排序。

## 4. 话题详情页

详情页包含：

1. **趋势曲线**：至少 9 周；显示当前周期、8 周基线和首次起量点。
2. **来源构成**：论文、GitHub、博客、官方、会议、公众号占比。
3. **为何上升**：LLM 基于代表条目生成 2～3 句解释，必须引用来源。
4. **代表内容**：按来源多样性选择 3～10 条，不只按单一分数排序。
5. **同义表达**：展示被合并的短语，例如 `agent harness / agent scaffold / loop engineering`，允许用户反馈“错误合并”或“应当合并”。
6. **我的动作**：关注话题、加入长期兴趣、让闹闹深入研究、查看相关新知日报。

## 5. 统计方法

### 5.1 输入数据

首版使用现有表：

- `papers`：标题、摘要、关键词、published / firstSeenDate；
- `github_repos`：名称、描述、topics、firstSeenDate、starsHistory；
- `blog_posts` / `official_items`：标题、摘要、正文、firstSeenDate；
- `conference_papers`：标题、摘要、关键词、publicationDate / firstSeenDate；
- `wechat_articles`：标题、摘要、关键词、publishTime / firstSeenDate。

默认按 `firstSeenDate` 统计“NoteOne 首次观察到的热度”；详情页可同时显示来源发布日期。

### 5.2 候选短语提取

首版必须可复现，不依赖 LLM：

1. Unicode 规范化、英文小写化；
2. 去除 URL、版本号、组织名和通用停用词；
3. 从标题、摘要和来源关键词中提取 1～3 词短语；
4. 使用词形还原和缩写表归一化；
5. 过滤过宽词汇，如 `model`、`method`、`system`；
6. 同一条内容中的同一短语只计一次，防止长摘要重复放大。

中英文分别分词，再在归一化阶段建立跨语言别名。

### 5.3 突发分

每个话题按周记录：

- `current_count`：本周独立条目数；
- `baseline_mean`：过去 8 个完整周均值；
- `baseline_stddev`：过去 8 周标准差；
- `growth_ratio = current_count / max(baseline_mean, 1)`；
- `burst_score = (current_count - baseline_mean) / max(baseline_stddev, 1)`。

进入榜单需同时满足：

- 本周至少 8 个独立条目；
- 至少来自 2 类来源，或单一来源达到更高阈值；
- `growth_ratio >= 2`；
- `burst_score >= 2`；
- 不是已配置的停用话题。

最终综合分建议：

```text
score = 0.55 × burst_score
      + 0.25 × log(1 + current_count)
      + 0.20 × source_diversity
```

阈值必须放入配置，可通过历史回测调整，不应直接固化成产品承诺。

### 5.4 同义话题合并

分两阶段实施：

1. 首版使用确定性别名表、缩写和词形规则；
2. 后续使用独立配置的 embedding 模型计算候选短语相似度，只产生“建议合并”，由稳定规则或用户确认后写入别名表。

不要直接让 embedding 每次运行时重写聚类，否则历史趋势会随模型变化而漂移。话题应有稳定 `topic_id`，别名变化需要版本记录。

## 6. 数据模型

建议新增以下表：

### `highfeel_topics`

- `id` UUID；
- `canonical_name`；
- `display_name_zh` / `display_name_en`；
- `aliases` JSON；
- `status`：active / merged / blocked；
- `merged_into_id`；
- `created_at` / `updated_at`。

### `highfeel_mentions`

- `topic_id`；
- `source_type`；
- `source_id`；
- `observed_date`；
- `matched_phrase`；
- 唯一约束 `(topic_id, source_type, source_id)`。

### `highfeel_weekly_stats`

- `topic_id`；
- `week_start`；
- `count_total` 与各来源计数；
- `baseline_mean` / `baseline_stddev`；
- `growth_ratio` / `burst_score` / `score`；
- `representative_items` JSON；
- 唯一约束 `(topic_id, week_start)`。

### `highfeel_explanations`

- `topic_id` / `period_start`；
- `language`；
- `summary`；
- `source_refs` JSON；
- `model` / `prompt_version`；
- 唯一约束 `(topic_id, period_start, language)`。

统计结果持久化，页面读取缓存，不在每次打开时扫描全部历史表。

## 7. API

建议新增 `/api/highfeel`：

- `GET /overview?period=week&source=all`：首页概览及榜单；
- `GET /topics/:id?period=week`：趋势、来源构成和代表条目；
- `POST /refresh`：增量计算本周期统计；
- `POST /topics/:id/follow`：加入长期兴趣；
- `POST /topics/:id/alias-feedback`：报告错误合并或建议合并；
- `GET /status`：数据范围、最近计算时间、是否正在刷新。

`POST /refresh` 应与 NewSee pipeline 解耦：NewSee 每个模块完成后只记录新数据，统一 merge 完成后异步触发 HighFeel 增量计算。

## 8. 计算与通知

- 每次 NewSee 完成后计算当前周增量；
- 每周固定时间生成完整周榜并缓存解释；
- 数据回填或别名变更时支持指定日期范围重算；
- 事件推送属于后续阶段：只有连续两次计算超过阈值或来源多样性达标才通知，避免瞬时噪音；
- 用户可选择“仅榜单”“关注话题推送”“全部突发推送”。

## 9. 设置项

在“设置 → 高见”提供：

- 是否启用趋势计算；
- 周期与基线长度；
- 最低条目数；
- 是否使用 GitHub star 增速加权；
- 独立 embedding Base URL / Model / API Key；
- 话题别名与停用列表；
- 通知阈值。

Issue 中提到的 embedding 模型写死问题应作为 HighFeel 的前置基础设施修复：聊天模型和 embedding 模型必须独立配置。语义搜索与 HighFeel 同义词建议共用这一配置，但各自失败时都应有确定性降级。

## 10. 实施阶段

### Phase 1：可验证 MVP

- 只使用论文和会议论文；
- 规则化英文 1～3 gram；
- 8 周基线与 top 10；
- 高见独立 Tab、首页和详情页；
- 无 embedding 聚类，无即时推送；
- 使用历史 6 个月数据回测 harness、RSI 等已知话题。

验收标准：

- 同一数据集重复计算结果一致；
- 少于绝对阈值的话题不上榜；
- 能输出走势、代表条目与来源引用；
- 计算失败不影响 NewSee 日报生成。

### Phase 2：多源趋势

- 加入 GitHub、博客、官方和公众号；
- 来源权重和多样性；
- 接入用户 focus/topics 重排；
- 关注话题。

### Phase 3：语义归一与事件推送

- 独立 embedding 配置；
- 同义词建议与人工反馈；
- GitHub star 增速、Hugging Face 投票等社交信号；
- 达阈值即时推送。

## 11. 不纳入首版

- 不让 LLM 决定哪些话题上榜；
- 不实时扫描全库；
- 不直接修改 NewSee 日报排序逻辑；
- 不在数据不足时输出榜单；
- 不承诺“预测行业未来”，只陈述 NoteOne 数据范围内的上升信号。

## 12. 与 Issue #1 的对应关系

- “本周上升话题”成为高见首页核心榜单；
- n-gram、8 周均值/方差、最低绝对次数和 top 10 保留；
- 走势、3 篇代表内容和一句解释保留；
- embedding 同义词合并调整为第二阶段，避免历史漂移；
- 即时推送调整为第三阶段；
- 社交信号作为多源加权，不进入 MVP；
- `focus/topics` 用于个性化重排；
- embedding 独立配置列为基础设施前置工作。
