import { Router } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { config } from "../config.js";
import { eq } from "drizzle-orm";

const router = Router();

function issueToken(userId: string): string {
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: "30d" });
}

// POST /auth/dev-token
// Name-based local login — the only auth method for self-hosted NoteOne.
// No Apple Sign In, no multi-device sync: each installation is standalone.
router.post("/dev-token", async (req, res) => {
  const name = (req.body?.name || "").trim() || "User";
  const appleId = "local-" + name.toLowerCase().replace(/\s+/g, "-");

  let user = await db.query.users.findFirst({
    where: eq(users.appleId, appleId),
  });

  if (!user) {
    const [created] = await db.insert(users).values({
      appleId,
      email: `${appleId}@local`,
      name,
    }).returning();
    user = created;
  }

  const token = issueToken(user.id);
  console.log(`[auth] local-login status=ok userId=${user.id.slice(0, 8)} name=${name}`);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

export { router as authRouter };
