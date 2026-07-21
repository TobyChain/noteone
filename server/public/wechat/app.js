// 微信公众号配置页 — 由 App WebView 以 /wechat/?token={JWT} 打开。
// 登录/公众号接口凭 auth-key cookie；订阅列表读写走 /api/ascan/config（需 JWT）。
(() => {
  const jwt = new URLSearchParams(location.search).get("token") || "";
  const authHeaders = jwt ? { Authorization: `Bearer ${jwt}` } : {};

  const $ = (id) => document.getElementById(id);
  const show = (el, visible) => el.classList.toggle("hidden", !visible);

  let config = null;
  let scanTimer = null;

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    show(el, true);
    clearTimeout(toast._t);
    toast._t = setTimeout(() => show(el, false), 2500);
  }

  async function api(path, options = {}) {
    const resp = await fetch(path, options);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  // ── 登录状态 ────────────────────────────────────────────────

  function setBadge(text, cls) {
    const badge = $("login-badge");
    badge.textContent = text;
    badge.className = "badge" + (cls ? " " + cls : "");
  }

  async function refreshLoginStatus() {
    try {
      const info = await api("/api/wechat/mp/info");
      if (info && info.nick_name) {
        setBadge("已登录", "ok");
        const expires = info.expires_at ? new Date(info.expires_at).toLocaleString() : "";
        $("login-status").textContent = `${info.nick_name}${expires ? `（有效期至 ${expires}）` : ""}`;
        show($("btn-login"), false);
        show($("btn-relogin"), true);
        show($("btn-logout"), true);
        return true;
      }
    } catch (e) { /* fall through */ }
    setBadge("未登录", "warn");
    $("login-status").textContent = "登录后才能搜索公众号并抓取文章（有效期 4 天）。";
    show($("btn-login"), true);
    show($("btn-relogin"), false);
    show($("btn-logout"), false);
    return false;
  }

  // ── 扫码登录流程 ────────────────────────────────────────────

  function stopPolling() {
    clearTimeout(scanTimer);
    scanTimer = null;
  }

  async function startLoginFlow() {
    stopPolling();
    show($("qr-area"), true);
    $("qr-msg").textContent = "获取二维码中…";
    try {
      const sid = Date.now().toString() + Math.floor(Math.random() * 100);
      const resp = await api(`/api/wechat/login/start/${sid}`, { method: "POST" });
      if (!resp || !resp.base_resp || resp.base_resp.ret !== 0) {
        throw new Error(resp?.base_resp?.err_msg || "获取登录会话失败");
      }
      $("qr-img").src = `/api/wechat/login/qrcode?rnd=${Math.random()}`;
      $("qr-msg").textContent = "使用微信扫码并确认登录";
      pollScan();
    } catch (e) {
      $("qr-msg").textContent = `二维码获取失败：${e.message}`;
    }
  }

  function pollScan() {
    scanTimer = setTimeout(async () => {
      try {
        const resp = await api("/api/wechat/login/scan");
        if (resp && resp.base_resp && resp.base_resp.ret === 0) {
          switch (resp.status) {
            case 1: {
              $("qr-msg").textContent = "已确认，正在登录…";
              const result = await api("/api/wechat/login/confirm", { method: "POST" });
              show($("qr-area"), false);
              toast(`登录成功：${result.nickname || ""}`);
              await refreshLoginStatus();
              return;
            }
            case 2:
            case 3:
              $("qr-img").src = `/api/wechat/login/qrcode?rnd=${Math.random()}`;
              break;
            case 4:
            case 6:
              $("qr-msg").textContent = resp.acct_size >= 1 ? "扫码成功，请在手机上确认" : "没有可登录的公众号账号";
              break;
            case 5:
              $("qr-msg").textContent = "该账号尚未绑定邮箱，无法扫码登录";
              break;
          }
        }
      } catch (e) {
        $("qr-msg").textContent = `登录出错：${e.message}`;
      }
      pollScan();
    }, 2000);
  }

  // ── 订阅列表与抓取参数（/api/ascan/config） ──────────────────

  async function loadConfig() {
    config = await api("/api/ascan/config", { headers: authHeaders });
    renderMpList();
    $("limit-per-mp").value = config.wechat_limit_per_mp ?? 20;
    $("days-recent").value = config.wechat_days_recent ?? 30;
  }

  async function saveConfig(updates) {
    config = await api("/api/ascan/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(updates),
    });
  }

  function renderMpList() {
    const mps = config?.wechat_mp_ids || [];
    $("mp-count").textContent = `${mps.length} 个`;
    show($("mp-empty"), mps.length === 0);
    const list = $("mp-list");
    list.innerHTML = "";
    for (const mp of mps) {
      const li = document.createElement("li");
      const info = document.createElement("div");
      const name = document.createElement("div");
      name.textContent = mp.name || mp.id;
      const meta = document.createElement("div");
      meta.className = "mp-meta";
      meta.textContent = mp.id;
      info.append(name, meta);
      const btn = document.createElement("button");
      btn.className = "danger";
      btn.textContent = "移除";
      btn.onclick = async () => {
        await saveConfig({ wechat_mp_ids: mps.filter((m) => m.id !== mp.id) });
        renderMpList();
        toast("已移除");
      };
      li.append(info, btn);
      list.appendChild(li);
    }
  }

  async function searchMp() {
    const keyword = $("search-input").value.trim();
    if (!keyword) return;
    const btn = $("btn-search");
    btn.disabled = true;
    try {
      const resp = await api(`/api/wechat/mp/search?keyword=${encodeURIComponent(keyword)}&begin=0&size=8`);
      const list = $("search-results");
      list.innerHTML = "";
      if (resp?.base_resp?.ret === 200003) {
        toast("登录已过期，请重新扫码");
        await refreshLoginStatus();
        return;
      }
      const items = resp?.list || [];
      if (items.length === 0) {
        toast("没有搜到公众号");
        return;
      }
      const subscribed = new Set((config?.wechat_mp_ids || []).map((m) => m.id));
      for (const item of items) {
        const li = document.createElement("li");
        const info = document.createElement("div");
        const name = document.createElement("div");
        name.textContent = item.nickname;
        const meta = document.createElement("div");
        meta.className = "mp-meta";
        meta.textContent = item.alias || item.fakeid;
        info.append(name, meta);
        const btn2 = document.createElement("button");
        if (subscribed.has(item.fakeid)) {
          btn2.textContent = "已订阅";
          btn2.disabled = true;
        } else {
          btn2.textContent = "添加";
          btn2.onclick = async () => {
            const mps = [...(config?.wechat_mp_ids || []), { id: item.fakeid, name: item.nickname }];
            await saveConfig({ wechat_mp_ids: mps });
            renderMpList();
            btn2.textContent = "已订阅";
            btn2.disabled = true;
            toast(`已添加「${item.nickname}」`);
          };
        }
        li.append(info, btn2);
        list.appendChild(li);
      }
    } catch (e) {
      toast(`搜索失败：${e.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  // ── 事件绑定与初始化 ─────────────────────────────────────────

  $("btn-login").onclick = startLoginFlow;
  $("btn-relogin").onclick = startLoginFlow;
  $("btn-logout").onclick = async () => {
    stopPolling();
    await api("/api/wechat/logout", { method: "POST" });
    show($("qr-area"), false);
    toast("已退出登录");
    await refreshLoginStatus();
  };
  $("btn-search").onclick = searchMp;
  $("search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchMp();
  });
  $("btn-save").onclick = async () => {
    await saveConfig({
      wechat_limit_per_mp: parseInt($("limit-per-mp").value, 10) || 20,
      wechat_days_recent: parseInt($("days-recent").value, 10) || 30,
    });
    toast("已保存");
  };

  refreshLoginStatus();
  loadConfig().catch(() => toast("配置加载失败，请检查登录令牌"));
})();
