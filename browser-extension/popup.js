const API_BASE = "http://localhost:3000";
const urlInput = document.getElementById("url");
const titleInput = document.getElementById("title");
const contentInput = document.getElementById("content");
const captureBtn = document.getElementById("captureBtn");
const statusEl = document.getElementById("status");

// --- Load current page data ---
async function loadPageData() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const sel = window.getSelection()?.toString().trim() || "";
      return {
        url: window.location.href,
        title: document.title,
        selectedText: sel,
      };
    },
  });

  const data = results[0]?.result;
  if (data) {
    urlInput.value = data.url;
    titleInput.value = data.title;
    contentInput.value = data.selectedText || data.title;
  }
}

// --- Token ---
async function getToken() {
  let { token, expiresAt } = await chrome.storage.local.get(["token", "expiresAt"]);
  if (token && expiresAt && Date.now() < expiresAt) return token;
  try {
    const resp = await fetch(`${API_BASE}/auth/dev-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Browser Extension" }),
    });
    if (!resp.ok) throw new Error(`dev-token failed: ${resp.status}`);
    const data = await resp.json();
    await chrome.storage.local.set({
      token: data.token,
      expiresAt: Date.now() + 29 * 24 * 3600 * 1000,
    });
    return data.token;
  } catch (e) {
    return null;
  }
}

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = `status ${type}`;
  statusEl.classList.remove("hidden");
  setTimeout(() => statusEl.classList.add("hidden"), 3000);
}

// --- Capture ---
captureBtn.addEventListener("click", async () => {
  const content = contentInput.value.trim();
  if (!content) {
    showStatus("请输入内容", "error");
    return;
  }

  captureBtn.disabled = true;
  captureBtn.textContent = "发送中...";

  const token = await getToken();
  if (!token) {
    showStatus("无法连接 NoteOne 服务，请确保服务已启动", "error");
    captureBtn.disabled = false;
    captureBtn.textContent = "捕获到 NoteOne";
    return;
  }

  try {
    const resp = await fetch(`${API_BASE}/api/notes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        content,
        contentType: "link",
        title: titleInput.value.trim() || content.slice(0, 50),
        sourceUrl: urlInput.value.trim() || undefined,
        sourceApp: "Browser",
      }),
    });

    if (resp.ok) {
      showStatus("已捕获到 NoteOne", "success");
    } else {
      const err = await resp.json().catch(() => ({}));
      showStatus(err.error || `服务器返回 ${resp.status}`, "error");
    }
  } catch (e) {
    showStatus(`网络错误: ${e.message}`, "error");
  }

  captureBtn.disabled = false;
  captureBtn.textContent = "捕获到 NoteOne";
});

// --- Init ---
loadPageData();
