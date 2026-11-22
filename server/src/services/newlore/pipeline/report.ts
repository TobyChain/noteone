/**
 * Unified daily report renderers (HTML + Markdown).
 *
 * Faithful TypeScript port of:
 *   - newlore/src/tools/unified_report.py  (build_unified_html)
 *   - newlore/src/tools/report_md.py       (build_unified_md)
 */
import { escapeHtml } from "./util.js";
import { renderPage } from "../../reader/themes-css.js";

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
}

const MODULE_LABELS_ZH: Record<string, string> = {
  official: "官方动态跟踪",
  blog: "独立博客订阅",
  github: "GitHub 项目挖掘",
  arxiv: "arXiv 论文精选",
  conference: "会议论文追踪",
};

const MODULE_LABELS_EN: Record<string, string> = {
  official: "Official Updates",
  blog: "Independent Blogs",
  github: "GitHub Projects",
  arxiv: "arXiv Papers",
  conference: "Conference Papers",
};

const EMPTY_STATE_ZH: Record<string, string> = {
  official: "今日无 Anthropic Research 或 DeepMind 新文章。",
  blog: "今日无独立博客更新。",
  github: "今日无 GitHub 数据。",
  arxiv: "今日无 arXiv 数据。",
  conference: "今日无会议论文数据。",
};

const EMPTY_STATE_EN: Record<string, string> = {
  official: "No new Anthropic Research or DeepMind articles today.",
  blog: "No independent blog updates today.",
  github: "No GitHub data today.",
  arxiv: "No arXiv data today.",
  conference: "No conference paper data today.",
};

/**
 * Build the body fragment of the daily report (outline nav, sections and TOC
 * script) from arXiv, GitHub, official tracker, blog and conference fragments;
 * styling and the page shell come from the unified reader assets.
 */
export function buildReportBody(dateCompact: string, fragments: ModuleFragments, moduleOrder?: string[], language: "zh" | "en" = "zh"): string {
  const DEFAULT_ORDER = ["official", "blog", "github", "arxiv", "conference"];
  const order = moduleOrder?.length ? moduleOrder : DEFAULT_ORDER;
  const labels = language === "en" ? MODULE_LABELS_EN : MODULE_LABELS_ZH;
  const emptyStates = language === "en" ? EMPTY_STATE_EN : EMPTY_STATE_ZH;
  const outlineLabel = language === "en" ? "Outline" : "大纲";

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

  return `
  ${tocFloatingHtml}
  <main class="page" lang="${language === "en" ? "en" : "zh-CN"}">

    ${tocCardHtml}

    ${sectionsHtml}

  </main>
  ${REPORT_JS}
`;
}

/**
 * Combine arXiv, GitHub, official tracker, blog and conference
 * fragments into one standalone HTML daily report (self-contained page).
 */
export function buildUnifiedHtml(dateCompact: string, fragments: ModuleFragments, moduleOrder?: string[], language: "zh" | "en" = "zh"): string {
  const titlePrefix = language === "en" ? "NewLore" : "新知";
  // The body carries its own lang so the app shell (which never learns the
  // report language) still picks fonts and quotes for the right locale.
  const lang = language === "en" ? "en" : "zh-CN";
  return renderPage(`${titlePrefix}-${dateCompact}`, buildReportBody(dateCompact, fragments, moduleOrder, language), lang);
}

/** Combine module Markdown fragments into one unified Markdown daily report. */
export function buildUnifiedMd(dateCompact: string, fragments: ModuleFragments, moduleOrder?: string[], language: "zh" | "en" = "zh"): string {
  const DEFAULT_ORDER = ["official", "blog", "github", "arxiv", "conference"];
  const order = moduleOrder?.length ? moduleOrder : DEFAULT_ORDER;
  const dateDisplay = `${dateCompact.slice(0, 4)}-${dateCompact.slice(4, 6)}-${dateCompact.slice(6, 8)}`;
  const labels = language === "en" ? MODULE_LABELS_EN : MODULE_LABELS_ZH;
  const emptyStates = language === "en" ? EMPTY_STATE_EN : EMPTY_STATE_ZH;
  const subtitle = language === "en" ? "Tech Frontier Daily" : "科技前沿日报";
  const titlePrefix = language === "en" ? "NewLore" : "新知";

  const bodies: Record<string, { body: string; label: string }> = {
    official: { label: labels.official, body: fragments.official?.trim() || `_${emptyStates.official}_` },
    blog: { label: labels.blog, body: fragments.blog?.trim() || `_${emptyStates.blog}_` },
    github: { label: labels.github, body: fragments.github?.trim() || `_${emptyStates.github}_` },
    arxiv: { label: labels.arxiv, body: fragments.arxiv?.trim() || `_${emptyStates.arxiv}_` },
    conference: { label: labels.conference, body: fragments.conference?.trim() || `_${emptyStates.conference}_` },
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
