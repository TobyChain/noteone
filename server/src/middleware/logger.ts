import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

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
      `[request] ${req.method} ${req.originalUrl} userId=${userId} → ${res.statusCode} ${duration}ms`,
    );
  });

  next();
}
