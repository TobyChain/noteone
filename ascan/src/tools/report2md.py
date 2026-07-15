"""arXiv report renderer.

Render selected arXiv papers as HTML fragments for the unified daily report.
"""

from __future__ import annotations

from typing import Any, Dict, List

from src.utils.html import escape_html as _escape_html


def _safe_join(items: List[str]) -> str:
    return ", ".join([str(item) for item in items if item])


def _link(url: str, label: str) -> str:
    if not url:
        return ""
    escaped_url = _escape_html(url)
    escaped_label = _escape_html(label)
    return f'<a href="{escaped_url}" target="_blank" rel="noopener noreferrer">{escaped_label}</a>'


def papers_to_html(date_str: str, papers: List[Dict[str, Any]]) -> str:
    """Build an HTML fragment for selected arXiv papers."""
    if not papers:
        return '<p class="empty-state">今日无 arXiv 精选论文。</p>'

    sections: List[str] = [f'<div class="report-list arxiv-list" data-date="{_escape_html(date_str)}">']

    for index, paper in enumerate(papers, start=1):
        title = (paper.get("title") or "").strip()
        authors = paper.get("authors") or []
        abs_url = paper.get("abs_url") or ""
        pdf_url = paper.get("pdf_url") or ""
        keywords = paper.get("keywords") or []
        one_liner = (paper.get("one_liner") or "").strip()
        core_recommendation = (paper.get("core_recommendation") or "").strip()
        translated_abstract = (paper.get("trans_abs") or "").strip()

        keyword_tags = "".join(
            f'<span class="tag">{_escape_html(keyword)}</span>'
            for keyword in keywords
            if keyword
        )
        links = " · ".join(
            link for link in [
                _link(abs_url, "Abstract"),
                _link(pdf_url, "PDF"),
            ]
            if link
        )

        sections.append('<article class="card paper-card">')
        sections.append(f'<h3>{index}. {_escape_html(title)}</h3>')
        if authors:
            sections.append(f'<p class="meta"><strong>作者：</strong>{_escape_html(_safe_join(authors))}</p>')
        if keyword_tags:
            sections.append(f'<div class="tags">{keyword_tags}</div>')
        if one_liner:
            sections.append(f'<p><strong>一句话总结：</strong>{_escape_html(one_liner)}</p>')
        if links:
            sections.append(f'<p class="links">{links}</p>')

        sections.append('<section class="summary-block">')
        sections.append('<h4>中文摘要</h4>')
        if translated_abstract:
            sections.append(f'<p>{_escape_html(translated_abstract)}</p>')
        else:
            sections.append('<p class="muted">中文摘要生成中...</p>')
        sections.append('</section>')

        if core_recommendation:
            sections.append(
                '<p class="recommendation"><strong>核心推荐：</strong>'
                f'{_escape_html(core_recommendation)}</p>'
            )
        sections.append('</article>')

    sections.append('</div>')
    return "\n".join(sections)


