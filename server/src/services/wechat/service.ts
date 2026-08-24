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
import { getConfig, updateConfig } from "../ascan/config.js";

const MP_BASE = "https://mp.weixin.qq.com/cgi-bin";

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

  // 自动写入 ascan/.env，新知 wechat 模块（进程内）直接读取，免手工配置
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
}

// ── 健康检查（供 /api/ascan/wechat-health 进程内调用） ─────────

export interface WechatHealth {
  status: "unconfigured" | "ready" | "auth_expired" | "unreachable";
  mpCount: number;
  nickname?: string;
  expiresAt?: string;
  message?: string;
}

export async function checkWechatHealth(): Promise<WechatHealth> {
  const config = await getConfig();
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
    return { status: "ready", mpCount, nickname: info.nick_name, expiresAt: info.expires_at };
  } catch (err: any) {
    return { status: "unreachable", mpCount, message: String(err?.message || err) };
  }
}
