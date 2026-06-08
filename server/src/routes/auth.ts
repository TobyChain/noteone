import { Router } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { config } from "../config.js";
import { eq } from "drizzle-orm";

const router = Router();

router.post("/apple", async (req, res) => {
  const { appleId, email, name } = req.body;
  if (!appleId) {
    res.status(400).json({ error: "appleId is required" });
    return;
  }

  let user = await db.query.users.findFirst({
    where: eq(users.appleId, appleId),
  });

  if (!user) {
    const [created] = await db.insert(users).values({
      appleId,
      email: email || null,
      name: name || null,
    }).returning();
    user = created;
  }

  const token = jwt.sign({ userId: user.id }, config.jwtSecret, {
    expiresIn: "30d",
  });

  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

export { router as authRouter };
