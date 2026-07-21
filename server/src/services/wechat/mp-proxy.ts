/**
 * Low-level proxy to mp.weixin.qq.com (ported from wechat-article-exporter).
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 NoteOne/1.0";

export interface MpRequestOptions {
  endpoint: string;
  method: "GET" | "POST";
  query?: Record<string, string | number>;
  body?: Record<string, string | number>;
  cookie?: string | null;
}

export async function mpRequest(options: MpRequestOptions): Promise<Response> {
  const headers = new Headers({
    Referer: "https://mp.weixin.qq.com/",
    Origin: "https://mp.weixin.qq.com",
    "User-Agent": USER_AGENT,
    // 禁用压缩，避免 body 处理问题（与 WAE 一致）
    "Accept-Encoding": "identity",
  });
  if (options.cookie) headers.set("Cookie", options.cookie);

  let url = options.endpoint;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) params.set(k, String(v));
    url += "?" + params.toString();
  }

  const init: RequestInit = { method: options.method, headers, redirect: "follow" };
  if (options.method === "POST" && options.body) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.body)) params.set(k, String(v));
    init.body = params.toString();
    headers.set("Content-Type", "application/x-www-form-urlencoded");
  }

  return fetch(url, init);
}

export function getSetCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}
