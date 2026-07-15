"""HTML and Markdown report renderers for blog subscriptions."""
from __future__ import annotations

import re
from typing import List, Optional


_HTML_TAG_RE = re.compile(r"<[^>]*>")


def _clean_summary(text: str, max_len: int = 120) -> str:
    """Strip HTML tags and truncate to a readable one-liner."""
    text = _HTML_TAG_RE.sub("", text or "")
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > max_len:
        text = text[:max_len].rsplit(" ", 1)[0] + "..."
    return text


def blogs_to_daily_html(posts: list, analyses: dict, report_date: str) -> str:
    """Generate HTML fragment with LLM analysis or cleaned RSS summaries."""
    lines: list[str] = []
    lines.append(f'<p class="meta-note">共 {len(posts)} 篇新文章（30 天内）。</p>')

    source_posts: dict[str, list] = {}
    for post in posts:
        source_posts.setdefault(post.source_label, []).append(post)

    for source_label, src_posts in source_posts.items():
        lines.append(f'<h3 class="source-heading">{source_label}</h3>')
        lines.append('<ul class="blog-list">')
        for post in src_posts:
            analysis = analyses.get(post.slug)
            title_display = (post.title or post.slug)[:80]
            date_str = post.date or ""

            if analysis:
                summary = analysis.one_liner or analysis.summary_cn[:80]
                lines.append(
                    f'<li><a href="{post.url}" target="_blank">{title_display}</a> '
                    f'<span class="blog-date">({date_str})</span>'
                    f'<br><span class="blog-summary">{summary}</span></li>'
                )
            else:
                summary = _clean_summary(post.summary or "")
                if summary:
                    lines.append(
                        f'<li><a href="{post.url}" target="_blank">{title_display}</a> '
                        f'<span class="blog-date">({date_str})</span>'
                        f'<br><span class="blog-summary">{summary}</span></li>'
                    )
                else:
                    lines.append(
                        f'<li><a href="{post.url}" target="_blank">{title_display}</a> '
                        f'<span class="blog-date">({date_str})</span></li>'
                    )
        lines.append('</ul>')

    return "\n".join(lines)


def blogs_to_daily_md(posts: list, analyses: dict, report_date: str) -> str:
    """Generate Markdown fragment with LLM analysis or cleaned RSS summaries."""
    lines: list[str] = []
    lines.append(f"共 {len(posts)} 篇新文章（30 天内）。")
    lines.append("")

    source_posts: dict[str, list] = {}
    for post in posts:
        source_posts.setdefault(post.source_label, []).append(post)

    for source_label, src_posts in source_posts.items():
        lines.append(f"### {source_label}")
        lines.append("")
        for post in src_posts:
            analysis = analyses.get(post.slug)
            date_str = post.date or ""
            title_display = (post.title or post.slug)[:80]

            if analysis:
                summary = analysis.one_liner or analysis.summary_cn[:80]
                lines.append(f"- [{title_display}]({post.url}) ({date_str})")
                lines.append(f"  > {summary}")
            else:
                summary = _clean_summary(post.summary or "")
                if summary:
                    lines.append(f"- [{title_display}]({post.url}) ({date_str})")
                    lines.append(f"  > {summary}")
                else:
                    lines.append(f"- [{title_display}]({post.url}) ({date_str})")
        lines.append("")

    return "\n".join(lines)
