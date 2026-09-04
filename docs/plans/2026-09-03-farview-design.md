# 高见（FarView）产品与技术设计

> 来源：GitHub Issue #1《日报增加“本周上升话题”榜》  
> 状态：Phase 1 MVP 已实现；Phase 2/3 为路线图。统计口径为最近 7 天热度榜，旧基线方案不再采用。

## 1. 产品定位

高见回答一个独立于“往事”和“新知”的问题：**最近 7 天哪些技术话题最受关注，为什么值得关注？**

| 模块 | 用户问题 | 核心对象 | 时间尺度 |
|---|---|---|---|
| 往事 OldEcho | 我过去保存了什么？ | 私人笔记 | 任意 |
| 新知 NewLore | 今天有哪些内容值得看？ | 论文、仓库、文章 | 日 |
| 高见 FarView | 最近 7 天大家关注什么？ | 归一化话题与热度 | 7 天 |
| 闹闹 Notty | 我现在想完成什么？ | 会话与工具任务 | 实时 |

高见不是 NewLore 日报中的一个长板块。它复用 NewLore 的采集结果，但拥有独立入口、时间尺度和交互方式。热度数据全局共享，用户偏好只影响个人排序、标记和反馈。NewLore 负责“看条目”，高见负责“看话题热度”。

英文名使用 `FarView`，与 `OldEcho`、`NewLore` 保持组合词命名风格。`FarView` 是代码、API、数据表和配置中的统一英文标识，界面中文仍统一显示“高见”。

## 2. 导航与页面结构

### 2.1 macOS

在左侧主导航中增加与“往事”“新知”同级的模块标题：

```text
高见  FarView
新知  NewLore
往事  OldEcho
```

- 图标：`chart.line.uptrend.xyaxis`。
- 点击模块标题进入高见首页。
- 当前版本点击模块标题进入最近 7 天热度榜；“持续升温”和“历史回看”属于后续阶段。
- 中间主区域展示趋势榜或话题详情；右侧闹闹抽屉保持可用。

### 2.2 iOS / iPadOS

在底部 `TabView` 中将“高见”置于首位，其后依次为“新知”和“往事”。

- 高见内部使用 `NavigationStack`。
- 首页点击话题进入详情页。
- iPad 分栏模式可沿用 macOS 的榜单 + 详情布局。

## 3. 高见首页

当前版本的固定周期为最近 7 天：

- 本周：统计包含截止日在内的最近 7 个自然日，按独立内容量和来源覆盖计算热度。
- 本月和自定义周期属于后续版本。

以下完整产品结构跨越多个阶段。Phase 1 当前只提供概览、最近 7 天榜单、来源构成和代表内容；走势、筛选、解释与关注功能属于路线图。

### 3.1 概览

显示：

- 本周期共识别多少个有效话题；
- 多少个首次进入上升榜；
- 数据覆盖的论文、仓库、博客、官方动态、会议论文和公众号数量；
- 数据是否达到可信门槛。

有最近 7 天采集数据即可生成榜单；完全没有有效内容时不生成榜单，并提供“补充新知”入口。

### 3.2 最近 7 天热门话题（Phase 1 已实现）

最多 10 条，每条卡片显示：

- 排名与归一化话题名；
- 状态标签属于 Phase 2；
- 最近 7 天的独立内容数；
- 跨来源归一化后的热度分；
- 来源构成，例如“论文 12 · GitHub 4 · 博客 3”；
- 一句“这是什么”属于 Phase 2；
- 3 个代表条目。

按来源筛选属于 Phase 2。

### 3.3 持续升温（Phase 2）

展示连续两个以上周期保持增长的话题。它与突发榜分开，避免只有突然爆发的短期话题占满首页。

### 3.4 与我相关（部分实现）

使用用户的 `newlorePreferences.focus/topics` 对已算出的趋势结果做重排和标记，不改变全局趋势分：

- “与你的长期兴趣相关”；
- “符合今日重点”；
- “圈子整体上升，但不在你的关注范围”。

这样保留趋势统计的客观性，同时让已有偏好真正影响用户看到的排序。

## 4. 话题详情页

当前详情页已实现本周热度、来源构成和 3 个代表条目。以下其余交互属于 Phase 2/3：

1. **本周热度**：显示最近 7 天独立条目数、归一化热度和来源覆盖。
2. **来源构成**：论文、GitHub、博客、官方、会议、公众号占比。
3. **为何上升**：LLM 基于代表条目生成 2～3 句解释，必须引用来源。
4. **代表内容**：按来源多样性选择 3～10 条，不只按单一分数排序。
5. **同义表达**：展示被合并的短语，例如 `agent harness / agent scaffold / loop engineering`，允许用户反馈“错误合并”或“应当合并”。
6. **我的动作（路线图）**：关注话题、加入长期兴趣、让闹闹深入研究、查看相关新知日报。

## 5. 统计方法

### 5.1 输入数据

首版使用现有表：

- `papers`：标题、摘要、关键词、published / firstSeenDate；
- `github_repos`：名称、描述、topics、firstSeenDate、starsHistory；
- `blog_posts` / `official_items`：标题、摘要、正文、firstSeenDate；
- `conference_papers`：标题、摘要、关键词、publicationDate / firstSeenDate；
- `wechat_articles`：标题、摘要、关键词、publishTime / firstSeenDate。

默认按 `firstSeenDate` 统计“NoteOne 首次观察到的热度”；详情页可同时显示来源发布日期。
趋势数据全局共享，不按用户拆分。多源内容不能直接按原始出现次数相加：先按来源类型去重，记录每个来源的独立条目数和覆盖范围，再进行来源归一化与多样性计算，最后生成全局趋势分。这样可以避免采集频率更高的来源天然主导榜单。

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

每个话题按最近 7 天记录：

- `current_count`：窗口内独立条目数；
- `normalized_heat`：话题在各来源中的覆盖比例均值；
- `source_diversity`：支持该话题的来源类型数。

进入榜单需同时满足：

- 达到配置项 `farview_minimum_count` 指定的独立条目数（当前默认 2）；
- 至少来自 2 类来源，或单一来源达到更高阈值；
- 不是已配置的停用话题。

最终综合分建议：

```text
score = log(1 + current_count)
      + normalized_heat
      + source_diversity / 6
```

阈值必须放入配置，可通过历史回测调整，不应直接固化成产品承诺。
榜单按热度分降序展示，最多 10 条；同分时依次按独立条目数、来源多样性和规范化名称排序，保证重复计算结果稳定。

### 5.4 同义话题合并

分两阶段实施：

1. 首版使用确定性别名表、缩写和词形规则；
2. 后续使用独立配置的 embedding 模型计算候选短语相似度，只产生“建议合并”，由稳定规则或用户确认后写入别名表。

不要直接让 embedding 每次运行时重写聚类，否则历史趋势会随模型变化而漂移。话题应有稳定 `topic_id`，别名变化需要版本记录。

## 6. 数据模型

完整路线图建议新增以下表；Phase 1 当前只实现 `farview_snapshots`，以单个 JSON 快照保存榜单：

### `farview_topics`

- `id` UUID；
- `canonical_name`；
- `display_name_zh` / `display_name_en`；
- `aliases` JSON；
- `status`：active / merged / blocked；
- `merged_into_id`；
- `created_at` / `updated_at`。

### `farview_mentions`

- `topic_id`；
- `source_type`；
- `source_id`；
- `observed_date`；
- `matched_phrase`；
- 唯一约束 `(topic_id, source_type, source_id)`。

### `farview_snapshots`

- `period_start` / `period_end`；
- `period_days = 7`；
- `count_total` 与各来源计数；
- `normalized_heat` / `source_diversity` / `score`；
- `representative_items` JSON；
- 每个统计截止日保留一份全局快照。

### `farview_explanations`

- `topic_id` / `period_start`；
- `language`；
- `summary`；
- `source_refs` JSON；
- `model` / `prompt_version`；
- 唯一约束 `(topic_id, period_start, language)`。

统计结果持久化，页面读取缓存，不在每次打开时扫描全部历史表。

## 7. API

建议新增 `/api/farview`：

- `GET /overview?period=week&source=all`：首页概览及榜单；
- `GET /topics/:id?period=week`：趋势、来源构成和代表条目；
- `POST /refresh`：增量计算本周期统计；
- `POST /topics/:id/follow`：加入长期兴趣；
- `POST /topics/:id/alias-feedback`：报告错误合并或建议合并；
- `GET /status`：数据范围、最近计算时间、是否正在刷新。

`POST /refresh` 应与 NewLore pipeline 解耦：NewLore 每个模块完成后只记录新数据，统一 merge 完成后异步触发 FarView 增量计算。趋势数据全局共享，用户偏好只用于个人重排、标记和反馈，不改变全局趋势分。

## 8. 计算与通知

- 每次 NewLore 完成后重新计算最近 7 天热度；
- 榜单按截止日缓存，页面不直接扫描来源表；
- 数据回填或别名变更时支持指定日期范围重算；
- 事件推送属于后续阶段：只有连续两次计算超过阈值或来源多样性达标才通知，避免瞬时噪音；
- 用户可选择“仅榜单”“关注话题推送”“全部突发推送”。

## 9. 设置项

在“设置 → 高见”提供：

- 是否启用趋势计算；
- 统计窗口固定为最近 7 天；
- 最低条目数；
- 是否使用 GitHub star 增速加权；
- 独立 embedding Base URL / Model / API Key（Phase 3）；
- 额外屏蔽话题列表（内置通用停用词始终生效）；
- 通知阈值（Phase 3）。

Issue 中提到的 embedding 模型写死问题应作为 FarView 的前置基础设施修复：聊天模型和 embedding 模型必须独立配置。语义搜索与 FarView 同义词建议共用这一配置，但各自失败时都应有确定性降级。

## 10. 实施阶段

### Phase 1：可验证多源 MVP

- 使用论文、会议论文、GitHub、博客、官方内容和微信公众号中实际可用的数据；
- 为每种来源统一处理去重、观察日期和来源类型；
- 规则化中英文 1～3 gram；
- 有最近 7 天有效数据即可计算并展示 Top 10 榜单；
- 展示独立条目数、来源构成和归一化热度；
- 高见独立 Tab、首页和详情页；
- 无 embedding 聚类，无即时推送；
- 使用历史数据回测已知话题（公开稳定版前的质量验证项，不属于运行时能力）。

验收标准：

- 同一数据集重复计算结果一致；
- 少于绝对阈值的话题不上榜；
- 能输出代表条目与来源链接；走势属于 Phase 2；
- 计算失败不影响 NewLore 日报生成。

### Phase 2：来源质量与个性化趋势

- 来源权重、来源质量和多样性校准；
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
- 不直接修改 NewLore 日报排序逻辑；
- 最近 7 天没有有效内容时明确显示空状态；
- 不承诺“预测行业未来”，只陈述 NoteOne 数据范围内的上升信号。

## 12. 与 Issue #1 的对应关系

- “本周上升话题”成为高见首页核心榜单；
- n-gram、内置停用词与坏词过滤、最低绝对次数、最近 7 天窗口和 top 10 保留；
- 3 篇代表内容已纳入 Phase 1；走势和带引用解释保留在 Phase 2；
- embedding 同义词合并调整为第二阶段，避免历史漂移；
- 即时推送调整为第三阶段；
- 社交信号作为多源加权，不进入 MVP；
- `focus/topics` 用于个性化重排；
- embedding 独立配置列为基础设施前置工作。
