import { Router } from "express";
import jwt from "jsonwebtoken";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { config } from "../config.js";
import { eq } from "drizzle-orm";

const router = Router();

// Apple's public keys for verifying the identityToken signature.
// createRemoteJWKSet caches keys and refreshes on rotation.
const APPLE_JWKS = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys"),
);

function issueToken(userId: string): string {
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: "30d" });
}

// POST /auth/apple
// Verifies the Apple identityToken (a signed JWT) against Apple's JWKS instead of
// trusting a client-supplied appleId. The stable user id is taken from the verified `sub`.
router.post("/apple", async (req, res) => {
  const { identityToken, email, name } = req.body ?? {};
  if (!identityToken || typeof identityToken !== "string") {
    res.status(400).json({ error: "identityToken is required" });
    return;
  }

  let appleId: string;
  let tokenEmail: string | null = null;
  try {
    const { payload } = await jwtVerify(identityToken, APPLE_JWKS, {
      issuer: "https://appleid.apple.com",
      audience: config.apple.clientIds,
    });
    if (!payload.sub) {
      res.status(401).json({ error: "Invalid Apple token: missing subject" });
      return;
    }
    appleId = payload.sub;
    if (typeof payload.email === "string") tokenEmail = payload.email;
  } catch {
    res.status(401).json({ error: "Invalid Apple identity token" });
    return;
  }

  let user = await db.query.users.findFirst({
    where: eq(users.appleId, appleId),
  });

  if (!user) {
    const [created] = await db.insert(users).values({
      appleId,
      // prefer the verified email from the token; fall back to client-provided on first sign-in
      email: tokenEmail || email || null,
      name: name || null,
    }).returning();
    user = created;
  }

  const token = issueToken(user.id);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

// POST /auth/dev-token — local development only, gated behind ENABLE_DEV_LOGIN
router.post("/dev-token", async (req, res) => {
  if (!config.enableDevLogin) {
    res.status(403).json({ error: "dev-token disabled" });
    return;
  }

  const name = req.body.name || "Dev User";
  const appleId = "dev-" + name.toLowerCase().replace(/\s+/g, "-");

  let user = await db.query.users.findFirst({
    where: eq(users.appleId, appleId),
  });

  if (!user) {
    const [created] = await db.insert(users).values({
      appleId,
      email: `${appleId}@dev.local`,
      name,
    }).returning();
    user = created;
  }

  const token = issueToken(user.id);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

export { router as authRouter };
