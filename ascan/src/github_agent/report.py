"""GitHub repo report renderer.

Render daily GitHub findings as HTML fragments for the unified daily report.
"""
from __future__ import annotations

from typing import Optional

from src.github_agent.models import RepoAnalysis, RepoInfo
from src.utils.html import escape_html as _escape_html


_RELEVANCE_ORDER = {"高度相关": 0, "相关": 1, "一般": 2, "较低": 3}


def _stars_badge(stars: int) -> str:
    if stars >= 10000:
        return f"⭐{stars // 1000}k"
    if stars >= 1000:
        return f"⭐{stars / 1000:.1f}k"
    return f"⭐{stars}"


def _today_badge(stars_today: Optional[int]) -> str:
    if stars_today is None:
        return ""
    return f" (+{stars_today} 今日)"


def _repo_link(repo: RepoInfo) -> str:
    return (
        f'<a href="{_escape_html(repo.url)}" target="_blank" rel="noopener noreferrer">'
        f'{_escape_html(repo.full_name)}</a>'
    )


def repos_to_daily_html(
    repos: list[RepoInfo],
    analyses: dict[str, Optional[RepoAnalysis]],
    report_date: str,
) -> str:
    """Build a daily GitHub HTML fragment."""
    if not repos:
        return '<p class="empty-state">今日无 GitHub 项目数据。</p>'

    repo_map = {repo.full_name: repo for repo in repos}
    high_relevance_repos = [
        (full_name, analysis)
        for full_name, analysis in analyses.items()
        if analysis is not None and analysis.relevance == "高度相关"
    ]
    high_relevance_repos.sort(
        key=lambda item: -repo_map.get(
            item[0],
            RepoInfo(full_name=item[0], owner="", name="", url=""),
        ).stars
    )
    table_rows = high_relevance_repos[:15]

    sections: list[str] = [f'<div class="report-list github-list" data-date="{_escape_html(report_date)}">']
    sections.append(
        '<p class="section-note">聚焦大模型与智能体相关项目（大模型算法/Agent算法/智能体架构/智能体记忆/大模型前沿）'
        f'，共发现 {_escape_html(len(repos))} 个仓库。</p>'
    )

    sections.append(f'<h3>今日精选（高度相关，共 {len(table_rows)} 个）</h3>')
    if table_rows:
        sections.append('<div class="table-wrapper"><table>')
        sections.append('<thead><tr><th>项目</th><th>语言</th><th>Stars</th><th>一句话描述</th></tr></thead>')
        sections.append('<tbody>')
        for full_name, analysis in table_rows:
            repo = repo_map.get(full_name)
            if not repo:
                continue
            sections.append(
                '<tr>'
                f'<td>{_repo_link(repo)}</td>'
                f'<td>{_escape_html(repo.language or "—")}</td>'
                f'<td>{_escape_html(_stars_badge(repo.stars))}</td>'
                f'<td>{_escape_html(analysis.one_liner)}</td>'
                '</tr>'
            )
        sections.append('</tbody></table></div>')
    else:
        sections.append('<p class="empty-state">今日暂无高度相关仓库。</p>')

    analyzed = [(full_name, analysis) for full_name, analysis in analyses.items() if analysis is not None]
    if analyzed:
        sections.append('<h3>精选项目深度解析</h3>')
        analyzed.sort(key=lambda item: (
            _RELEVANCE_ORDER.get(item[1].relevance, 9),
            -repo_map.get(item[0], RepoInfo(full_name=item[0], owner="", name="", url="")).stars,
        ))
        for full_name, analysis in analyzed:
            repo = repo_map.get(full_name)
            if not repo:
                continue
            topic_tags = "".join(
                f'<span class="tag">{_escape_html(topic)}</span>'
                for topic in repo.topics[:6]
            )
            sections.append('<article class="card repo-card">')
            sections.append(f'<h4>{_repo_link(repo)}</h4>')
            sections.append(f'<p class="lead">{_escape_html(analysis.one_liner)}</p>')
            sections.append('<ul class="meta-list">')
            sections.append(f'<li><strong>相关性：</strong>{_escape_html(analysis.relevance)}</li>')
            sections.append(f'<li><strong>Stars：</strong>{_escape_html(_stars_badge(repo.stars) + _today_badge(repo.stars_today))}</li>')
            sections.append(f'<li><strong>语言：</strong>{_escape_html(repo.language or "—")}</li>')
            sections.append('</ul>')
            if topic_tags:
                sections.append(f'<div class="tags">{topic_tags}</div>')
            sections.append(f'<p><strong>定位：</strong>{_escape_html(analysis.positioning)}</p>')
            sections.append(f'<p><strong>核心技术：</strong>{_escape_html(analysis.core_tech)}</p>')
            sections.append(f'<p><strong>使用场景：</strong>{_escape_html(analysis.use_cases)}</p>')
            sections.append(f'<p><strong>对比同类：</strong>{_escape_html(analysis.comparison)}</p>')
            sections.append(f'<p><strong>值得关注：</strong>{_escape_html(analysis.watch_reason)}</p>')
            sections.append('</article>')

    # ── All repos list ───────────────────────────────────────────────
    all_analyzed_names = set(analyses.keys())
    unanalyzed = [r for r in repos if r.full_name not in all_analyzed_names]
    if unanalyzed:
        sections.append('<h3>其他仓库</h3>')
        sections.append('<ul class="repo-link-list">')
        for repo in unanalyzed:
            sections.append(
                f'<li>{_repo_link(repo)} '
                f'<span class="repo-meta">⭐{_stars_badge(repo.stars)}</span> '
                f'<span class="repo-lang">{_escape_html(repo.language or "")}</span></li>'
            )
        sections.append('</ul>')

    sections.append('</div>')
    return "\n".join(sections)



def repos_to_weekly_markdown(
    repos_by_day: dict[str, list[RepoInfo]],
    analyses: dict[str, Optional[RepoAnalysis]],
    week_end_date: str,
) -> str:
    """Legacy weekly entry. Weekly report output is currently not scheduled."""
    all_repos = [repo for repos in repos_by_day.values() for repo in repos]
    return repos_to_daily_html(all_repos, analyses, week_end_date)
