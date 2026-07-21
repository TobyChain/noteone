/**
 * WeChat MP routes: QR login flow + account/article proxy.
 *
 * Auth model (same as the original WAE):
 * - login endpoints rely on the WeChat uuid cookie round-trip, no JWT needed;
 * - mp endpoints authenticate with the auth-key (X-Auth-Key header or auth-key cookie),
 *   which also serves the Python ascan fetcher.
 */
import { Router, Request, Response } from "express";
import {
  confirmLogin,
  getAccountInfo,
  getLoginQrcode,
  listArticles,
  logout,
  pollScan,
  searchAccounts,
  startLogin,
} from "../services/wechat/service.js";

export const wechatRouter = Router();

function browserCookie(req: Request): string {
  return req.headers.cookie || "";
}

function authKeyOf(req: Request): string {
  const header = req.headers["x-auth-key"];
  if (typeof header === "string" && header) return header;
  const match = /(?:^|;\s*)auth-key=([^;]+)/.exec(req.headers.cookie || "");
  return match ? decodeURIComponent(match[1]) : "";
}

// ── 登录流程 ──────────────────────────────────────────────────

wechatRouter.post("/login/start/:sid", async (req: Request, res: Response) => {
  const { body, setCookies } = await startLogin(String(req.params.sid), browserCookie(req));
  for (const cookie of setCookies) {
    // 微信下发的 uuid cookie 原样透传（去掉 Domain/Secure 以便本地 http 环境可用）
    const sanitized = cookie
      .split(";")
      .map((s) => s.trim())
      .filter((s) => !/^(domain|secure)/i.test(s))
      .join("; ");
    res.append("Set-Cookie", sanitized);
  }
  res.json(body);
});

wechatRouter.get("/login/qrcode", async (req: Request, res: Response) => {
  const { buffer, contentType } = await getLoginQrcode(browserCookie(req));
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
});

wechatRouter.get("/login/scan", async (req: Request, res: Response) => {
  res.json(await pollScan(browserCookie(req)));
});

wechatRouter.post("/login/confirm", async (req: Request, res: Response) => {
  const result = await confirmLogin(browserCookie(req));
  res.append(
    "Set-Cookie",
    `auth-key=${result.authKey}; Path=/; Expires=${new Date(result.expiresAt).toUTCString()}; HttpOnly`,
  );
  res.json(result);
});

wechatRouter.post("/logout", async (req: Request, res: Response) => {
  const authKey = authKeyOf(req);
  if (authKey) await logout(authKey);
  res.append("Set-Cookie", "auth-key=; Path=/; Max-Age=0; HttpOnly");
  res.json({ ok: true });
});

// ── 登录态接口 ────────────────────────────────────────────────

wechatRouter.get("/mp/info", async (req: Request, res: Response) => {
  res.json(await getAccountInfo(authKeyOf(req)));
});

wechatRouter.get("/mp/search", async (req: Request, res: Response) => {
  const keyword = String(req.query.keyword || "");
  const begin = parseInt(String(req.query.begin || "0"), 10) || 0;
  const size = parseInt(String(req.query.size || "5"), 10) || 5;
  res.json(await searchAccounts(authKeyOf(req), keyword, begin, size));
});

wechatRouter.get("/mp/articles", async (req: Request, res: Response) => {
  const fakeid = String(req.query.id || "");
  if (!fakeid) {
    res.status(400).json({ base_resp: { ret: -1, err_msg: "missing id (fakeid)" } });
    return;
  }
  const begin = parseInt(String(req.query.begin || "0"), 10) || 0;
  const size = parseInt(String(req.query.size || "5"), 10) || 5;
  const keyword = String(req.query.keyword || "");
  res.json(await listArticles(authKeyOf(req), fakeid, begin, size, keyword));
});
