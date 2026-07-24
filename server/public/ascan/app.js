// 新知配置页 — 由 App WebView 以 /ascan/?token={JWT} 打开。
// 配置读写走 /api/ascan/config（需 JWT）。
(() => {
  const jwt = new URLSearchParams(location.search).get("token") || "";
  const authHeaders = jwt ? { Authorization: `Bearer ${jwt}` } : {};

  const $ = (id) => document.getElementById(id);
  const show = (el, visible) => el.classList.toggle("hidden", !visible);

  let config = null;

  const ALL_MODULES = [
    { key: "official", label: "官方动态跟踪" },
    { key: "blog", label: "独立博客订阅" },
    { key: "github", label: "GitHub 项目挖掘" },
    { key: "arxiv", label: "arXiv 论文精选" },
    { key: "conference", label: "会议论文追踪" },
    { key: "wechat", label: "微信公众号" },
  ];

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    show(el, true);
    clearTimeout(toast._t);
    toast._t = setTimeout(() => show(el, false), 2500);
  }

  async function api(path, options = {}) {
    const resp = await fetch(path, { ...options, headers: { ...(options.headers || {}), ...authHeaders } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  async function loadConfig() {
    config = await api("/api/ascan/config");
    renderAll();
  }

  async function saveConfig(updates, silent) {
    config = await api("/api/ascan/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!silent) toast("已保存");
  }

  // ── 模块开关 ────────────────────────────────────────────────

  function renderModules() {
    const enabled = new Set(config.enabled_modules && config.enabled_modules.length
      ? config.enabled_modules
      : ALL_MODULES.map((m) => m.key));
    $("module-count").textContent = `${enabled.size}/${ALL_MODULES.length} 启用`;
    const list = $("module-list");
    list.innerHTML = "";
    for (const mod of ALL_MODULES) {
      const item = document.createElement("div");
      item.className = "module-item";
      const label = document.createElement("span");
      label.textContent = mod.label;
      const sw = document.createElement("label");
      sw.className = "switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = enabled.has(mod.key);
      const slider = document.createElement("span");
      slider.className = "slider";
      input.onchange = async () => {
        const current = new Set(config.enabled_modules && config.enabled_modules.length
          ? config.enabled_modules
          : ALL_MODULES.map((m) => m.key));
        if (input.checked) current.add(mod.key);
        else current.delete(mod.key);
        if (current.size === 0) {
          input.checked = true;
          toast("至少保留一个模块");
          return;
        }
        // Keep canonical order
        const next = ALL_MODULES.map((m) => m.key).filter((k) => current.has(k));
        await saveConfig({ enabled_modules: next }, true);
        renderModules();
        toast("已更新模块");
      };
      sw.append(input, slider);
      item.append(label, sw);
      list.appendChild(item);
    }
  }

  // ── 微信公众号 ──────────────────────────────────────────────

  function renderMpSummary() {
    const mps = config.wechat_mp_ids || [];
    $("mp-count").textContent = `${mps.length} 个`;
    $("mp-summary").textContent = mps.length
      ? `已订阅：${mps.map((m) => m.name).join("、")}`
      : "尚未订阅公众号。点击管理后扫码登录并搜索添加。";
    const url = new URL("/wechat/", location.origin);
    if (jwt) url.searchParams.set("token", jwt);
    $("open-wechat").href = url.toString();
    $("open-wechat").target = "_blank";
  }

  // ── 博客信息源 ──────────────────────────────────────────────

  function renderBlogSources() {
    const sources = config.blog_sources || [];
    $("blog-count").textContent = `${sources.length} 个`;
    show($("blog-empty"), sources.length === 0);
    $("blog-max-per-source").value = config.blog_max_per_source ?? 2;
    const list = $("blog-list");
    list.innerHTML = "";
    for (const entry of sources) {
      const idx = entry.lastIndexOf("|");
      const label = idx === -1 ? entry : entry.slice(0, idx);
      const url = idx === -1 ? "" : entry.slice(idx + 1);
      const li = document.createElement("li");
      const info = document.createElement("div");
      const name = document.createElement("div");
      name.textContent = label;
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = url;
      info.append(name, meta);
      const btn = document.createElement("button");
      btn.className = "danger";
      btn.textContent = "移除";
      btn.onclick = async () => {
        await saveConfig({ blog_sources: sources.filter((s) => s !== entry) }, true);
        renderBlogSources();
        toast("已移除");
      };
      li.append(info, btn);
      list.appendChild(li);
    }
  }

  async function addBlogSource() {
    const name = $("blog-name").value.trim();
    const url = $("blog-url").value.trim();
    if (!name) { toast("请输入名称"); return; }
    if (!url.startsWith("http")) { toast("请输入以 http 开头的 RSS 地址"); return; }
    if (name.includes("|")) { toast("名称不能包含 | 字符"); return; }
    const sources = [...(config.blog_sources || [])];
    if (sources.some((s) => s === `${name}|${url}` || s.endsWith(`|${url}`))) {
      toast("该信息源已存在");
      return;
    }
    sources.push(`${name}|${url}`);
    await saveConfig({ blog_sources: sources }, true);
    $("blog-name").value = "";
    $("blog-url").value = "";
    renderBlogSources();
    toast(`已添加「${name}」`);
  }

  // ── 其余配置渲染 ────────────────────────────────────────────

  function renderAll() {
    renderModules();
    renderMpSummary();
    renderBlogSources();
    $("arxiv-subjects").value = (config.arxiv_subjects || []).join(", ");
    $("arxiv-offset").value = config.arxiv_date_offset_days ?? 1;
    $("arxiv-max-per-subject").value = config.max_papers_per_subject ?? 200;
    $("arxiv-max-total").value = config.max_total_papers ?? 500;
    $("github-topics").value = (config.github_topics || []).join(", ");
    $("github-max-repos").value = config.github_max_repos_per_topic ?? 8;
    $("github-min-stars").value = config.github_min_stars ?? 500;
    $("github-top-analyze").value = config.github_top_analyze ?? 20;
    $("github-token").value = config.github_token === "***" ? "" : (config.github_token || "");
    $("github-token").placeholder = config.github_token === "***" ? "已设置（留空保持不变）" : "留空保持不变";
    $("conf-lookback").value = config.conference_lookback_days ?? 30;
    $("conf-rank").value = (config.conference_rank_filter || []).join(", ");
    $("conf-categories").value = (config.conference_categories || []).join(", ");
    $("conf-apikey").value = config.semantic_scholar_api_key === "***" ? "" : (config.semantic_scholar_api_key || "");
    $("conf-apikey").placeholder = config.semantic_scholar_api_key === "***" ? "已设置（留空保持不变）" : "留空保持不变";
    $("llm-model").value = config.llm_model || "";
    $("llm-concurrency").value = config.llm_max_concurrency ?? 5;
    $("llm-max-tokens").value = config.llm_max_tokens ?? 8192;
    $("log-level").value = config.log_level || "INFO";
  }

  function splitList(text) {
    return text.split(",").map((s) => s.trim()).filter(Boolean);
  }

  async function saveAll() {
    const updates = {
      arxiv_subjects: splitList($("arxiv-subjects").value),
      arxiv_date_offset_days: parseInt($("arxiv-offset").value, 10) || 1,
      max_papers_per_subject: parseInt($("arxiv-max-per-subject").value, 10) || 200,
      max_total_papers: parseInt($("arxiv-max-total").value, 10) || 500,
      github_topics: splitList($("github-topics").value),
      github_max_repos_per_topic: parseInt($("github-max-repos").value, 10) || 8,
      github_min_stars: parseInt($("github-min-stars").value, 10) || 500,
      github_top_analyze: parseInt($("github-top-analyze").value, 10) || 20,
      conference_lookback_days: parseInt($("conf-lookback").value, 10) || 30,
      conference_rank_filter: splitList($("conf-rank").value),
      conference_categories: splitList($("conf-categories").value),
      blog_max_per_source: parseInt($("blog-max-per-source").value, 10) || 2,
      llm_model: $("llm-model").value.trim(),
      llm_max_concurrency: parseInt($("llm-concurrency").value, 10) || 5,
      llm_max_tokens: parseInt($("llm-max-tokens").value, 10) || 8192,
      log_level: $("log-level").value,
    };
    const ghToken = $("github-token").value.trim();
    if (ghToken) updates.github_token = ghToken;
    const confKey = $("conf-apikey").value.trim();
    if (confKey) updates.semantic_scholar_api_key = confKey;
    try {
      await saveConfig(updates);
    } catch (e) {
      toast(`保存失败：${e.message}`);
    }
  }

  // ── 事件绑定与初始化 ─────────────────────────────────────────

  $("btn-add-blog").onclick = addBlogSource;
  $("blog-url").addEventListener("keydown", (e) => { if (e.key === "Enter") addBlogSource(); });
  $("btn-save").onclick = saveAll;

  loadConfig().catch((e) => toast(`配置加载失败：${e.message}`));
})();
