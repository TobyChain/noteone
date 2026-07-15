"""Unified HTML daily report renderer."""
from __future__ import annotations

from typing import Optional


_REPORT_CSS = """
/* ── Notion-inspired Design System for Ascan Daily Report ── */
:root {
  color-scheme: light;
  /* Surface & Canvas */
  --canvas: #ffffff;
  --surface: #f7f7f5;
  --surface-soft: #f1f1ef;
  /* Borders */
  --hairline: #e8e7e4;
  --hairline-soft: #eeeeed;
  --hairline-strong: #d3d1cb;
  /* Text */
  --ink-deep: #0f0f0f;
  --ink: #191919;
  --charcoal: #37352f;
  --slate: #6b6b6b;
  --steel: #9b9a97;
  --stone: #b4b3af;
  --muted: #c4c3bf;
  /* Brand Accents */
  --primary: #6c47ff;
  --primary-pressed: #5a3ad6;
  --link-blue: #2383e2;
  /* Semantic Tints */
  --tint-lavender: #e8deee;
  --tint-peach: #faebdd;
  --tint-mint: #dbeddb;
  --tint-sky: #d3e5ef;
  --tint-yellow: #fdecc8;
  --brand-purple-800: #4a2d8a;
  --brand-orange-deep: #b05c1a;
  --brand-green: #2d7d46;
  /* Elevation */
  --shadow-subtle: rgba(15, 15, 15, 0.04) 0px 1px 2px 0px;
  --shadow-card: rgba(15, 15, 15, 0.06) 0px 3px 8px 0px;
  /* Spacing base unit: 4px */
  --sp-xs: 4px;
  --sp-sm: 8px;
  --sp-md: 12px;
  --sp-lg: 16px;
  --sp-xl: 24px;
  --sp-xxl: 32px;
  --sp-section: 48px;
  /* Radius */
  --r-sm: 6px;
  --r-md: 8px;
  --r-lg: 12px;
  --r-full: 9999px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--canvas);
  color: var(--charcoal);
  font-family: Inter, -apple-system, system-ui, "Segoe UI", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
  font-size: 16px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--link-blue); text-decoration: none; transition: color 0.15s ease; }
a:hover { text-decoration: underline; color: #1a6dc2; }

/* ── Page Container ── */
.page {
  max-width: 900px;
  margin: 0 auto;
  padding: var(--sp-xxl) var(--sp-xl) var(--sp-section);
}

/* ── Hero / Header ── */
.hero {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  padding: var(--sp-xxl) var(--sp-xl);
  margin-bottom: var(--sp-section);
}
.hero h1 {
  font-size: 36px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.5px;
  color: var(--ink-deep);
  margin-bottom: var(--sp-sm);
}
.hero p {
  font-size: 16px;
  color: var(--slate);
  line-height: 1.55;
}

/* ── Section Headings ── */
.report-section { margin-top: var(--sp-section); }
.report-section > h2 {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: 0;
  color: var(--ink-deep);
  margin-bottom: var(--sp-lg);
  padding-bottom: var(--sp-sm);
  border-bottom: 1px solid var(--hairline);
}

/* ── Cards ── */
.card {
  background: var(--canvas);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  padding: var(--sp-xl);
  margin-bottom: var(--sp-lg);
  transition: box-shadow 0.15s ease;
}
.card:hover { box-shadow: var(--shadow-card); }
.card h3 {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink-deep);
  margin-bottom: var(--sp-sm);
}
.card h4 {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink);
  margin-bottom: var(--sp-xs);
}

/* ── Meta & Muted Text ── */
.meta {
  font-size: 14px;
  color: var(--slate);
  line-height: 1.5;
  margin-bottom: var(--sp-sm);
}
.muted, .section-note, .empty-state {
  font-size: 14px;
  color: var(--steel);
  line-height: 1.5;
}
.empty-state {
  padding: var(--sp-xl);
  text-align: center;
  background: var(--surface);
  border-radius: var(--r-md);
}

/* ── Lead (one-liner emphasis) ── */
.lead {
  font-size: 16px;
  font-weight: 500;
  color: var(--ink);
  line-height: 1.55;
  margin-bottom: var(--sp-sm);
}

/* ── Tags ── */
.tags { display: flex; flex-wrap: wrap; gap: var(--sp-sm); margin: var(--sp-sm) 0; }
.tag {
  display: inline-flex;
  align-items: center;
  border-radius: var(--r-sm);
  background: var(--tint-lavender);
  color: var(--brand-purple-800);
  padding: 2px 8px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
}

/* ── Recommendation Callout ── */
.recommendation {
  border-left: 3px solid var(--primary);
  background: var(--surface);
  padding: var(--sp-md) var(--sp-lg);
  border-radius: var(--r-md);
  margin-top: var(--sp-md);
  font-size: 14px;
  line-height: 1.55;
  color: var(--charcoal);
}

/* ── Summary Block ── */
.summary-block {
  margin-top: var(--sp-md);
  padding-top: var(--sp-md);
  border-top: 1px solid var(--hairline-soft);
}
.summary-block h4 {
  font-size: 14px;
  font-weight: 600;
  color: var(--slate);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: var(--sp-xs);
}
.summary-block p {
  font-size: 15px;
  line-height: 1.6;
  color: var(--charcoal);
}

/* ── Links Row ── */
.links {
  font-size: 14px;
  font-weight: 500;
  margin: var(--sp-sm) 0;
}
.links a { margin-right: var(--sp-xs); }

/* ── Tables ── */
.table-wrapper { overflow-x: auto; margin: var(--sp-lg) 0; }
table {
  width: 100%;
  border-collapse: collapse;
  background: var(--canvas);
  border: 1px solid var(--hairline);
  border-radius: var(--r-md);
  overflow: hidden;
  font-size: 14px;
}
th {
  background: var(--surface);
  font-weight: 600;
  color: var(--ink);
  padding: var(--sp-md) var(--sp-lg);
  text-align: left;
  border-bottom: 1px solid var(--hairline);
}
td {
  padding: var(--sp-md) var(--sp-lg);
  border-bottom: 1px solid var(--hairline-soft);
  color: var(--charcoal);
  vertical-align: top;
}
tr:last-child td { border-bottom: none; }

/* ── Meta List (repo details) ── */
.meta-list {
  padding-left: var(--sp-xl);
  margin: var(--sp-sm) 0;
  font-size: 14px;
  color: var(--slate);
  line-height: 1.6;
}
.meta-list li { margin-bottom: var(--sp-xs); }
.meta-list strong { color: var(--charcoal); font-weight: 500; }

/* ── Footer ── */
.footer {
  margin-top: var(--sp-section);
  padding-top: var(--sp-lg);
  border-top: 1px solid var(--hairline);
  color: var(--steel);
  text-align: center;
  font-size: 13px;
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .page { padding: var(--sp-lg) var(--sp-md) var(--sp-xxl); }
  .hero { padding: var(--sp-xl) var(--sp-lg); }
  .hero h1 { font-size: 28px; }
  .report-section > h2 { font-size: 22px; }
  .card { padding: var(--sp-lg); }
  .card h3 { font-size: 18px; }
  th, td { padding: var(--sp-sm) var(--sp-md); }
  .toc-floating { display: none !important; }
}

/* ── TOC Outline Card ── */
.toc-card {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  margin-bottom: var(--sp-section);
  overflow: hidden;
}
.toc-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-md) var(--sp-lg);
  cursor: pointer;
  user-select: none;
  transition: background 0.15s ease;
}
.toc-card-header:hover { background: var(--surface-soft); }
.toc-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: 0.3px;
}
.toc-card-toggle {
  font-size: 13px;
  color: var(--steel);
  transition: transform 0.2s ease;
}
.toc-card.collapsed .toc-card-toggle { transform: rotate(-90deg); }
.toc-list {
  list-style: none;
  padding: 0 var(--sp-lg) var(--sp-md);
  margin: 0;
}
.toc-card.collapsed .toc-list { display: none; }
.toc-entry {
  display: flex;
  align-items: center;
  padding: var(--sp-sm) var(--sp-md);
  border-radius: var(--r-sm);
  font-size: 14px;
  color: var(--charcoal);
  transition: background 0.15s ease, color 0.15s ease;
  text-decoration: none;
}
.toc-entry:hover { background: var(--surface-soft); text-decoration: none; color: var(--ink); }
.toc-entry.active { background: var(--tint-lavender); color: var(--brand-purple-800); font-weight: 500; }
.toc-entry-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--r-full);
  background: var(--canvas);
  border: 1px solid var(--hairline);
  font-size: 12px;
  font-weight: 600;
  color: var(--slate);
  margin-right: var(--sp-sm);
  flex-shrink: 0;
}
.toc-entry.active .toc-entry-num { background: var(--primary); border-color: var(--primary); color: #fff; }
.toc-entry-text { flex: 1; }
.toc-entry-count {
  font-size: 12px;
  color: var(--steel);
  margin-left: var(--sp-sm);
  flex-shrink: 0;
}

/* ── Floating Side Navigator (desktop only) ── */
.toc-floating {
  position: fixed;
  left: calc(50% - 500px);
  top: 50%;
  transform: translateY(-50%);
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: var(--sp-md);
  padding: var(--sp-md);
}
.toc-floating-label {
  position: absolute;
  left: 28px;
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  color: var(--charcoal);
  background: var(--canvas);
  border: 1px solid var(--hairline);
  border-radius: var(--r-sm);
  padding: 4px 10px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
  box-shadow: var(--shadow-subtle);
}
.toc-dot {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: var(--r-full);
  background: var(--muted);
  border: 2px solid transparent;
  transition: all 0.2s ease;
  cursor: pointer;
  position: relative;
}
.toc-dot:hover { background: var(--steel); }
.toc-dot:hover .toc-floating-label { opacity: 1; }
.toc-dot.active { background: var(--primary); border-color: var(--primary); transform: scale(1.3); }
@media (max-width: 1100px) { .toc-floating { display: none; } }
""".strip()

_REPORT_JS = """
<script>
(function() {
  // ── TOC card collapse/expand ──
  var tocHeader = document.querySelector('.toc-card-header');
  var tocCard = document.querySelector('.toc-card');
  if (tocHeader && tocCard) {
    tocHeader.addEventListener('click', function() {
      tocCard.classList.toggle('collapsed');
    });
  }

  // ── Scroll-spy: highlight active section in TOC ──
  var sections = document.querySelectorAll('.report-section[id]');
  var tocEntries = document.querySelectorAll('.toc-entry[data-target]');
  var tocDots = document.querySelectorAll('.toc-dot[data-target]');

  function setActive(id) {
    tocEntries.forEach(function(el) {
      el.classList.toggle('active', el.getAttribute('data-target') === id);
    });
    tocDots.forEach(function(el) {
      el.classList.toggle('active', el.getAttribute('data-target') === id);
    });
  }

  if ('IntersectionObserver' in window && sections.length > 0) {
    setActive(sections[0].id);
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          setActive(entry.target.id);
        }
      });
    }, { rootMargin: '-20% 0px -60% 0px' });
    sections.forEach(function(s) { observer.observe(s); });
  }

  // ── Smooth scroll on TOC click ──
  document.querySelectorAll('a[href^="#"]').forEach(function(link) {
    link.addEventListener('click', function(e) {
      var href = this.getAttribute('href');
      if (href.length > 1) {
        var target = document.getElementById(href.slice(1));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          history.replaceState(null, '', href);
        }
      }
    });
  });

  // ── Floating dot click → scroll to section ──
  tocDots.forEach(function(dot) {
    dot.addEventListener('click', function() {
      var id = this.getAttribute('data-target');
      var target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
})();
</script>
""".strip()


from src.utils.html import escape_html as _escape_html


def build_unified_html(
    date_compact: str,
    arxiv_html: Optional[str],
    github_html: Optional[str],
    official_html: Optional[str] = None,
    blog_html: Optional[str] = None,
    conference_html: Optional[str] = None,
    wechat_html: Optional[str] = None,
) -> str:
    """Combine arXiv, GitHub, official tracker, blog and conference fragments into one standalone HTML daily report."""
    date_display = f"{date_compact[:4]}-{date_compact[4:6]}-{date_compact[6:8]}"
    arxiv_body = arxiv_html.strip() if arxiv_html and arxiv_html.strip() else '<p class="empty-state">今日无 arXiv 数据。</p>'
    github_body = github_html.strip() if github_html and github_html.strip() else '<p class="empty-state">今日无 GitHub 数据。</p>'

    # Build subtitle based on which parts are present
    subtitle_parts = ["arXiv 论文精选", "GitHub 项目挖掘"]
    if official_html and "empty-state" not in (official_html or ""):
        subtitle_parts.append("官方动态跟踪")
    if blog_html and "empty-state" not in (blog_html or ""):
        subtitle_parts.append("独立博客")
    if conference_html and "empty-state" not in (conference_html or ""):
        subtitle_parts.append("会议论文追踪")
    if wechat_html and "empty-state" not in (wechat_html or ""):
        subtitle_parts.append("微信公众号")
    subtitle = " + ".join(subtitle_parts)

    # Part 3: Official tracker
    official_body = official_html.strip() if official_html and official_html.strip() else '<p class="empty-state">今日无 Anthropic Research 或 OpenAI 新文章。</p>'
    official_section = f"""
    <section class="report-section" id="official-tracker">
      <h2>Part 3 — 官方动态跟踪</h2>
      {official_body}
    </section>
    """

    # Part 4: Blog subscriptions
    blog_body = blog_html.strip() if blog_html and blog_html.strip() else '<p class="empty-state">今日无独立博客更新。</p>'
    blog_section = f"""
    <section class="report-section" id="blog-subs">
      <h2>Part 4 — 独立博客订阅</h2>
      {blog_body}
    </section>
    """

    # Part 5: Conference papers
    conf_body = conference_html.strip() if conference_html and conference_html.strip() else ""
    conference_section = ""
    if conf_body:
        conference_section = f"""
    <section class="report-section" id="conference-papers">
      <h2>Part 5 — 会议论文追踪</h2>
      {conf_body}
    </section>
    """

    # Part 6: WeChat articles
    wx_body = wechat_html.strip() if wechat_html and wechat_html.strip() else ""
    wechat_section = ""
    if wx_body:
        wechat_section = f"""
    <section class="report-section" id="wechat-articles">
      <h2>Part 6 — 微信公众号</h2>
      {wx_body}
    </section>
    """

    # ── Build TOC entries ──────────────────────────────────────────────
    toc_sections = []
    # arxiv and github are always present
    toc_sections.append(("arxiv-papers", "Part 1", "arXiv 论文精选", "empty-state" not in arxiv_body))
    toc_sections.append(("github-repos", "Part 2", "GitHub 项目挖掘", "empty-state" not in github_body))
    # official
    has_official = bool(official_html and "empty-state" not in (official_html or ""))
    toc_sections.append(("official-tracker", "Part 3", "官方动态跟踪", has_official))
    # blog
    has_blog = bool(blog_html and "empty-state" not in (blog_html or ""))
    toc_sections.append(("blog-subs", "Part 4", "独立博客订阅", has_blog))
    # conference (conditional)
    if conf_body:
        toc_sections.append(("conference-papers", "Part 5", "会议论文追踪", True))
    # wechat (conditional)
    if wx_body:
        toc_sections.append(("wechat-articles", "Part 6", "微信公众号", True))

    # Build TOC outline card HTML
    toc_entries_html = "\n".join(
        f'      <a href="#{sid}" class="toc-entry" data-target="{sid}">'
        f'<span class="toc-entry-num">{num}</span>'
        f'<span class="toc-entry-text">{label}</span>'
        f'<span class="toc-entry-count">{"有内容" if has else "无"}</span>'
        f'</a>'
        for sid, num, label, has in toc_sections
    )
    toc_card_html = f"""
    <nav class="toc-card" id="toc-card">
      <div class="toc-card-header">
        <span class="toc-card-title">📑 大纲</span>
        <span class="toc-card-toggle">▼</span>
      </div>
      <div class="toc-list">
{toc_entries_html}
      </div>
    </nav>
    """

    # Build floating dots HTML (desktop only)
    toc_dots_html = "\n".join(
        f'  <span class="toc-dot" data-target="{sid}"><span class="toc-floating-label">{num} · {label}</span></span>'
        for sid, num, label, _ in toc_sections
    )
    toc_floating_html = f"""
  <div class="toc-floating">
{toc_dots_html}
  </div>
    """

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ascan-{_escape_html(date_compact)}</title>
  <style>{_REPORT_CSS}</style>
</head>
<body>
  {toc_floating_html}
  <main class="page">
    <header class="hero">
      <h1>Ascan-{_escape_html(date_compact)}</h1>
      <p>科技前沿日报 · {_escape_html(date_display)} · {_escape_html(subtitle)}</p>
    </header>

    {toc_card_html}

    <section class="report-section" id="arxiv-papers">
      <h2>Part 1 — arXiv 论文精选</h2>
      {arxiv_body}
    </section>

    <section class="report-section" id="github-repos">
      <h2>Part 2 — GitHub 项目挖掘</h2>
      {github_body}
    </section>

    {official_section}

    {blog_section}

    {conference_section}

    {wechat_section}

  </main>
  {_REPORT_JS}
</body>
</html>
"""


