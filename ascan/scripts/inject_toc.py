"""
Retroactively inject TOC outline navigation into existing Ascan HTML reports.
Scans docs/*.html, finds reports without TOC, and injects:
  1. TOC CSS (appended to <style>)
  2. Floating side navigator (after <body>)
  3. TOC outline card (after </header>)
  4. Scroll-spy JS (before </body>)
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from src.tools.unified_report import _REPORT_CSS, _REPORT_JS

# Extract only the TOC-specific CSS (from "/* ── TOC Outline Card" to end)
_toc_css_start = _REPORT_CSS.index("/* ── TOC Outline Card")
TOC_CSS = _REPORT_CSS[_toc_css_start:]
TOC_JS = _REPORT_JS

# Section metadata: id → (part number, label)
SECTION_META = {
    "arxiv-papers": ("Part 1", "arXiv 论文精选"),
    "github-repos": ("Part 2", "GitHub 项目挖掘"),
    "official-tracker": ("Part 3", "官方动态跟踪"),
    "blog-subs": ("Part 4", "独立博客订阅"),
    "conference-papers": ("Part 5", "会议论文追踪"),
    "wechat-articles": ("Part 6", "微信公众号"),
}

SECTION_RE = re.compile(
    r'<section\s+class="report-section"\s+id="([^"]+)">.*?</section>',
    re.DOTALL,
)


def inject_toc(html: str) -> str:
    """Inject TOC into a single HTML report if it doesn't already have one."""
    if "toc-card" in html:
        return html  # already has TOC

    # Find all sections and check content
    sections = []
    for m in SECTION_RE.finditer(html):
        sid = m.group(1)
        if sid not in SECTION_META:
            continue
        body = m.group(0)
        has_content = "empty-state" not in body
        sections.append((sid, *SECTION_META[sid], has_content))

    if not sections:
        return html  # no sections found, skip

    # Build TOC card HTML
    toc_entries = "\n".join(
        f'      <a href="#{sid}" class="toc-entry" data-target="{sid}">'
        f'<span class="toc-entry-num">{num}</span>'
        f'<span class="toc-entry-text">{label}</span>'
        f'<span class="toc-entry-count">{"有内容" if has else "无"}</span>'
        f'</a>'
        for sid, num, label, has in sections
    )
    toc_card = f"""
    <nav class="toc-card" id="toc-card">
      <div class="toc-card-header">
        <span class="toc-card-title">📑 大纲</span>
        <span class="toc-card-toggle">▼</span>
      </div>
      <div class="toc-list">
{toc_entries}
      </div>
    </nav>
    """

    # Build floating dots HTML
    toc_dots = "\n".join(
        f'  <span class="toc-dot" data-target="{sid}"><span class="toc-floating-label">{num} · {label}</span></span>'
        for sid, num, label, _ in sections
    )
    toc_floating = f"""
  <div class="toc-floating">
{toc_dots}
  </div>
    """

    # 1. Inject TOC CSS before </style>
    html = html.replace("</style>", TOC_CSS + "\n</style>", 1)

    # 2. Inject floating nav after <body>
    html = html.replace("<body>", "<body>\n  " + toc_floating.strip(), 1)

    # 3. Inject TOC card after </header>
    html = html.replace("</header>", "</header>\n\n    " + toc_card.strip(), 1)

    # 4. Inject JS before </body>
    html = html.replace("</body>", "\n  " + TOC_JS + "\n</body>", 1)

    return html


def main():
    docs_dir = Path(__file__).parent.parent / "docs"
    html_files = sorted(docs_dir.glob("Ascan-*.html"))
    updated = 0
    skipped = 0

    for f in html_files:
        html = f.read_text(encoding="utf-8")
        if "toc-card" in html:
            skipped += 1
            continue
        new_html = inject_toc(html)
        if new_html != html:
            f.write_text(new_html, encoding="utf-8")
            updated += 1
            print(f"  ✓ {f.name}")
        else:
            skipped += 1
            print(f"  - {f.name} (no sections found)")

    print(f"\nDone: {updated} updated, {skipped} skipped, {len(html_files)} total")


if __name__ == "__main__":
    main()
