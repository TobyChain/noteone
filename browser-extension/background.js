const API_BASE = "http://localhost:3000";

// --- Token management ---

async function getToken() {
  let { token, expiresAt } = await chrome.storage.local.get(["token", "expiresAt"]);
  if (token && expiresAt && Date.now() < expiresAt) {
    return token;
  }
  // Try dev-token (requires ENABLE_DEV_LOGIN=true on server)
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
      expiresAt: Date.now() + 29 * 24 * 3600 * 1000, // 29 days
    });
    return data.token;
  } catch (e) {
    console.error("Failed to get auth token:", e);
    return null;
  }
}

// --- Capture & send ---

async function captureAndSend(tab) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectPageData,
    });
    const data = results[0]?.result;
    if (!data) return { success: false, error: "无法读取页面数据" };

    const token = await getToken();
    if (!token) return { success: false, error: "无法获取认证令牌，请确保 NoteOne 服务已启动" };

    const contentType = data.selectedImage ? "image" : data.selectedVideo ? "video" : "link";
    const content = [
      data.selectedText,
      data.selectedImage ? `[图片] ${data.selectedImage}` : "",
      data.selectedVideo ? `[视频] ${data.selectedVideo}` : "",
    ]
      .filter(Boolean)
      .join("\n\n") || data.title;

    const resp = await fetch(`${API_BASE}/api/notes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        content,
        contentType,
        title: data.title,
        sourceUrl: data.url,
        sourceApp: "Browser",
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return { success: false, error: err.error || `服务器返回 ${resp.status}` };
    }
    return { success: true, title: data.title };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function collectPageData() {
  const selection = window.getSelection();
  const selectedText = selection ? selection.toString().trim() : "";

  // Check for a right-clicked / focused image or video
  let selectedImage = "";
  let selectedVideo = "";
  const activeEl = document.activeElement;
  if (activeEl?.tagName === "IMG") {
    selectedImage = activeEl.src;
  } else if (activeEl?.tagName === "VIDEO") {
    selectedVideo = activeEl.src || activeEl.querySelector("source")?.src || "";
  }

  // Also check selection for images (user may have selected an image)
  if (!selectedImage && selection?.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const imgs = range.cloneContents().querySelectorAll("img");
    if (imgs.length > 0) selectedImage = imgs[0].src;
    const videos = range.cloneContents().querySelectorAll("video");
    if (videos.length > 0) {
      selectedVideo = videos[0].src || videos[0].querySelector("source")?.src || "";
    }
  }

  return {
    url: window.location.href,
    title: document.title || window.location.href,
    selectedText,
    selectedImage,
    selectedVideo,
  };
}

// --- Command handler (Cmd+Shift+O) ---

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "capture-page") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const result = await captureAndSend(tab);

  // Show result via badge
  const text = result.success ? "✓" : "✗";
  const color = result.success ? "#16a34a" : "#dc2626";
  chrome.action.setBadgeText({ text, tabId: tab.id });
  chrome.action.setBadgeBackgroundColor({ color, tabId: tab.id });
  setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: tab.id }), 2000);
});

// --- Context menu: right-click image/video/link ---

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "capture-media",
    title: "捕获到 NoteOne",
    contexts: ["image", "video", "link"],
  });
  chrome.contextMenus.create({
    id: "capture-selection",
    title: "捕获选中文本到 NoteOne",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  let title = "";
  let content = "";
  let contentType = "text";
  let sourceUrl = "";

  if (info.menuItemId === "capture-media") {
    if (info.mediaType === "image") {
      contentType = "image";
      content = `[图片] ${info.srcUrl}`;
      sourceUrl = info.srcUrl;
      title = info.srcUrl?.split("/").pop() || "图片捕获";
    } else if (info.mediaType === "video") {
      contentType = "video";
      content = `[视频] ${info.srcUrl}`;
      sourceUrl = info.srcUrl;
      title = info.srcUrl?.split("/").pop() || "视频捕获";
    } else if (info.linkUrl) {
      contentType = "link";
      content = info.linkUrl;
      sourceUrl = info.linkUrl;
      title = "链接捕获";
    }
  } else if (info.menuItemId === "capture-selection") {
    content = info.selectionText || "";
    title = content.slice(0, 50);
    sourceUrl = info.pageUrl;
  }

  if (!content) return;

  const token = await getToken();
  if (!token) {
    chrome.action.setBadgeText({ text: "✗", tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#dc2626", tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: tab.id }), 2000);
    return;
  }

  const resp = await fetch(`${API_BASE}/api/notes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ content, contentType, title, sourceUrl, sourceApp: "Browser" }),
  });

  const text = resp.ok ? "✓" : "✗";
  const color = resp.ok ? "#16a34a" : "#dc2626";
  chrome.action.setBadgeText({ text, tabId: tab.id });
  chrome.action.setBadgeBackgroundColor({ color, tabId: tab.id });
  setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: tab.id }), 2000);
});
