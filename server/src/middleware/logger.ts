import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

function safeRequestTarget(req: Request): string {
  const url = new URL(req.originalUrl, "http://localhost");
  for (const key of ["token", "auth-key", "api_key", "access_token"]) {
    if (url.searchParams.has(key)) url.searchParams.set(key, "[redacted]");
  }
  return url.pathname + url.search;
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/health") { next(); return; }

  const start = Date.now();

  let userId = "anon";
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), config.jwtSecret) as { userId: string };
      userId = payload.userId.slice(0, 8);
    } catch {
      userId = "invalid";
    }
  }

  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[request] ${req.method} ${safeRequestTarget(req)} userId=${userId} → ${res.statusCode} ${duration}ms`,
    );
  });

  next();
}
