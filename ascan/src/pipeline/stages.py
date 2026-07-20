"""
arXiv pipeline 各阶段实现

FetchStage → ParseStage → ScoreStage → AnalyzeStage → GenerateReportStage
"""

import asyncio
import re
from datetime import datetime
from typing import List, Dict, Optional

import arxiv
import feedparser
import requests as _requests
from loguru import logger

from src.config.settings import get_settings
from src.pipeline.core import PipelineStage, PipelineContext
from src.database.connection import DBSession
from src.database.repositories import PaperRepository
from src.models.schemas import ArxivPaper, PaperAnalysis
from src.core.scoring import MultiDimensionScorer, RECOMMENDATION_ORDER


def _configure_arxiv_client(client: arxiv.Client, timeout_seconds: int = 30) -> arxiv.Client:
    """配置 arXiv 客户端：禁用 SSL 验证、设置超时、使用 HTTP（避免 HTTPS 限流）。"""
    # arXiv HTTPS 端点经常返回 429，HTTP 端点更稳定
    client.query_url_format = "http://export.arxiv.org/api/query?{}"
    client._session.verify = False
    original_request = client._session.request

    def request_with_timeout(method, url, **kwargs):
        kwargs.setdefault("timeout", timeout_seconds)
        return original_request(method, url, **kwargs)

    client._session.request = request_with_timeout
    return client


class _RssEntry:
    """arXiv RSS feed entry — lightweight substitute for arxiv.Result."""

    def __init__(self, paper_id: str, title: str, abstract: str, authors: list, link: str):
        self.paper_id = paper_id
        self.title = title
        self.summary = abstract
        self.authors = [type("A", (), {"name": a})() for a in authors]
        self.entry_id = link
        self.pdf_url = f"https://arxiv.org/pdf/{paper_id}.pdf"
        self.doi = None
        self.published = datetime.now()
        self.categories = []

    def get_short_id(self):
        return self.paper_id


# ── Stage 1: Fetch ──────────────────────────────────────────────────────────

class FetchStage(PipelineStage):
    """从 arXiv API 抓取论文 ID，429 限流时 fallback 到 RSS。"""

    def __init__(self, max_results: int = 200):
        super().__init__("fetching")
        self.max_results = max_results

    async def execute(self, context: PipelineContext) -> bool:
        settings = get_settings()
        all_ids: list[str] = []
        seen_ids: set[str] = set()
        rss_entries: list[_RssEntry] = []
        target_date_obj = datetime.strptime(context.date, "%Y-%m-%d").date()

        # Cross-day dedup: load all known arxiv_ids from DB so papers already
        # reported in previous days' runs are skipped today. arXiv's RSS feed
        # can include papers from previous days (re-indexing, late submissions),
        # which would otherwise show up in multiple daily reports.
        from src.database.connection import get_db_session
        from src.database.repositories import PaperRepository
        try:
            db = get_db_session()
            known_arxiv_ids = PaperRepository(db).get_all_arxiv_ids()
            seen_ids |= known_arxiv_ids
            logger.info(f"Cross-day dedup: {len(known_arxiv_ids)} arxiv_ids already in DB")
        except Exception as e:
            logger.warning(f"Failed to load known arxiv_ids for dedup: {e}")

        for subject in context.subjects:
            logger.info(f"抓取主题: {subject} (RSS 优先)")
            rss_retry_delays = [5, 10, 15]
            rss_ok = False

            # ── Primary: RSS feed ────────────────────────────────────
            for rss_attempt, rss_wait in enumerate([0] + rss_retry_delays):
                if rss_wait:
                    logger.warning(f"主题 {subject} RSS 等待 {rss_wait}s 后重试 (第{rss_attempt}次)...")
                    await asyncio.sleep(rss_wait)
                try:
                    r = _requests.get(
                        f"https://rss.arxiv.org/rss/{subject}",
                        verify=False, timeout=30,
                    )
                    if r.status_code == 200:
                        feed = feedparser.parse(r.content)
                        rss_count = 0
                        for entry in feed.entries:
                            link = entry.get("link", "")
                            m = re.search(r"/abs/(\d+\.\d+)", link)
                            if m and m.group(1) not in seen_ids:
                                paper_id = m.group(1)
                                all_ids.append(paper_id)
                                seen_ids.add(paper_id)
                                rss_count += 1
                                summary = entry.get("summary", "")
                                abstract = re.sub(r"^.*?Abstract:\s*", "", summary, flags=re.DOTALL).strip()
                                authors = [a.get("name", "") for a in entry.get("authors", [])]
                                rss_entries.append(
                                    _RssEntry(
                                        paper_id=paper_id,
                                        title=entry.get("title", "").strip(),
                                        abstract=abstract,
                                        authors=authors,
                                        link=link,
                                    )
                                )
                        if rss_count > 0:
                            logger.info(
                                f"主题 {subject} RSS: {rss_count} 篇（共 {len(feed.entries)} 条），"
                                f"累计 {len(all_ids)} 篇"
                            )
                            rss_ok = True
                            break
                        else:
                            if len(feed.entries) == 0:
                                logger.warning(f"主题 {subject} RSS feed 为空（arXiv 可能尚未更新）")
                            else:
                                logger.warning(
                                    f"主题 {subject} RSS feed 有 {len(feed.entries)} 条但全部已去重"
                                )
                    else:
                        logger.warning(f"主题 {subject} RSS HTTP {r.status_code}")
                except Exception as e2:
                    logger.warning(f"主题 {subject} RSS 异常 (第{rss_attempt+1}次): {e2}")

            # ── Fallback: arXiv API ──────────────────────────────────
            if not rss_ok:
                logger.info(f"主题 {subject}: RSS 失败，尝试 arxiv API...")
                from datetime import datetime as _dt, timedelta as _td
                target_dt = _dt.strptime(context.date, "%Y-%m-%d")
                start_dt = target_dt - _td(days=3)
                start_compact = start_dt.strftime("%Y%m%d")
                date_compact = target_dt.strftime("%Y%m%d")
                query = f"cat:{subject} AND submittedDate:[{start_compact}0000 TO {date_compact}2359]"
                api_retry_delays = [5, 10, 15]
                for attempt, wait in enumerate([0] + api_retry_delays):
                    if wait:
                        logger.warning(f"主题 {subject} API 等待 {wait}s 后重试 (第{attempt}次)...")
                        await asyncio.sleep(wait)
                    if attempt == 0 and subject != context.subjects[0]:
                        await asyncio.sleep(3)
                    try:
                        client = _configure_arxiv_client(
                            arxiv.Client(num_retries=0, delay_seconds=3.5),
                            timeout_seconds=30,
                        )
                        search = arxiv.Search(
                            query=query,
                            max_results=settings.max_papers_per_subject,
                            sort_by=arxiv.SortCriterion.SubmittedDate,
                        )
                        subject_results = []
                        for result in client.results(search):
                            paper_id = result.get_short_id().split("v")[0]
                            if paper_id not in seen_ids:
                                all_ids.append(paper_id)
                                seen_ids.add(paper_id)
                                subject_results.append(result)

                        logger.info(
                            f"主题 {subject} API: 找到 {len(subject_results)} 篇，累计去重后 {len(all_ids)} 篇"
                        )
                        if len(subject_results) > 0:
                            break
                    except Exception as e:
                        if attempt < len(api_retry_delays):
                            logger.warning(f"主题 {subject} API 异常，{api_retry_delays[attempt]}s 后重试: {e}")
                        else:
                            logger.warning(f"主题 {subject} API 失败（已重试）: {e}")
                            break

        context.raw_ids = all_ids
        context._rss_entries = rss_entries
        context.total_papers = len(all_ids)
        logger.success(f"共获取 {len(all_ids)} 篇不重复论文")
        return True


# ── Stage 2: Parse ──────────────────────────────────────────────────────────

class ParseStage(PipelineStage):
    """解析论文元数据。RSS 已有完整数据时跳过 arXiv API 查询。"""

    def __init__(self, max_papers: int = 500):
        super().__init__("parsing")
        self.max_papers = max_papers

    async def execute(self, context: PipelineContext) -> bool:
        if not context.raw_ids:
            logger.warning("没有论文 ID 需要解析")
            return True

        ids = context.raw_ids[:self.max_papers]
        rss_entries: list[_RssEntry] = getattr(context, "_rss_entries", [])

        rss_id_set = {e.paper_id for e in rss_entries}
        ids_need_api = [pid for pid in ids if pid not in rss_id_set]

        if not ids_need_api:
            logger.info(f"全部 {len(rss_entries)} 篇来自 RSS（已含 title/abstract），跳过 API 元数据查询")
            arxiv_results = rss_entries
        else:
            logger.info(f"RSS 覆盖 {len(rss_entries)} 篇，还需从 API 查询 {len(ids_need_api)} 篇元数据")
            api_results = []
            try:
                api_results = self._fetch_arxiv_metadata(ids_need_api)
            except Exception as e:
                logger.warning(f"arXiv API 元数据查询失败（使用 RSS 数据继续）: {e}")
            api_result_ids = {r.get_short_id().split("v")[0] for r in api_results}
            missing_ids = [pid for pid in ids_need_api if pid not in api_result_ids]
            if missing_ids:
                logger.warning(
                    f"API 元数据缺失 {len(missing_ids)} 篇，构造最小元数据兜底"
                )
                for pid in missing_ids:
                    api_results.append(
                        _RssEntry(
                            paper_id=pid,
                            title=f"arXiv:{pid}",
                            abstract="",
                            authors=[],
                            link=f"https://arxiv.org/abs/{pid}",
                        )
                    )
            arxiv_results = list(rss_entries) + api_results
            logger.info(f"合并后共 {len(arxiv_results)} 篇（RSS {len(rss_entries)} + API {len(api_results)}）")

        papers_for_scoring: list[dict] = []
        for result in arxiv_results:
            paper_id = result.get_short_id().split("v")[0] if hasattr(result, "get_short_id") else getattr(result, "paper_id", "")
            papers_for_scoring.append({
                "arxiv_id": paper_id,
                "title": result.title,
                "authors": [a.name for a in result.authors] if hasattr(result, "authors") else [],
                "abstract": result.summary,
                "abs_url": getattr(result, "entry_id", f"https://arxiv.org/abs/{paper_id}"),
                "pdf_url": getattr(result, "pdf_url", f"https://arxiv.org/pdf/{paper_id}.pdf"),
            })

        context.parsed_papers = papers_for_scoring
        context.total_papers = len(papers_for_scoring)
        logger.info(f"正在解析 {len(papers_for_scoring)} 篇论文的元数据...")
        logger.success(f"成功解析 {len(papers_for_scoring)} 篇论文")
        return True

    def _fetch_arxiv_metadata(self, ids: list[str], batch_size: int = 100) -> list:
        import time
        logger.info(f"正在从 arXiv API 分批查询 {len(ids)} 篇论文元数据（每批 {batch_size}）...")
        client = _configure_arxiv_client(arxiv.Client(num_retries=0, delay_seconds=3.5))
        all_results = []
        for i in range(0, len(ids), batch_size):
            batch = ids[i:i + batch_size]
            try:
                search = arxiv.Search(id_list=batch)
                results = list(client.results(search))
                all_results.extend(results)
                logger.info(f"  批次 {i // batch_size + 1}: 查询 {len(batch)} 篇，返回 {len(results)} 篇")
            except Exception as e:
                logger.warning(f"  批次 {i // batch_size + 1}: 查询 {len(batch)} 篇失败: {e}")
                if "429" in str(e):
                    logger.warning("  arXiv 限流，跳过剩余批次")
                    break
            time.sleep(3)
        logger.success(f"API 共解析 {len(all_results)} 篇论文（请求 {len(ids)} 篇）")
        return all_results


# ── Stage 3: Score ──────────────────────────────────────────────────────────

class ScoreStage(PipelineStage):
    """多维度评分 + 过滤精选。"""

    def __init__(self, min_score: float = 30.0, max_papers: int = 15):
        super().__init__("scoring")
        self.min_score = min_score
        self.max_papers = max_papers

    async def execute(self, context: PipelineContext) -> bool:
        papers = getattr(context, "parsed_papers", [])
        if not papers:
            logger.warning("没有论文可评分")
            return True

        from src.core.scoring import DEFAULT_DIRECTIONS
        scorer = MultiDimensionScorer(DEFAULT_DIRECTIONS)
        scored = []
        for p in papers:
            score = scorer.score_paper(
                arxiv_id=p.get("arxiv_id", ""),
                title=p.get("title", ""),
                abstract=p.get("abstract", ""),
                authors=p.get("authors"),
            )
            scored.append(score)
        logger.info(f"评分进度: {len(scored)}/{len(papers)}")

        relevant = [s for s in scored if s.overall_score >= self.min_score]
        selected = sorted(relevant, key=lambda s: s.overall_score, reverse=True)[:self.max_papers]

        logger.info(f"📊 过滤结果: 原始 {len(scored)} 篇 → 相关 {len(relevant)} 篇 → 精选 {len(selected)} 篇（上限 {self.max_papers}）")

        context.scored_papers = selected
        context.selected_ids = [s.arxiv_id for s in selected]
        return True


# ── Stage 4: Analyze (LLM concurrent) ──────────────────────────────────────

class AnalyzeStage(PipelineStage):
    """LLM 并发翻译中文摘要 + 写入 DB。"""

    def __init__(self):
        super().__init__("analyzing")

    async def execute(self, context: PipelineContext) -> bool:
        scored_papers = getattr(context, "scored_papers", [])
        parsed_papers = getattr(context, "parsed_papers", [])
        if not scored_papers:
            logger.warning("没有精选论文需要 LLM 分析")
            return True

        from src.tools.call_llm import LLMClient

        llm_client = LLMClient()
        paper_data_map = {p["arxiv_id"]: p for p in parsed_papers}

        async def _analyze_one(score, idx, total):
            paper_data = paper_data_map.get(score.arxiv_id)
            if not paper_data:
                return score, None
            MAX_LLM_RETRIES = 3
            analysis = None
            for attempt in range(1, MAX_LLM_RETRIES + 1):
                try:
                    logger.info(f"[{idx}/{total}] 生成中文摘要: {score.title[:60]}..." + (f" (重试{attempt})" if attempt > 1 else ""))
                    analysis = await llm_client.analyze_paper_async(
                        paper_data["title"], paper_data["abstract"]
                    )
                    if analysis.trans_abs and "翻译失败" not in analysis.trans_abs and len(analysis.trans_abs) > 20:
                        break
                    logger.warning(f"摘要质量不足，重试... ({attempt}/{MAX_LLM_RETRIES})")
                    analysis = None
                except Exception as e:
                    logger.error(f"LLM 调用失败 ({attempt}/{MAX_LLM_RETRIES}): {e}")
                    analysis = None
            return score, analysis

        total = len(scored_papers)
        tasks = [_analyze_one(s, i + 1, total) for i, s in enumerate(scored_papers)]
        results = await asyncio.gather(*tasks)

        with DBSession() as db:
            repo = PaperRepository(db)
            for score, analysis in results:
                paper_data = paper_data_map.get(score.arxiv_id)
                if not paper_data:
                    continue

                paper = ArxivPaper(
                    arxiv_id=score.arxiv_id,
                    title=score.title,
                    authors=paper_data["authors"],
                    abstract=paper_data["abstract"],
                    abs_url=f"https://arxiv.org/abs/{score.arxiv_id}",
                    pdf_url=f"https://arxiv.org/pdf/{score.arxiv_id}.pdf",
                    published=context.date,
                )

                keywords_list = [d.value for d in score.primary_directions] + score.dimension_scores[0].matched_keywords[:3]
                if len(keywords_list) < 2:
                    keywords_list.extend(["AI", "arXiv"][:2 - len(keywords_list)])

                if analysis and analysis.trans_abs and "翻译失败" not in analysis.trans_abs:
                    paper.analysis = PaperAnalysis(
                        trans_abs=analysis.trans_abs,
                        compressed=analysis.compressed,
                        one_liner=getattr(analysis, "one_liner", None),
                        core_recommendation=getattr(analysis, "core_recommendation", None),
                        keywords=keywords_list,
                        sub_topic=score.primary_directions[0].value if score.primary_directions else "未知",
                        recommendation=score.recommendation_level,
                    )
                else:
                    logger.warning(f"翻译最终失败 {score.arxiv_id}，使用英文摘要兜底")
                    fallback_abs = f"【翻译失败-请查看原文】{paper_data['abstract'][:500]}"
                    paper.analysis = PaperAnalysis(
                        trans_abs=fallback_abs,
                        compressed=f"主要方向: {', '.join(d.value for d in score.primary_directions)}",
                        one_liner=None,
                        core_recommendation=None,
                        keywords=keywords_list,
                        sub_topic=score.primary_directions[0].value if score.primary_directions else "未知",
                        recommendation=score.recommendation_level,
                    )

                repo.create_or_update(paper)

        logger.success(f"✅ LLM 分析完成，已保存 {len(scored_papers)} 篇论文")
        return True


# ── Stage 5: Generate Report ────────────────────────────────────────────────

class GenerateReportStage(PipelineStage):
    """从 DB 读取已分析论文，生成 arXiv HTML 片段。"""

    def __init__(self, output_dir: str = "./output"):
        super().__init__("generating")
        self.output_dir = output_dir

    async def execute(self, context: PipelineContext) -> bool:
        try:
            from src.tools.report2md import papers_to_html
            from src.tools.report_md import papers_to_md

            with DBSession() as db:
                repo = PaperRepository(db)
                papers_db = repo.get_by_date(context.date)
                if not papers_db:
                    logger.warning("没有论文数据可生成报告")
                    return True
                selected_ids = getattr(context, "selected_ids", None)
                if selected_ids:
                    papers_db = [p for p in papers_db if p.arxiv_id in set(selected_ids)]
                    logger.info(f"按精选 ID 过滤后: {len(papers_db)} 篇")
                papers = [p.to_dict() for p in papers_db]
                papers.sort(key=lambda x: RECOMMENDATION_ORDER.get(x.get("recommendation"), 0), reverse=True)
                html_fragment = papers_to_html(context.date, papers)
                md_fragment = papers_to_md(context.date, papers)

            context.arxiv_html = html_fragment
            context.arxiv_markdown = html_fragment
            context.arxiv_md = md_fragment
            logger.success("arXiv HTML + MD 片段已生成，等待统一日报合并")
            return True

        except Exception as e:
            logger.exception(f"生成报告失败: {e}")
            return False
