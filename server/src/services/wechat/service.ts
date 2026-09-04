/**
 * WeChat MP integration service: QR login, account search, article listing.
 * Replaces the external wechat-article-exporter (WAE) deployment.
 */
import { mpRequest, getSetCookies } from "./mp-proxy.js";
import {
  cookieHeaderFrom,
  createSession,
  getSession,
  removeSession,
  WechatSession,
} from "./session-store.js";
import { getConfig, getEffectiveConfig, updateConfig } from "../newlore/config.js";

const MP_BASE = "https://mp.weixin.qq.com/cgi-bin";
const FREQ_CONTROL_RET = 200013;
let articleRequestQueue: Promise<void> = Promise.resolve();
let lastArticleRequestAt = 0;
let articleCooldownUntil = 0;

function frequencyControlled(retryAfterSeconds: number) {
  return {
    base_resp: {
      ret: FREQ_CONTROL_RET,
      err_msg: "freq control",
      retry_after_seconds: Math.max(1, Math.ceil(retryAfterSeconds)),
    },
  };
}

async function withArticleRequestGate<T>(task: () => Promise<T>): Promise<T> {
  const previous = articleRequestQueue;
  let release!: () => void;
  articleRequestQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const config = await getConfig();
    const now = Date.now();
    if (articleCooldownUntil > now) {
      return frequencyControlled((articleCooldownUntil - now) / 1000) as T;
    }
    const intervalMs = Math.max(1, config.wechat_request_interval_seconds) * 1000;
    const waitMs = Math.max(0, lastArticleRequestAt + intervalMs - now);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    const result: any = await task();
    lastArticleRequestAt = Date.now();
    if (result?.base_resp?.ret === FREQ_CONTROL_RET) {
      const cooldownMs = Math.max(1, config.wechat_rate_limit_cooldown_minutes) * 60_000;
      articleCooldownUntil = Date.now() + cooldownMs;
      result.base_resp.retry_after_seconds = Math.ceil(cooldownMs / 1000);
    }
    return result as T;
  } finally {
    release();
  }
}

export function getWechatArticleRateLimitState(): { limited: boolean; retryAfterSeconds: number } {
  const retryAfterSeconds = Math.max(0, Math.ceil((articleCooldownUntil - Date.now()) / 1000));
  return { limited: retryAfterSeconds > 0, retryAfterSeconds };
}

// ── 登录流程（浏览器 uuid cookie 透传） ──────────────────────────

export async function startLogin(sid: string, browserCookie: string): Promise<{ body: unknown; setCookies: string[] }> {
  const response = await mpRequest({
    endpoint: `${MP_BASE}/bizlogin`,
    method: "POST",
    query: { action: "startlogin" },
    body: {
      userlang: "zh_CN",
      redirect_url: "",
      login_type: 3,
      sessionid: sid,
      token: "",
      lang: "zh_CN",
      f: "json",
      ajax: 1,
    },
    cookie: browserCookie,
  });
  // 把微信下发的 uuid cookie 透传给客户端，供后续取码/轮询/确认使用
  const setCookies = getSetCookies(response).filter((c) => c.startsWith("uuid="));
  const body = await response.json().catch(() => ({}));
  return { body, setCookies };
}

export async function getLoginQrcode(browserCookie: string): Promise<{ buffer: Buffer; contentType: string }> {
  const response = await mpRequest({
    endpoint: `${MP_BASE}/scanloginqrcode`,
    method: "GET",
    query: { action: "getqrcode", random: Date.now() },
    cookie: browserCookie,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType: response.headers.get("content-type") || "image/png" };
}

export async function pollScan(browserCookie: string): Promise<unknown> {
  const response = await mpRequest({
    endpoint: `${MP_BASE}/scanloginqrcode`,
    method: "GET",
    query: { action: "ask", token: "", lang: "zh_CN", f: "json", ajax: 1 },
    cookie: browserCookie,
  });
  return response.json();
}

export interface LoginResult {
  authKey: string;
  nickname: string;
  avatar: string;
  expiresAt: string;
}

export async function confirmLogin(browserCookie: string): Promise<LoginResult> {
  const response = await mpRequest({
    endpoint: `${MP_BASE}/bizlogin`,
    method: "POST",
    query: { action: "login" },
    body: {
      userlang: "zh_CN",
      redirect_url: "",
      cookie_forbidden: 0,
      cookie_cleaned: 0,
      plugin_used: 0,
      login_type: 3,
      token: "",
      lang: "zh_CN",
      f: "json",
      ajax: 1,
    },
    cookie: browserCookie,
  });

  const setCookies = getSetCookies(response);
  const body: any = await response.json().catch(() => null);
  const redirectUrl = body?.redirect_url;
  if (!redirectUrl || typeof redirectUrl !== "string") {
    throw Object.assign(new Error("登录响应中未找到 redirect_url，请重新扫码"), { status: 502 });
  }
  const token = new URL(`http://localhost${redirectUrl}`).searchParams.get("token");
  if (!token) {
    throw Object.assign(new Error(`redirect_url 中未找到 token: ${redirectUrl}`), { status: 502 });
  }

  const session = await createSession({ token, setCookies });
  const info = await fetchMpInfo(session);

  // 自动写入 newlore/.env，新知 wechat 模块（进程内）直接读取，免手工配置
  await updateConfig({ wechat_auth_key: session.authKey });

  return {
    authKey: session.authKey,
    nickname: info.nickname,
    avatar: info.avatar,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export async function logout(authKey: string): Promise<void> {
  await removeSession(authKey);
  const config = await getConfig();
  if (config.wechat_auth_key === authKey) {
    await updateConfig({ wechat_auth_key: "" });
  }
}

// ── 登录态请求（凭 auth-key） ─────────────────────────────────

const EXPIRED_RESP = { base_resp: { ret: 200003, err_msg: "auth-key 无效或已过期，请重新扫码登录" } };

async function fetchMpInfo(session: WechatSession): Promise<{ nickname: string; avatar: string }> {
  const response = await mpRequest({
    endpoint: `${MP_BASE}/home`,
    method: "GET",
    query: { t: "home/index", token: session.token, lang: "zh_CN" },
    cookie: cookieHeaderFrom(session.cookies),
  });
  const html = await response.text();
  const nickname = html.match(/wx\.cgiData\.nick_name\s*?=\s*?"(?<v>[^"]+)"/)?.groups?.v || "";
  const avatar = html.match(/wx\.cgiData\.head_img\s*?=\s*?"(?<v>[^"]+)"/)?.groups?.v || "";
  return { nickname, avatar };
}

export async function getAccountInfo(authKey: string): Promise<unknown> {
  const session = await getSession(authKey);
  if (!session) return EXPIRED_RESP;
  const info = await fetchMpInfo(session);
  if (!info.nickname) return EXPIRED_RESP;
  return { nick_name: info.nickname, head_img: info.avatar, expires_at: session.expiresAt.toISOString() };
}

export async function searchAccounts(authKey: string, keyword: string, begin = 0, size = 5): Promise<unknown> {
  const session = await getSession(authKey);
  if (!session) return EXPIRED_RESP;
  const response = await mpRequest({
    endpoint: `${MP_BASE}/searchbiz`,
    method: "GET",
    query: {
      action: "search_biz",
      begin,
      count: size,
      query: keyword,
      token: session.token,
      lang: "zh_CN",
      f: "json",
      ajax: 1,
    },
    cookie: cookieHeaderFrom(session.cookies),
  });
  return response.json();
}

export async function listArticles(
  authKey: string,
  fakeid: string,
  begin = 0,
  size = 5,
  keyword = "",
): Promise<unknown> {
  return withArticleRequestGate(async () => {
    const session = await getSession(authKey);
    if (!session) return EXPIRED_RESP;
    const isSearching = !!keyword;
    const response = await mpRequest({
      endpoint: `${MP_BASE}/appmsgpublish`,
      method: "GET",
      query: {
        sub: isSearching ? "search" : "list",
        search_field: isSearching ? "7" : "null",
        begin,
        count: size,
        query: keyword,
        fakeid,
        type: "101_1",
        free_publish_type: 1,
        sub_action: "list_ex",
        token: session.token,
        lang: "zh_CN",
        f: "json",
        ajax: 1,
      },
      cookie: cookieHeaderFrom(session.cookies),
    });
    return response.json();
  });
}

// ── 健康检查（供 /api/newlore/wechat-health 进程内调用） ─────────

export interface WechatHealth {
  status: "unconfigured" | "ready" | "rate_limited" | "auth_expired" | "unreachable";
  mpCount: number;
  nickname?: string;
  expiresAt?: string;
  message?: string;
}

export async function checkWechatHealth(userId?: string): Promise<WechatHealth> {
  const config = await getEffectiveConfig(userId);
  const mpCount = config.wechat_mp_ids.length;
  const authKey = config.wechat_auth_key;
  if (!authKey) {
    return { status: "unconfigured", mpCount, message: "尚未扫码登录微信公众平台" };
  }
  try {
    const info: any = await getAccountInfo(authKey);
    if (info?.base_resp?.ret === 200003 || !info?.nick_name) {
      return { status: "auth_expired", mpCount, message: "登录已过期，请重新扫码" };
    }
    const rateLimit = getWechatArticleRateLimitState();
    return {
      status: rateLimit.limited ? "rate_limited" : "ready",
      mpCount,
      nickname: info.nick_name,
      expiresAt: info.expires_at,
      message: rateLimit.limited
        ? `文章接口频率限制中，建议 ${Math.ceil(rateLimit.retryAfterSeconds / 60)} 分钟后重试`
        : undefined,
    };
  } catch (err: any) {
    return { status: "unreachable", mpCount, message: String(err?.message || err) };
  }
}
