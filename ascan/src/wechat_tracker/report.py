"""WeChat article HTML + MD report — arXiv card style."""
from __future__ import annotations

from typing import Optional

from src.wechat_tracker.models import WeChatArticle, WeChatAnalysis

RECOMMENDATION_ORDER = {
    "极度推荐": 5, "很推荐": 4, "推荐": 3, "一般推荐": 2, "不推荐": 1,
}


def _escape_html(text: str) -> str:
    return (text.replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def _sort_articles(articles: list[WeChatArticle],
                   analyses: dict[str, Optional[WeChatAnalysis]]) -> list[WeChatArticle]:
    def sort_key(a: WeChatArticle) -> int:
        an = analyses.get(a.article_id)
        if an:
            return RECOMMENDATION_ORDER.get(an.relevance, 0)
        return 0
    return sorted(articles, key=sort_key, reverse=True)


def wechat_articles_to_html(articles: list[WeChatArticle],
                            analyses: dict[str, Optional[WeChatAnalysis]],
                            date_compact: str) -> str:
    if not articles:
        return '<p class="empty-state">今日无微信公众号更新。</p>'

    sorted_articles = _sort_articles(articles, analyses)

    parts = [
        f'<div class="report-list wechat-list" data-date="{date_compact}">',
    ]

    for idx, article in enumerate(sorted_articles, 1):
        analysis = analyses.get(article.article_id)
        one_liner = analysis.one_liner if analysis else ""
        summary_cn = analysis.summary_cn if analysis else ""
        keywords = analysis.keywords if analysis and analysis.keywords else []
        core_rec = analysis.core_recommendation if analysis else ""
        relevance = analysis.relevance if analysis else ""

        badges = [
            f'<span class="tag tag-venue">{_escape_html(article.mp_name)}</span>',
        ]
        if relevance and relevance != "不推荐":
            badges.append(f'<span class="tag tag-relevance">{_escape_html(relevance)}</span>')

        kw_tags = ""
        if keywords:
            kw_tags = '<div class="tags">' + "".join(
                f'<span class="tag">{_escape_html(kw)}</span>' for kw in keywords[:5]
            ) + '</div>'

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

        rec_html = ""
        if core_rec:
            rec_html = f'<p class="recommendation"><strong>核心推荐：</strong>{_escape_html(core_rec)}</p>'

        meta = []
        if article.author:
            meta.append(f"作者：{_escape_html(article.author)}")
        if article.publish_time:
            meta.append(f"发布：{_escape_html(article.publish_time[:16])}")

        parts.append(
            f'<article class="card paper-card">'
            f'<h3>{idx}. {_escape_html(article.title)}</h3>'
            f'<p class="meta"><strong>{" · ".join(meta) if meta else "来源"}</strong></p>'
            f'<div class="tags">{"".join(badges)}</div>'
            f'{kw_tags}'
            f'<p><strong>一句话总结：</strong>{_escape_html(one_liner)}</p>'
            f'<p class="links"><a href="{_escape_html(article.url)}" target="_blank" rel="noopener noreferrer">阅读原文</a></p>'
            f'{summary_block}'
            f'{rec_html}'
            f'</article>'
        )

    parts.append('</div>')
    return "\n".join(parts)


def wechat_articles_to_md(articles: list[WeChatArticle],
                          analyses: dict[str, Optional[WeChatAnalysis]],
                          date_compact: str) -> str:
    if not articles:
        return "_今日无微信公众号更新。_"

    sorted_articles = _sort_articles(articles, analyses)

    lines = [f"> 共 {len(articles)} 篇新文章", ""]

    for idx, article in enumerate(sorted_articles, 1):
        analysis = analyses.get(article.article_id)
        one_liner = analysis.one_liner if analysis else ""
        summary_cn = analysis.summary_cn if analysis else ""
        keywords = analysis.keywords if analysis and analysis.keywords else []
        core_rec = analysis.core_recommendation if analysis else ""

        meta = []
        if article.author:
            meta.append(f"作者：{article.author}")
        if article.publish_time:
            meta.append(f"发布：{article.publish_time[:16]}")

        lines.append(f"### {idx}. {article.title}")
        lines.append("")
        lines.append(f"**{' · '.join(meta) if meta else '来源'}**")
        lines.append(f"**公众号：** {article.mp_name}")
        if keywords:
            kw_str = " ".join(f"`{kw}`" for kw in keywords[:5])
            lines.append(f"**关键词：** {kw_str}")
        if one_liner:
            lines.append(f"**一句话总结：** {one_liner}")
        lines.append(f"**链接：** [阅读原文]({article.url})")
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
