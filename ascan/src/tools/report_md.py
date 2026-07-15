"""Markdown report renderers — mirrors report2md.py (arXiv) and github_agent/report.py (GitHub)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional


def _safe_join(items: List[str]) -> str:
    return ", ".join([str(item) for item in items if item])


def papers_to_md(date_str: str, papers: List[Dict[str, Any]]) -> str:
    if not papers:
        return "_今日无 arXiv 精选论文。_"

    lines: list[str] = []
    for index, paper in enumerate(papers, start=1):
        title = (paper.get("title") or "").strip()
        authors = paper.get("authors") or []
        abs_url = paper.get("abs_url") or ""
        pdf_url = paper.get("pdf_url") or ""
        keywords = paper.get("keywords") or []
        one_liner = (paper.get("one_liner") or "").strip()
        core_rec = (paper.get("core_recommendation") or "").strip()
        trans_abs = (paper.get("trans_abs") or "").strip()

        lines.append(f"### {index}. {title}")
        lines.append("")
        if authors:
            lines.append(f"**作者：** {_safe_join(authors)}")
        if keywords:
            lines.append(f"**关键词：** {' '.join(f'`{k}`' for k in keywords if k)}")
        if one_liner:
            lines.append(f"**一句话总结：** {one_liner}")

        link_parts = []
        if abs_url:
            link_parts.append(f"[Abstract]({abs_url})")
        if pdf_url:
            link_parts.append(f"[PDF]({pdf_url})")
        if link_parts:
            lines.append(f"**链接：** {' · '.join(link_parts)}")

        lines.append("")
        if trans_abs:
            lines.append(f"> {trans_abs}")
        else:
            lines.append("> _中文摘要生成中..._")

        if core_rec:
            lines.append("")
            lines.append(f"> **核心推荐：** {core_rec}")

        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


def repos_to_daily_md(
    repos: list,
    analyses: Dict[str, Any],
    report_date: str,
) -> str:
    if not repos:
        return "_今日无 GitHub 项目数据。_"

    repo_map = {repo.full_name: repo for repo in repos}

    high_relevance = [
        (name, a) for name, a in analyses.items()
        if a is not None and a.relevance == "高度相关"
    ]
    high_relevance.sort(key=lambda item: -repo_map.get(item[0], type("R", (), {"stars": 0})()).stars)
    table_rows = high_relevance[:15]

    lines: list[str] = []
    lines.append(f"共发现 {len(repos)} 个仓库，聚焦大模型与智能体相关项目。")
    lines.append("")

    lines.append(f"#### 今日精选（高度相关，共 {len(table_rows)} 个）")
    lines.append("")
    if table_rows:
        lines.append("| 项目 | 语言 | Stars | 一句话描述 |")
        lines.append("|------|------|-------|-----------|")
        for name, analysis in table_rows:
            repo = repo_map.get(name)
            if not repo:
                continue
            stars = f"⭐{repo.stars // 1000}k" if repo.stars >= 1000 else f"⭐{repo.stars}"
            lines.append(f"| [{repo.full_name}]({repo.url}) | {repo.language or '—'} | {stars} | {analysis.one_liner} |")
        lines.append("")
    else:
        lines.append("_今日暂无高度相关仓库。_")
        lines.append("")

    relevance_order = {"高度相关": 0, "相关": 1, "一般": 2, "较低": 3}
    analyzed = [(name, a) for name, a in analyses.items() if a is not None]
    analyzed.sort(key=lambda item: (
        relevance_order.get(item[1].relevance, 9),
        -repo_map.get(item[0], type("R", (), {"stars": 0})()).stars,
    ))

    if analyzed:
        lines.append("#### 精选项目深度解析")
        lines.append("")
        for name, analysis in analyzed:
            repo = repo_map.get(name)
            if not repo:
                continue
            stars = f"⭐{repo.stars // 1000}k" if repo.stars >= 1000 else f"⭐{repo.stars}"
            topics = " ".join(f"`{t}`" for t in repo.topics[:6]) if repo.topics else ""

            lines.append(f"##### [{repo.full_name}]({repo.url})")
            lines.append("")
            lines.append(f"**{analysis.one_liner}**")
            lines.append("")
            lines.append(f"- **相关性：** {analysis.relevance}")
            lines.append(f"- **Stars：** {stars}")
            lines.append(f"- **语言：** {repo.language or '—'}")
            if topics:
                lines.append(f"- **标签：** {topics}")
            lines.append(f"- **定位：** {analysis.positioning}")
            lines.append(f"- **核心技术：** {analysis.core_tech}")
            lines.append(f"- **使用场景：** {analysis.use_cases}")
            lines.append(f"- **对比同类：** {analysis.comparison}")
            lines.append(f"- **值得关注：** {analysis.watch_reason}")
            lines.append("")
            lines.append("---")
            lines.append("")

    # ── All repos link list ──────────────────────────────────────────
    analyzed_names = set(analyses.keys())
    unanalyzed = [r for r in repos if r.full_name not in analyzed_names]
    if unanalyzed:
        lines.append("#### 其他仓库")
        lines.append("")
        for repo in unanalyzed:
            stars = f"⭐{repo.stars // 1000}k" if repo.stars >= 1000 else f"⭐{repo.stars}"
            lines.append(f"- [{repo.full_name}]({repo.url}) {stars} {repo.language or ''}")
        lines.append("")

    return "\n".join(lines)


def build_unified_md(
    date_compact: str,
    arxiv_md: Optional[str],
    github_md: Optional[str],
    official_md: Optional[str] = None,
    blog_md: Optional[str] = None,
    conference_md: Optional[str] = None,
    wechat_md: Optional[str] = None,
) -> str:
    date_display = f"{date_compact[:4]}-{date_compact[4:6]}-{date_compact[6:8]}"
    arxiv_body = arxiv_md.strip() if arxiv_md and arxiv_md.strip() else "_今日无 arXiv 数据。_"
    github_body = github_md.strip() if github_md and github_md.strip() else "_今日无 GitHub 数据。_"
    official_body = official_md.strip() if official_md and official_md.strip() else "_今日无 Anthropic Research 或 OpenAI 新文章。_"
    blog_body = blog_md.strip() if blog_md and blog_md.strip() else "_今日无独立博客更新。_"

    subtitle_parts = ["arXiv 论文精选", "GitHub 项目挖掘", "官方动态跟踪", "独立博客"]
    conf_section = ""
    if conference_md and conference_md.strip() and "无新会议论文" not in conference_md:
        subtitle_parts.append("会议论文追踪")
        conf_section = f"""
## Part 5 — 会议论文追踪

{conference_md.strip()}
"""

    wx_section = ""
    if wechat_md and wechat_md.strip() and "无微信公众号更新" not in wechat_md:
        subtitle_parts.append("微信公众号")
        wx_section = f"""
## Part 6 — 微信公众号

{wechat_md.strip()}
"""

    subtitle = " + ".join(subtitle_parts)

    return f"""# Ascan-{date_compact}

> 科技前沿日报 · {date_display} · {subtitle}

## Part 1 — arXiv 论文精选

{arxiv_body}

## Part 2 — GitHub 项目挖掘

{github_body}

## Part 3 — 官方动态跟踪

{official_body}

## Part 4 — 独立博客订阅

{blog_body}
{conf_section}
{wx_section}
---
"""
