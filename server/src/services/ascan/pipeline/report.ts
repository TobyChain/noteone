/**
 * Unified daily report renderers (HTML + Markdown).
 *
 * Faithful TypeScript port of:
 *   - ascan/src/tools/unified_report.py  (build_unified_html)
 *   - ascan/src/tools/report_md.py       (build_unified_md)
 */
import { escapeHtml } from "./util.js";

const REPORT_CSS = `
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
`.trim();

const REPORT_JS = `
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
        var target = document.querySelector(href);
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
`.trim();

export interface ModuleFragments {
  arxiv: string;
  github: string;
  official: string;
  blog: string;
  conference: string;
  wechat: string;
}

const MODULE_LABELS_ZH: Record<string, string> = {
  official: "官方动态跟踪",
  blog: "独立博客订阅",
  github: "GitHub 项目挖掘",
  arxiv: "arXiv 论文精选",
  conference: "会议论文追踪",
  wechat: "微信公众号",
};

const MODULE_LABELS_EN: Record<string, string> = {
  official: "Official Updates",
  blog: "Independent Blogs",
  github: "GitHub Projects",
  arxiv: "arXiv Papers",
  conference: "Conference Papers",
  wechat: "WeChat Articles",
};

const EMPTY_STATE_ZH: Record<string, string> = {
  official: "今日无 Anthropic Research 或 DeepMind 新文章。",
  blog: "今日无独立博客更新。",
  github: "今日无 GitHub 数据。",
  arxiv: "今日无 arXiv 数据。",
  conference: "今日无会议论文数据。",
  wechat: "今日无微信公众号数据。",
};

const EMPTY_STATE_EN: Record<string, string> = {
  official: "No new Anthropic Research or DeepMind articles today.",
  blog: "No independent blog updates today.",
  github: "No GitHub data today.",
  arxiv: "No arXiv data today.",
  conference: "No conference paper data today.",
  wechat: "No WeChat article data today.",
};

/**
 * Combine arXiv, GitHub, official tracker, blog, conference and WeChat
 * fragments into one standalone HTML daily report.
 */
export function buildUnifiedHtml(dateCompact: string, fragments: ModuleFragments, moduleOrder?: string[], language: "zh" | "en" = "zh"): string {
  const DEFAULT_ORDER = ["official", "blog", "github", "arxiv", "conference", "wechat"];
  const order = moduleOrder?.length ? moduleOrder : DEFAULT_ORDER;
  const labels = language === "en" ? MODULE_LABELS_EN : MODULE_LABELS_ZH;
  const emptyStates = language === "en" ? EMPTY_STATE_EN : EMPTY_STATE_ZH;
  const outlineLabel = language === "en" ? "Outline" : "大纲";
  const titlePrefix = language === "en" ? "NewSee" : "新知";

  const sectionConfigs: Record<string, { id: string; label: string; body: string }> = {
    official: {
      id: "official-tracker",
      label: labels.official,
      body: fragments.official?.trim() || `<p class="empty-state">${emptyStates.official}</p>`,
    },
    blog: {
      id: "blog-subs",
      label: labels.blog,
      body: fragments.blog?.trim() || `<p class="empty-state">${emptyStates.blog}</p>`,
    },
    github: {
      id: "github-repos",
      label: labels.github,
      body: fragments.github?.trim() || `<p class="empty-state">${emptyStates.github}</p>`,
    },
    arxiv: {
      id: "arxiv-papers",
      label: labels.arxiv,
      body: fragments.arxiv?.trim() || `<p class="empty-state">${emptyStates.arxiv}</p>`,
    },
    conference: {
      id: "conference-papers",
      label: labels.conference,
      body: (fragments.conference?.trim() && !fragments.conference.includes("empty-state"))
        ? fragments.conference.trim()
        : `<p class="empty-state">${emptyStates.conference}</p>`,
    },
    wechat: {
      id: "wechat-mp",
      label: labels.wechat,
      body: (fragments.wechat?.trim() && !fragments.wechat.includes("empty-state"))
        ? fragments.wechat.trim()
        : `<p class="empty-state">${emptyStates.wechat}</p>`,
    },
  };

  // Build sections in the specified order with dynamic numbering
  const sectionsHtml = order.map((key, i) => {
    const cfg = sectionConfigs[key];
    if (!cfg) return "";
    return `
    <section class="report-section" id="${cfg.id}">
      <h2>${i + 1} — ${cfg.label}</h2>
      ${cfg.body}
    </section>`;
  }).join("\n");

  // Build TOC entries from the same order
  const tocSections: Array<[string, string, string]> = order
    .map((key, i) => {
      const cfg = sectionConfigs[key];
      return cfg ? [cfg.id, String(i + 1), cfg.label] as [string, string, string] : null;
    })
    .filter((x): x is [string, string, string] => x !== null);

  // Build TOC outline card HTML
  const tocEntriesHtml = tocSections
    .map(
      ([sid, num, label]) =>
        `      <a href="#${sid}" class="toc-entry" data-target="${sid}">` +
        `<span class="toc-entry-num">${num}</span>` +
        `<span class="toc-entry-text">${label}</span>` +
        `</a>`,
    )
    .join("\n");
  const tocCardHtml = `
    <nav class="toc-card" id="toc-card">
      <div class="toc-card-header">
        <span class="toc-card-title">📑 ${escapeHtml(outlineLabel)}</span>
        <span class="toc-card-toggle">▼</span>
      </div>
      <div class="toc-list">
${tocEntriesHtml}
      </div>
    </nav>
    `;

  // Build floating dots HTML (desktop only)
  const tocDotsHtml = tocSections
    .map(
      ([sid, num, label]) =>
        `  <span class="toc-dot" data-target="${sid}"><span class="toc-floating-label">${num} · ${label}</span></span>`,
    )
    .join("\n");
  const tocFloatingHtml = `
  <div class="toc-floating">
${tocDotsHtml}
  </div>
    `;

  return `<!doctype html>
<html lang="${language === "en" ? "en" : "zh-CN"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(titlePrefix)}-${escapeHtml(dateCompact)}</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
  ${tocFloatingHtml}
  <main class="page">

    ${tocCardHtml}

    ${sectionsHtml}

  </main>
  ${REPORT_JS}
</body>
</html>
`;
}

/** Combine module Markdown fragments into one unified Markdown daily report. */
export function buildUnifiedMd(dateCompact: string, fragments: ModuleFragments, moduleOrder?: string[], language: "zh" | "en" = "zh"): string {
  const DEFAULT_ORDER = ["official", "blog", "github", "arxiv", "conference", "wechat"];
  const order = moduleOrder?.length ? moduleOrder : DEFAULT_ORDER;
  const dateDisplay = `${dateCompact.slice(0, 4)}-${dateCompact.slice(4, 6)}-${dateCompact.slice(6, 8)}`;
  const labels = language === "en" ? MODULE_LABELS_EN : MODULE_LABELS_ZH;
  const emptyStates = language === "en" ? EMPTY_STATE_EN : EMPTY_STATE_ZH;
  const subtitle = language === "en" ? "Tech Frontier Daily" : "科技前沿日报";
  const titlePrefix = language === "en" ? "NewSee" : "新知";

  const bodies: Record<string, { body: string; label: string }> = {
    official: { label: labels.official, body: fragments.official?.trim() || `_${emptyStates.official}_` },
    blog: { label: labels.blog, body: fragments.blog?.trim() || `_${emptyStates.blog}_` },
    github: { label: labels.github, body: fragments.github?.trim() || `_${emptyStates.github}_` },
    arxiv: { label: labels.arxiv, body: fragments.arxiv?.trim() || `_${emptyStates.arxiv}_` },
    conference: { label: labels.conference, body: fragments.conference?.trim() || `_${emptyStates.conference}_` },
    wechat: { label: labels.wechat, body: fragments.wechat?.trim() || `_${emptyStates.wechat}_` },
  };

  const subtitleParts = order.filter((k) => bodies[k]).map((k) => bodies[k].label);
  const subtitleLine = subtitleParts.join(" + ");

  const parts = order.map((key, i) => {
    const cfg = bodies[key];
    if (!cfg) return "";
    return `## Part ${i + 1} — ${cfg.label}\n\n${cfg.body}`;
  }).filter(Boolean).join("\n\n");

  return `# ${titlePrefix}-${dateCompact}

> ${subtitle} · ${dateDisplay} · ${subtitleLine}

${parts}
---
`;
}
