/**
 * WeChat MP login session store: auth-key -> { token, cookies }.
 * DB-persisted (wechat_sessions) with an in-memory LRU cache in front.
 */
import { randomUUID } from "crypto";
import { eq, lt } from "drizzle-orm";
import { db } from "../../db/client.js";
import { wechatSessions } from "../../db/schema.js";
import { CookieEntity, cookieHeaderFrom, parseSetCookies } from "./cookies.js";

export { cookieHeaderFrom } from "./cookies.js";

export interface WechatSession {
  authKey: string;
  token: string;
  cookies: CookieEntity[];
  expiresAt: Date;
}

const SESSION_TTL_DAYS = 4;
const MAX_CACHE_SIZE = 100;

const cache = new Map<string, WechatSession>();

function cachePut(session: WechatSession) {
  cache.delete(session.authKey);
  while (cache.size >= MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(session.authKey, session);
}

export async function getSession(authKey: string): Promise<WechatSession | null> {
  const cached = cache.get(authKey);
  if (cached) {
    if (cached.expiresAt.getTime() < Date.now()) {
      cache.delete(authKey);
      return null;
    }
    cache.delete(authKey);
    cache.set(authKey, cached);
    return cached;
  }

  const rows = await db.select().from(wechatSessions).where(eq(wechatSessions.authKey, authKey)).limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(wechatSessions).where(eq(wechatSessions.authKey, authKey));
    return null;
  }
  const session: WechatSession = {
    authKey: row.authKey,
    token: row.token,
    cookies: (row.cookies as CookieEntity[]) || [],
    expiresAt: row.expiresAt,
  };
  cachePut(session);
  return session;
}

export async function createSession(params: {
  token: string;
  setCookies: string[];
}): Promise<WechatSession> {
  const authKey = randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const session: WechatSession = {
    authKey,
    token: params.token,
    cookies: parseSetCookies(params.setCookies),
    expiresAt,
  };
  await db.insert(wechatSessions).values({
    authKey,
    token: session.token,
    cookies: session.cookies,
    expiresAt,
  });
  cachePut(session);
  // 顺手清理已过期会话（不阻塞登录流程）
  void Promise.resolve(db.delete(wechatSessions).where(lt(wechatSessions.expiresAt, new Date()))).catch(() => {});
  return session;
}

export async function removeSession(authKey: string): Promise<void> {
  cache.delete(authKey);
  await db.delete(wechatSessions).where(eq(wechatSessions.authKey, authKey));
}
