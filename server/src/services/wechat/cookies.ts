/**
 * Set-Cookie parsing helpers for the WeChat MP session store (pure, no I/O).
 */

export interface CookieEntity {
  name: string;
  value: string;
}

export function parseSetCookies(setCookies: string[]): CookieEntity[] {
  const map = new Map<string, CookieEntity>();
  for (const raw of setCookies) {
    const parts = raw.split(";").map((s) => s.trim());
    const [nameValue] = parts;
    if (!nameValue) continue;
    const eqIdx = nameValue.indexOf("=");
    if (eqIdx <= 0) continue;
    const name = nameValue.slice(0, eqIdx).trim();
    const value = nameValue.slice(eqIdx + 1).trim();
    map.set(name, { name, value });
  }
  return Array.from(map.values());
}

export function cookieHeaderFrom(cookies: CookieEntity[]): string {
  return cookies
    .filter((c) => c.value && c.value !== "EXPIRED")
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}
