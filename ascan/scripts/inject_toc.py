"""
Re-inject TOC outline navigation into existing Ascan HTML reports.
- Removes old hero header sections
- Removes old TOC (if present) and re-injects with fixed CSS and number-only labels
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from src.tools.unified_report import _REPORT_CSS, _REPORT_JS

_toc_css_start = _REPORT_CSS.index("/* ── TOC Outline Card")
TOC_CSS = _REPORT_CSS[_toc_css_start:]
TOC_JS = _REPORT_JS

SECTION_META = {
    "arxiv-papers": ("1", "arXiv 论文精选"),
    "github-repos": ("2", "GitHub 项目挖掘"),
    "official-tracker": ("3", "官方动态跟踪"),
    "blog-subs": ("4", "独立博客订阅"),
    "conference-papers": ("5", "会议论文追踪"),
    "wechat-articles": ("6", "微信公众号"),
}

SECTION_RE = re.compile(
    r'<section\s+class="report-section"\s+id="([^"]+)">.*?</section>',
    re.DOTALL,
)
HERO_RE = re.compile(r'\s*<header\s+class="hero">.*?</header>\s*', re.DOTALL)
OLD_TOC_CSS_RE = re.compile(r'/\* ── TOC Outline Card.*?(?=</style>)', re.DOTALL)
OLD_TOC_CARD_RE = re.compile(r'\s*<nav\s+class="toc-card".*?</nav>\s*', re.DOTALL)
OLD_TOC_FLOATING_RE = re.compile(r'\s*<div\s+class="toc-floating">.*?</div>\s*', re.DOTALL)
OLD_TOC_JS_RE = re.compile(r'\s*<script>.*?</script>\s*', re.DOTALL)


def inject_toc(html):
    # 1. Remove hero header
    html = HERO_RE.sub('\n    ', html)

    # 2. Remove old TOC CSS
    html = OLD_TOC_CSS_RE.sub('', html)

    # 3. Remove old TOC card
    html = OLD_TOC_CARD_RE.sub('', html)

    # 4. Remove old floating nav
    html = OLD_TOC_FLOATING_RE.sub('', html)

    # 5. Remove old JS
    html = OLD_TOC_JS_RE.sub('', html)

    # 6. Find sections and check content
    sections = []
    for m in SECTION_RE.finditer(html):
        sid = m.group(1)
        if sid not in SECTION_META:
            continue
        body = m.group(0)
        has_content = "empty-state" not in body
        sections.append((sid, SECTION_META[sid][0], SECTION_META[sid][1], has_content))

    if not sections:
        return html

    # 7. Build new TOC card
    toc_entries = "\n".join(
        '      <a href="#%s" class="toc-entry" data-target="%s">'
        '<span class="toc-entry-num">%s</span>'
        '<span class="toc-entry-text">%s</span>'
        '<span class="toc-entry-count">%s</span>'
        '</a>' % (sid, sid, num, label, "\u6709\u5185\u5bb9" if has else "\u65e0")
        for sid, num, label, has in sections
    )
    toc_card = """
    <nav class="toc-card" id="toc-card">
      <div class="toc-card-header">
        <span class="toc-card-title">\u5927\u7eb2</span>
        <span class="toc-card-toggle">\u25bc</span>
      </div>
      <div class="toc-list">
%s
      </div>
    </nav>
    """ % toc_entries

    toc_dots = "\n".join(
        '  <span class="toc-dot" data-target="%s"><span class="toc-floating-label">%s \u00b7 %s</span></span>'
        % (sid, num, label)
        for sid, num, label, _ in sections
    )
    toc_floating = """
  <div class="toc-floating">
%s
  </div>
    """ % toc_dots

    # 8. Inject TOC CSS before </style>
    html = html.replace("</style>", TOC_CSS + "\n</style>", 1)

    # 9. Inject floating nav after <body>
    html = html.replace("<body>", "<body>\n  " + toc_floating.strip(), 1)

    # 10. Inject TOC card after <main class="page">
    html = html.replace('<main class="page">', '<main class="page">\n    ' + toc_card.strip(), 1)

    # 11. Inject JS before </body>
    html = html.replace("</body>", "\n  " + TOC_JS + "\n</body>", 1)

    return html


def main():
    docs_dir = Path(__file__).parent.parent / "docs"
    html_files = sorted(docs_dir.glob("Ascan-*.html"))
    updated = 0

    for f in html_files:
        html = f.read_text(encoding="utf-8")
        new_html = inject_toc(html)
        if new_html != html:
            f.write_text(new_html, encoding="utf-8")
            updated += 1
            print("  + %s" % f.name)

    print("\nDone: %d updated, %d total" % (updated, len(html_files)))


if __name__ == "__main__":
    main()
