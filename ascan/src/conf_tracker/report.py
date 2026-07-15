"""Conference paper HTML + MD report generation — arXiv card style."""
from __future__ import annotations

from typing import Optional

from src.conf_tracker.models import ConferencePaper, ConferenceAnalysis

RECOMMENDATION_ORDER = {
    "极度推荐": 5, "很推荐": 4, "推荐": 3, "一般推荐": 2, "不推荐": 1,
}


def _escape_html(text: str) -> str:
    return (text.replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def _sort_papers(papers: list[ConferencePaper],
                 analyses: dict[str, Optional[ConferenceAnalysis]]) -> list[ConferencePaper]:
    """Sort papers by recommendation level (descending)."""
    def sort_key(p: ConferencePaper) -> int:
        a = analyses.get(p.paper_key)
        if a:
            return RECOMMENDATION_ORDER.get(a.relevance, 0)
        return 0
    return sorted(papers, key=sort_key, reverse=True)


def conf_papers_to_html(papers: list[ConferencePaper],
                        analyses: dict[str, Optional[ConferenceAnalysis]],
                        date_compact: str) -> str:
    """Generate HTML fragment for conference papers in arXiv card style."""
    if not papers:
        return '<p class="empty-state">近期无新会议论文。</p>'

    sorted_papers = _sort_papers(papers, analyses)

    a_count = sum(1 for p in papers if p.rank == "A")
    b_count = sum(1 for p in papers if p.rank == "B")

    parts = [
        f'<div class="conf-stats">'
        f'<span class="stat-chip">共 {len(papers)} 篇论文</span>'
        f'<span class="stat-chip stat-a">A 类 {a_count} 篇</span>'
        f'<span class="stat-chip stat-b">B 类 {b_count} 篇</span>'
        f'</div>',
        f'<div class="report-list conf-list" data-date="{date_compact}">',
    ]

    for idx, paper in enumerate(sorted_papers, 1):
        analysis = analyses.get(paper.paper_key)
        one_liner = analysis.one_liner if analysis else ""
        summary_cn = analysis.summary_cn if analysis else ""
        keywords = analysis.keywords if analysis and analysis.keywords else []
        core_rec = analysis.core_recommendation if analysis else ""
        relevance = analysis.relevance if analysis else ""

        authors_str = ", ".join(paper.authors[:5])
        if len(paper.authors) > 5:
            authors_str += f" 等 ({len(paper.authors)} 人)"

        # Venue + rank + type badges
        badges = [f'<span class="tag tag-venue">{_escape_html(paper.venue)} {paper.year or ""}</span>']
        if paper.rank == "A":
            badges.append('<span class="tag tag-rank-a">CCF-A</span>')
        else:
            badges.append('<span class="tag tag-rank-b">CCF-B</span>')
        if paper.paper_type:
            badges.append(f'<span class="tag tag-type">{_escape_html(paper.paper_type)}</span>')
        if relevance and relevance != "不推荐":
            badges.append(f'<span class="tag tag-relevance">{_escape_html(relevance)}</span>')

        # Keyword tags
        kw_tags = ""
        if keywords:
            kw_tags = '<div class="tags">' + "".join(
                f'<span class="tag">{_escape_html(kw)}</span>' for kw in keywords[:5]
            ) + '</div>'

        # Links
        links = []
        if paper.url:
            links.append(f'<a href="{_escape_html(paper.url)}" target="_blank" rel="noopener noreferrer">Abstract</a>')
        if paper.pdf_url:
            links.append(f'<a href="{_escape_html(paper.pdf_url)}" target="_blank" rel="noopener noreferrer">PDF</a>')
        links_html = " · ".join(links) if links else ""

        # Summary block (Chinese abstract)
        if summary_cn:
            summary_block = (
                '<section class="summary-block">'
                '<h4>中文摘要</h4>'
                f'<p>{_escape_html(summary_cn)}</p>'
                '</section>'
            )
        else:
            summary_block = (
                '<section class="summary-block">'
                '<h4>中文摘要</h4>'
                '<p class="muted">中文摘要生成中...</p>'
                '</section>'
            )

        # Core recommendation
        rec_html = ""
        if core_rec:
            rec_html = f'<p class="recommendation"><strong>核心推荐：</strong>{_escape_html(core_rec)}</p>'

        parts.append(
            f'<article class="card paper-card">'
            f'<h3>{idx}. {_escape_html(paper.title)}</h3>'
            f'<p class="meta"><strong>作者：</strong>{_escape_html(authors_str)}</p>'
            f'<div class="tags">{"".join(badges)}</div>'
            f'{kw_tags}'
            f'<p><strong>一句话总结：</strong>{_escape_html(one_liner)}</p>'
            f'{"<p class=\"links\">" + links_html + "</p>" if links_html else ""}'
            f'{summary_block}'
            f'{rec_html}'
            f'</article>'
        )

    parts.append('</div>')
    return "\n".join(parts)


def conf_papers_to_md(papers: list[ConferencePaper],
                      analyses: dict[str, Optional[ConferenceAnalysis]],
                      date_compact: str) -> str:
    """Generate Markdown fragment for conference papers in arXiv card style."""
    if not papers:
        return "_近期无新会议论文。_"

    sorted_papers = _sort_papers(papers, analyses)

    a_count = sum(1 for p in papers if p.rank == "A")
    b_count = sum(1 for p in papers if p.rank == "B")

    lines = [f"> 共 {len(papers)} 篇 | A 类 {a_count} 篇 | B 类 {b_count} 篇", ""]

    for idx, paper in enumerate(sorted_papers, 1):
        analysis = analyses.get(paper.paper_key)
        one_liner = analysis.one_liner if analysis else ""
        summary_cn = analysis.summary_cn if analysis else ""
        keywords = analysis.keywords if analysis and analysis.keywords else []
        core_rec = analysis.core_recommendation if analysis else ""

        authors_str = ", ".join(paper.authors[:5])
        if len(paper.authors) > 5:
            authors_str += f" 等 ({len(paper.authors)} 人)"

        lines.append(f"### {idx}. {paper.title}")
        lines.append("")
        lines.append(f"**作者：** {authors_str}")
        lines.append(f"**会议：** {paper.venue} {paper.year or ''} ({paper.rank}类)" +
                     (f" · {paper.paper_type}" if paper.paper_type else ""))
        if keywords:
            kw_str = " ".join(f"`{kw}`" for kw in keywords[:5])
            lines.append(f"**关键词：** {kw_str}")
        if one_liner:
            lines.append(f"**一句话总结：** {one_liner}")

        links = []
        if paper.url:
            links.append(f"[Abstract]({paper.url})")
        if paper.pdf_url:
            links.append(f"[PDF]({paper.pdf_url})")
        if links:
            lines.append(f"**链接：** {' · '.join(links)}")

        lines.append("")
        if summary_cn:
            lines.append(f"> {summary_cn}")
        else:
            lines.append("> _中文摘要生成中..._")

        if core_rec:
            lines.append(f"> **核心推荐：** {core_rec}")

        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)
