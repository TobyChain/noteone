# NoteOne Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-executing-plans to implement this plan task-by-task.

**Goal:** Build NoteOne — a multi-platform note capture + AI tagging + MCP-powered writing assistant application.

**Architecture:** Node.js/TypeScript RESTful API backed by PostgreSQL + pgvector. SwiftUI native apps for iOS and macOS with Share Extension and global hotkey capture. MCP Server exposes notes to external AI for deep writing. AI tagging pipeline uses Qwen models (configurable via user API keys).

**Tech Stack:** Node.js 20+, TypeScript 5+, Express, PostgreSQL 16 + pgvector, Drizzle ORM, Vitest, SwiftUI (iOS 17+ / macOS 14+), MCP SDK (@modelcontextprotocol/sdk), Docker Compose.

**Design Doc:** `docs/design/2026-06-08-noteone-design.md`

---

## Phase 1: Backend Foundation (Server + Database)

### Task 1.1: Initialize Node.js Project

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/.env.example`
- Create: `server/.gitignore`

**Step 1: Create project directory and initialize**

```bash
cd /Users/bingtao/documents/ai.alibaba/noteone
mkdir -p server
cd server
```

```json
// server/package.json
{
  "name": "noteone-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest",
    "test:run": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "express": "^5.1.0",
    "drizzle-orm": "^0.44.0",
    "postgres": "^3.4.5",
    "jsonwebtoken": "^9.0.2",
    "zod": "^3.24.0",
    "dotenv": "^16.5.0",
    "uuid": "^11.1.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/jsonwebtoken": "^9.0.9",
    "@types/uuid": "^10.0.0",
    "drizzle-kit": "^0.31.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.2.0"
  }
}
```

```json
// server/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

```bash
# server/.env.example
DATABASE_URL=postgres://noteone:noteone@localhost:5432/noteone
JWT_SECRET=change-me-in-production
PORT=3000
QWEN_API_KEY=your-qwen-api-key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

**Step 2: Install dependencies**

Run: `cd server && npm install`
Expected: `node_modules` created, `package-lock.json` generated.

**Step 3: Commit**

```bash
git init
git add .
git commit -m "chore: initialize noteone server project"
```

---

### Task 1.2: Database Schema with Drizzle ORM

**Files:**
- Create: `server/src/db/schema.ts`
- Create: `server/src/db/client.ts`
- Create: `server/drizzle.config.ts`

**Step 1: Write the database schema**

```typescript
// server/src/db/schema.ts
import { pgTable, pgEnum, text, timestamp, uuid, real, boolean, jsonb, index, vector } from "drizzle-orm/pg-core";

export const contentTypeEnum = pgEnum("content_type", [
  "text", "image", "video", "link", "mixed",
]);

export const noteStatusEnum = pgEnum("note_status", [
  "pending_ai", "active", "archived",
]);

export const tagDimensionEnum = pgEnum("tag_dimension", [
  "format", "topic", "domain", "module",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  appleId: text("apple_id").unique().notNull(),
  email: text("email"),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  contentType: contentTypeEnum("content_type").notNull().default("text"),
  title: text("title"),
  content: text("content").notNull(),
  rawContent: jsonb("raw_content"),
  sourceUrl: text("source_url"),
  sourceApp: text("source_app"),
  author: text("author"),
  authorOrg: text("author_org"),
  aiSummary: text("ai_summary"),
  embedding: vector("embedding", { dimensions: 1536 }),
  status: noteStatusEnum("status").notNull().default("pending_ai"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("notes_user_id_idx").on(table.userId),
  index("notes_status_idx").on(table.status),
  index("notes_created_at_idx").on(table.createdAt),
]);

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  dimension: tagDimensionEnum("dimension").notNull(),
  parentId: uuid("parent_id").references((): any => tags.id),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("tags_dimension_idx").on(table.dimension),
  index("tags_parent_id_idx").on(table.parentId),
]);

export const noteTags = pgTable("note_tags", {
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  confidence: real("confidence"),
  isManual: boolean("is_manual").notNull().default(false),
}, (table) => [
  index("note_tags_note_id_idx").on(table.noteId),
  index("note_tags_tag_id_idx").on(table.tagId),
]);
```

**Step 2: Write the database client**

```typescript
// server/src/db/client.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL!;
const sql = postgres(connectionString);
export const db = drizzle(sql, { schema });
export { sql };
```

**Step 3: Write Drizzle config**

```typescript
// server/drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

**Step 4: Commit**

```bash
git add server/src/db server/drizzle.config.ts
git commit -m "feat: add database schema with Drizzle ORM"
```

---

### Task 1.3: Docker Compose for Development

**Files:**
- Create: `docker-compose.yml`

**Step 1: Write Docker Compose file**

```yaml
# docker-compose.yml
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: noteone
      POSTGRES_PASSWORD: noteone
      POSTGRES_DB: noteone
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

**Step 2: Start the database**

Run: `docker compose up -d db`
Expected: PostgreSQL with pgvector running on port 5432.

**Step 3: Generate and run migrations**

```bash
cd server
cp .env.example .env
npx drizzle-kit generate
npx drizzle-kit migrate
```

Expected: Tables created in PostgreSQL.

**Step 4: Verify tables exist**

Run: `docker compose exec db psql -U noteone -c "\dt"`
Expected: users, notes, tags, note_tags tables listed.

**Step 5: Commit**

```bash
git add docker-compose.yml server/drizzle/
git commit -m "feat: add Docker Compose and run initial migration"
```

---

### Task 1.4: Express Server + Health Check

**Files:**
- Create: `server/src/index.ts`
- Create: `server/src/config.ts`
- Create: `server/tests/health.test.ts`

**Step 1: Write the config module**

```typescript
// server/src/config.ts
import "dotenv/config";

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  databaseUrl: process.env.DATABASE_URL!,
  jwtSecret: process.env.JWT_SECRET!,
  qwen: {
    apiKey: process.env.QWEN_API_KEY || "",
    baseUrl: process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
};
```

**Step 2: Write the failing test**

```typescript
// server/tests/health.test.ts
import { describe, it, expect } from "vitest";

describe("Health Check", () => {
  it("GET /health returns 200 with status ok", async () => {
    const res = await fetch("http://localhost:3000/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});
```

**Step 3: Run test to verify it fails**

Run: `cd server && npx vitest run tests/health.test.ts`
Expected: FAIL — server not running.

**Step 4: Write the Express server**

```typescript
// server/src/index.ts
import express from "express";
import { config } from "./config.js";

const app = express();

app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(config.port, () => {
  console.log(`NoteOne server running on port ${config.port}`);
});

export { app };
```

**Step 5: Start server and run test**

Run (terminal 1): `cd server && npm run dev`
Run (terminal 2): `cd server && npx vitest run tests/health.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add server/src/index.ts server/src/config.ts server/tests/
git commit -m "feat: add Express server with health check"
```

---

### Task 1.5: JWT Authentication Middleware

**Files:**
- Create: `server/src/middleware/auth.ts`
- Create: `server/src/routes/auth.ts`
- Create: `server/tests/auth.test.ts`

**Step 1: Write the failing test**

```typescript
// server/tests/auth.test.ts
import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { config } from "../src/config.js";

const BASE = "http://localhost:3000";

describe("Auth", () => {
  it("rejects requests without token", async () => {
    const res = await fetch(`${BASE}/api/notes`);
    expect(res.status).toBe(401);
  });

  it("rejects requests with invalid token", async () => {
    const res = await fetch(`${BASE}/api/notes`, {
      headers: { Authorization: "Bearer invalid-token" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts requests with valid token", async () => {
    const token = jwt.sign(
      { userId: "00000000-0000-0000-0000-000000000001" },
      config.jwtSecret,
    );
    const res = await fetch(`${BASE}/api/notes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).not.toBe(401);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/auth.test.ts`
Expected: FAIL

**Step 3: Write auth middleware**

```typescript
// server/src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface AuthRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing authorization token" });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}
```

**Step 4: Write auth routes (Apple Sign In token exchange)**

```typescript
// server/src/routes/auth.ts
import { Router } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { config } from "../config.js";
import { eq } from "drizzle-orm";

const router = Router();

// POST /auth/apple — exchange Apple identity token for JWT
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
```

**Step 5: Wire middleware and routes into Express app**

Update `server/src/index.ts`:

```typescript
// server/src/index.ts
import express from "express";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { requireAuth } from "./middleware/auth.js";

const app = express();

app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/auth", authRouter);

// All /api routes require authentication
app.use("/api", requireAuth);

// Placeholder so auth test can hit /api/notes
app.get("/api/notes", (_req, res) => {
  res.json({ notes: [] });
});

app.listen(config.port, () => {
  console.log(`NoteOne server running on port ${config.port}`);
});

export { app };
```

**Step 6: Run tests**

Run: `cd server && npx vitest run tests/auth.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add server/src/middleware/ server/src/routes/auth.ts server/src/index.ts server/tests/auth.test.ts
git commit -m "feat: add JWT auth middleware and Apple Sign In route"
```

---

### Task 1.6: Notes CRUD API

**Files:**
- Create: `server/src/routes/notes.ts`
- Create: `server/tests/notes.test.ts`

**Step 1: Write the failing tests**

```typescript
// server/tests/notes.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import jwt from "jsonwebtoken";
import { config } from "../src/config.js";

const BASE = "http://localhost:3000";
const userId = "00000000-0000-0000-0000-000000000001";
let token: string;

beforeAll(() => {
  token = jwt.sign({ userId }, config.jwtSecret);
});

function auth() {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

describe("Notes CRUD", () => {
  let noteId: string;

  it("POST /api/notes creates a note", async () => {
    const res = await fetch(`${BASE}/api/notes`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({
        content: "FlashAttention reduces memory IO to O(N)",
        contentType: "text",
        sourceUrl: "https://arxiv.org/abs/2205.14135",
        sourceApp: "Safari",
        author: "Tri Dao",
        authorOrg: "Stanford",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.note.id).toBeDefined();
    expect(body.note.content).toBe("FlashAttention reduces memory IO to O(N)");
    expect(body.note.status).toBe("pending_ai");
    noteId = body.note.id;
  });

  it("GET /api/notes lists user notes", async () => {
    const res = await fetch(`${BASE}/api/notes`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes.length).toBeGreaterThan(0);
  });

  it("GET /api/notes/:id returns a single note", async () => {
    const res = await fetch(`${BASE}/api/notes/${noteId}`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.note.id).toBe(noteId);
  });

  it("PATCH /api/notes/:id updates a note", async () => {
    const res = await fetch(`${BASE}/api/notes/${noteId}`, {
      method: "PATCH",
      headers: auth(),
      body: JSON.stringify({ title: "FlashAttention Paper" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.note.title).toBe("FlashAttention Paper");
  });

  it("DELETE /api/notes/:id deletes a note", async () => {
    const res = await fetch(`${BASE}/api/notes/${noteId}`, {
      method: "DELETE",
      headers: auth(),
    });
    expect(res.status).toBe(200);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/notes.test.ts`
Expected: FAIL

**Step 3: Write notes routes**

```typescript
// server/src/routes/notes.ts
import { Router } from "express";
import { db } from "../db/client.js";
import { notes } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";
import { z } from "zod";

const router = Router();

const createNoteSchema = z.object({
  content: z.string().min(1),
  contentType: z.enum(["text", "image", "video", "link", "mixed"]).default("text"),
  title: z.string().optional(),
  sourceUrl: z.string().optional(),
  sourceApp: z.string().optional(),
  author: z.string().optional(),
  authorOrg: z.string().optional(),
  rawContent: z.any().optional(),
});

const updateNoteSchema = z.object({
  content: z.string().min(1).optional(),
  title: z.string().optional(),
  sourceUrl: z.string().optional(),
  author: z.string().optional(),
  authorOrg: z.string().optional(),
  status: z.enum(["pending_ai", "active", "archived"]).optional(),
});

// POST /api/notes
router.post("/", async (req: AuthRequest, res) => {
  const parsed = createNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const [note] = await db.insert(notes).values({
    userId: req.userId!,
    ...parsed.data,
  }).returning();

  // TODO: queue AI tagging job here (Task 2.x)

  res.status(201).json({ note });
});

// GET /api/notes
router.get("/", async (req: AuthRequest, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  const result = await db.query.notes.findMany({
    where: eq(notes.userId, req.userId!),
    orderBy: desc(notes.createdAt),
    limit,
    offset,
  });

  res.json({ notes: result, limit, offset });
});

// GET /api/notes/:id
router.get("/:id", async (req: AuthRequest, res) => {
  const note = await db.query.notes.findFirst({
    where: and(eq(notes.id, req.params.id), eq(notes.userId, req.userId!)),
  });

  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.json({ note });
});

// PATCH /api/notes/:id
router.patch("/:id", async (req: AuthRequest, res) => {
  const parsed = updateNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const [note] = await db.update(notes)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(notes.id, req.params.id), eq(notes.userId, req.userId!)))
    .returning();

  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.json({ note });
});

// DELETE /api/notes/:id
router.delete("/:id", async (req: AuthRequest, res) => {
  const [note] = await db.delete(notes)
    .where(and(eq(notes.id, req.params.id), eq(notes.userId, req.userId!)))
    .returning();

  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.json({ deleted: true });
});

export { router as notesRouter };
```

**Step 4: Wire notes routes into Express app**

Update `server/src/index.ts` — replace the placeholder `/api/notes` with:

```typescript
import { notesRouter } from "./routes/notes.js";
// ... after app.use("/api", requireAuth);
app.use("/api/notes", requireAuth, notesRouter);
```

Remove the placeholder `app.get("/api/notes", ...)`.

**Step 5: Run tests**

Run: `cd server && npx vitest run tests/notes.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add server/src/routes/notes.ts server/src/index.ts server/tests/notes.test.ts
git commit -m "feat: add notes CRUD API"
```

---

### Task 1.7: Tags CRUD API

**Files:**
- Create: `server/src/routes/tags.ts`
- Create: `server/tests/tags.test.ts`

**Step 1: Write the failing tests**

```typescript
// server/tests/tags.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import jwt from "jsonwebtoken";
import { config } from "../src/config.js";

const BASE = "http://localhost:3000";
let token: string;

beforeAll(() => {
  token = jwt.sign({ userId: "00000000-0000-0000-0000-000000000001" }, config.jwtSecret);
});

function auth() {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

describe("Tags API", () => {
  let parentTagId: string;
  let childTagId: string;

  it("POST /api/tags creates a top-level tag", async () => {
    const res = await fetch(`${BASE}/api/tags`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ name: "科技", dimension: "topic" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tag.name).toBe("科技");
    parentTagId = body.tag.id;
  });

  it("POST /api/tags creates a child tag", async () => {
    const res = await fetch(`${BASE}/api/tags`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ name: "LLM", dimension: "domain", parentId: parentTagId }),
    });
    expect(res.status).toBe(201);
    childTagId = body.tag.id;
  });

  it("GET /api/tags lists tags by dimension", async () => {
    const res = await fetch(`${BASE}/api/tags?dimension=topic`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags.some((t: any) => t.name === "科技")).toBe(true);
  });

  it("GET /api/tags lists all tags without filter", async () => {
    const res = await fetch(`${BASE}/api/tags`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags.length).toBeGreaterThanOrEqual(2);
  });
});
```

**Step 2: Write tags routes**

```typescript
// server/src/routes/tags.ts
import { Router } from "express";
import { db } from "../db/client.js";
import { tags } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const createTagSchema = z.object({
  name: z.string().min(1),
  dimension: z.enum(["format", "topic", "domain", "module"]),
  parentId: z.string().uuid().optional(),
  description: z.string().optional(),
});

// POST /api/tags
router.post("/", async (req, res) => {
  const parsed = createTagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const [tag] = await db.insert(tags).values(parsed.data).returning();
  res.status(201).json({ tag });
});

// GET /api/tags
router.get("/", async (req, res) => {
  const dimension = req.query.dimension as string | undefined;
  const where = dimension ? eq(tags.dimension, dimension as any) : undefined;

  const result = await db.query.tags.findMany({ where });
  res.json({ tags: result });
});

export { router as tagsRouter };
```

**Step 3: Wire tags routes in `server/src/index.ts`**

```typescript
import { tagsRouter } from "./routes/tags.js";
app.use("/api/tags", requireAuth, tagsRouter);
```

**Step 4: Run tests**

Run: `cd server && npx vitest run tests/tags.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/routes/tags.ts server/tests/tags.test.ts server/src/index.ts
git commit -m "feat: add tags CRUD API with dimension filtering"
```

---

### Task 1.8: Note-Tag Association API

**Files:**
- Modify: `server/src/routes/notes.ts`
- Create: `server/tests/note-tags.test.ts`

**Step 1: Write the failing test**

```typescript
// server/tests/note-tags.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import jwt from "jsonwebtoken";
import { config } from "../src/config.js";

const BASE = "http://localhost:3000";
let token: string;
let noteId: string;
let tagId: string;

beforeAll(async () => {
  token = jwt.sign({ userId: "00000000-0000-0000-0000-000000000001" }, config.jwtSecret);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const noteRes = await fetch(`${BASE}/api/notes`, {
    method: "POST", headers,
    body: JSON.stringify({ content: "test note for tagging" }),
  });
  noteId = (await noteRes.json()).note.id;

  const tagRes = await fetch(`${BASE}/api/tags`, {
    method: "POST", headers,
    body: JSON.stringify({ name: "AI", dimension: "topic" }),
  });
  tagId = (await tagRes.json()).tag.id;
});

describe("Note-Tag Association", () => {
  it("POST /api/notes/:id/tags attaches a tag", async () => {
    const res = await fetch(`${BASE}/api/notes/${noteId}/tags`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tagId, confidence: 0.95 }),
    });
    expect(res.status).toBe(201);
  });

  it("GET /api/notes/:id includes tags", async () => {
    const res = await fetch(`${BASE}/api/notes/${noteId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(body.note.tags).toBeDefined();
    expect(body.note.tags.length).toBe(1);
    expect(body.note.tags[0].name).toBe("AI");
  });
});
```

**Step 2: Add tag association endpoints to notes router**

Add to `server/src/routes/notes.ts`:

```typescript
import { noteTags, tags } from "../db/schema.js";

// POST /api/notes/:id/tags
router.post("/:id/tags", async (req: AuthRequest, res) => {
  const { tagId, confidence, isManual } = req.body;

  const note = await db.query.notes.findFirst({
    where: and(eq(notes.id, req.params.id), eq(notes.userId, req.userId!)),
  });
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  await db.insert(noteTags).values({
    noteId: req.params.id,
    tagId,
    confidence: confidence ?? null,
    isManual: isManual ?? false,
  });

  res.status(201).json({ attached: true });
});
```

Update the `GET /:id` handler to include tags via a join query.

**Step 3: Run tests**

Run: `cd server && npx vitest run tests/note-tags.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add server/src/routes/notes.ts server/tests/note-tags.test.ts
git commit -m "feat: add note-tag association API"
```

---

## Phase 2: AI Pipeline (Tagging + Embedding + Search)

### Task 2.1: LLM Abstraction Layer

**Files:**
- Create: `server/src/services/llm.ts`
- Create: `server/tests/llm.test.ts`

**Step 1: Write LLM abstraction**

```typescript
// server/src/services/llm.ts
import { config } from "../config.js";

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function getDefaultLLMConfig(): LLMConfig {
  return {
    apiKey: config.qwen.apiKey,
    baseUrl: config.qwen.baseUrl,
    model: "qwen-turbo",
  };
}

export async function chatCompletion(
  messages: Array<{ role: string; content: string }>,
  llmConfig?: LLMConfig,
): Promise<string> {
  const cfg = llmConfig ?? getDefaultLLMConfig();

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

export async function generateEmbedding(
  text: string,
  llmConfig?: LLMConfig,
): Promise<number[]> {
  const cfg = llmConfig ?? getDefaultLLMConfig();

  const res = await fetch(`${cfg.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-v3",
      input: text,
      dimensions: 1536,
    }),
  });

  if (!res.ok) {
    throw new Error(`Embedding API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.data[0].embedding;
}
```

**Step 2: Write a basic unit test (mocked)**

```typescript
// server/tests/llm.test.ts
import { describe, it, expect } from "vitest";
import { getDefaultLLMConfig } from "../src/services/llm.js";

describe("LLM Service", () => {
  it("returns default config from environment", () => {
    const cfg = getDefaultLLMConfig();
    expect(cfg.baseUrl).toContain("dashscope");
    expect(cfg.model).toBe("qwen-turbo");
  });
});
```

**Step 3: Run test**

Run: `cd server && npx vitest run tests/llm.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add server/src/services/llm.ts server/tests/llm.test.ts
git commit -m "feat: add LLM abstraction layer for Qwen API"
```

---

### Task 2.2: AI Tagging Service

**Files:**
- Create: `server/src/services/tagging.ts`
- Create: `server/tests/tagging.test.ts`

**Step 1: Write the tagging service**

```typescript
// server/src/services/tagging.ts
import { chatCompletion, LLMConfig } from "./llm.js";
import { db } from "../db/client.js";
import { tags, noteTags } from "../db/schema.js";
import { eq } from "drizzle-orm";

interface TagResult {
  dimension: "format" | "topic" | "domain" | "module";
  name: string;
  confidence: number;
}

export async function tagNote(
  noteId: string,
  content: string,
  contentType: string,
  llmConfig?: LLMConfig,
): Promise<TagResult[]> {
  const prompt = `分析以下内容，返回 JSON 数组格式的多维度标签。

每个标签需包含：
- dimension: "format"(格式) | "topic"(主题) | "domain"(领域) | "module"(模块)
- name: 标签名（中文）
- confidence: 置信度 0-1

规则：
1. format 标签基于内容类型：文本/图片/视频/链接/混合
2. topic 标签是大类：科技/财经/教育/文化/生活等
3. domain 标签是 topic 下的细分领域
4. module 标签是 domain 下的具体模块/技术点

内容类型: ${contentType}
内容: ${content.slice(0, 2000)}

仅返回 JSON 数组，不要其他文字：`;

  const result = await chatCompletion(
    [{ role: "user", content: prompt }],
    llmConfig,
  );

  const parsed: TagResult[] = JSON.parse(result.replace(/```json?\n?/g, "").replace(/```/g, "").trim());

  for (const tagResult of parsed) {
    let existingTag = await db.query.tags.findFirst({
      where: eq(tags.name, tagResult.name),
    });

    if (!existingTag) {
      const [created] = await db.insert(tags).values({
        name: tagResult.name,
        dimension: tagResult.dimension,
      }).returning();
      existingTag = created;
    }

    await db.insert(noteTags).values({
      noteId,
      tagId: existingTag.id,
      confidence: tagResult.confidence,
      isManual: false,
    }).onConflictDoNothing();
  }

  return parsed;
}
```

**Step 2: Write unit test for parsing logic**

```typescript
// server/tests/tagging.test.ts
import { describe, it, expect } from "vitest";

describe("Tagging Service", () => {
  it("parses tag result JSON correctly", () => {
    const mockResponse = `[
      {"dimension": "format", "name": "文本", "confidence": 1.0},
      {"dimension": "topic", "name": "科技", "confidence": 0.9},
      {"dimension": "domain", "name": "人工智能", "confidence": 0.85}
    ]`;

    const parsed = JSON.parse(mockResponse);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].dimension).toBe("format");
    expect(parsed[1].name).toBe("科技");
  });
});
```

**Step 3: Run test**

Run: `cd server && npx vitest run tests/tagging.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add server/src/services/tagging.ts server/tests/tagging.test.ts
git commit -m "feat: add AI tagging service with multi-dimension labels"
```

---

### Task 2.3: AI Summary + Embedding Service

**Files:**
- Create: `server/src/services/enrichment.ts`

**Step 1: Write the enrichment service**

```typescript
// server/src/services/enrichment.ts
import { chatCompletion, generateEmbedding, LLMConfig } from "./llm.js";
import { db } from "../db/client.js";
import { notes } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

export async function enrichNote(
  noteId: string,
  content: string,
  contentType: string,
  llmConfig?: LLMConfig,
): Promise<void> {
  const [summary, title, embedding] = await Promise.all([
    generateSummary(content, llmConfig),
    generateTitle(content, llmConfig),
    generateEmbedding(content, llmConfig),
  ]);

  await db.update(notes)
    .set({
      aiSummary: summary,
      title: sql`COALESCE(${notes.title}, ${title})`,
      embedding: embedding,
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(notes.id, noteId));
}

async function generateSummary(content: string, llmConfig?: LLMConfig): Promise<string> {
  return chatCompletion(
    [{ role: "user", content: `用一句话总结以下内容（不超过100字）：\n\n${content.slice(0, 3000)}` }],
    llmConfig,
  );
}

async function generateTitle(content: string, llmConfig?: LLMConfig): Promise<string> {
  return chatCompletion(
    [{ role: "user", content: `为以下内容生成一个简短的标题（不超过30字）：\n\n${content.slice(0, 2000)}` }],
    llmConfig,
  );
}
```

**Step 2: Commit**

```bash
git add server/src/services/enrichment.ts
git commit -m "feat: add note enrichment service (summary, title, embedding)"
```

---

### Task 2.4: Async AI Processing Pipeline

**Files:**
- Create: `server/src/services/pipeline.ts`
- Modify: `server/src/routes/notes.ts`

**Step 1: Write the pipeline orchestrator**

```typescript
// server/src/services/pipeline.ts
import { tagNote } from "./tagging.js";
import { enrichNote } from "./enrichment.js";
import { LLMConfig } from "./llm.js";

export async function processNote(
  noteId: string,
  content: string,
  contentType: string,
  llmConfig?: LLMConfig,
): Promise<void> {
  try {
    await Promise.all([
      tagNote(noteId, content, contentType, llmConfig),
      enrichNote(noteId, content, contentType, llmConfig),
    ]);
    console.log(`[pipeline] Note ${noteId} processed successfully`);
  } catch (error) {
    console.error(`[pipeline] Error processing note ${noteId}:`, error);
  }
}
```

**Step 2: Wire pipeline into note creation**

In `server/src/routes/notes.ts`, after `db.insert(notes)`, add:

```typescript
import { processNote } from "../services/pipeline.js";

// Inside POST / handler, after insert:
// Fire and forget — don't block the response
processNote(note.id, note.content, note.contentType).catch(console.error);
```

**Step 3: Commit**

```bash
git add server/src/services/pipeline.ts server/src/routes/notes.ts
git commit -m "feat: add async AI processing pipeline on note creation"
```

---

### Task 2.5: Semantic Search API

**Files:**
- Create: `server/src/routes/search.ts`
- Create: `server/tests/search.test.ts`

**Step 1: Write search route**

```typescript
// server/src/routes/search.ts
import { Router } from "express";
import { db, sql as pgSql } from "../db/client.js";
import { notes, noteTags, tags } from "../db/schema.js";
import { eq, and, desc, sql, ilike, inArray } from "drizzle-orm";
import { generateEmbedding } from "../services/llm.js";
import { AuthRequest } from "../middleware/auth.js";

const router = Router();

// POST /api/search
router.post("/", async (req: AuthRequest, res) => {
  const { query, tags: tagFilters, contentType, dateRange, limit = 20 } = req.body;

  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  const queryEmbedding = await generateEmbedding(query);

  const results = await db.execute(sql`
    SELECT
      n.id, n.title, n.content, n.content_type, n.source_url,
      n.source_app, n.author, n.author_org, n.ai_summary,
      n.created_at, n.updated_at,
      1 - (n.embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as similarity
    FROM notes n
    WHERE n.user_id = ${req.userId}
      AND n.status = 'active'
      AND n.embedding IS NOT NULL
    ORDER BY n.embedding <=> ${JSON.stringify(queryEmbedding)}::vector
    LIMIT ${limit}
  `);

  res.json({ results: results.rows });
});

export { router as searchRouter };
```

**Step 2: Wire search route in `server/src/index.ts`**

```typescript
import { searchRouter } from "./routes/search.js";
app.use("/api/search", requireAuth, searchRouter);
```

**Step 3: Commit**

```bash
git add server/src/routes/search.ts server/src/index.ts
git commit -m "feat: add semantic search API with pgvector"
```

---

## Phase 3: MCP Server

### Task 3.1: Initialize MCP Server Project

**Files:**
- Create: `mcp-server/package.json`
- Create: `mcp-server/tsconfig.json`
- Create: `mcp-server/src/index.ts`

**Step 1: Create project**

```json
// mcp-server/package.json
{
  "name": "noteone-mcp-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "noteone-mcp": "dist/index.js" },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Write MCP server with tools**

```typescript
// mcp-server/src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.NOTEONE_API_URL || "http://localhost:3000";
const API_TOKEN = process.env.NOTEONE_TOKEN || "";

async function apiCall(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_TOKEN}`,
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

const server = new McpServer({
  name: "noteone",
  version: "0.1.0",
});

server.tool(
  "search_notes",
  "搜索笔记 — 语义检索 + 标签过滤。返回与查询最相关的笔记列表，含来源、作者和日期信息。",
  {
    query: z.string().describe("搜索关键词（语义匹配）"),
    tags: z.array(z.string()).optional().describe("标签名过滤"),
    content_type: z.string().optional().describe("格式过滤: text/image/video/link"),
    limit: z.number().optional().default(20).describe("返回数量上限"),
  },
  async ({ query, tags, content_type, limit }) => {
    const data = await apiCall("/api/search", {
      method: "POST",
      body: JSON.stringify({ query, tags, contentType: content_type, limit }),
    });
    return { content: [{ type: "text", text: JSON.stringify(data.results, null, 2) }] };
  },
);

server.tool(
  "get_note",
  "获取单条笔记的完整内容和元数据",
  { id: z.string().describe("笔记 ID") },
  async ({ id }) => {
    const data = await apiCall(`/api/notes/${id}`);
    return { content: [{ type: "text", text: JSON.stringify(data.note, null, 2) }] };
  },
);

server.tool(
  "list_tags",
  "列出所有标签，按维度（格式/主题/领域/模块）分组",
  {
    dimension: z.enum(["format", "topic", "domain", "module"]).optional().describe("按维度过滤"),
  },
  async ({ dimension }) => {
    const query = dimension ? `?dimension=${dimension}` : "";
    const data = await apiCall(`/api/tags${query}`);
    return { content: [{ type: "text", text: JSON.stringify(data.tags, null, 2) }] };
  },
);

server.tool(
  "get_stats",
  "获取笔记统计信息（数量、主题分布、时间趋势）",
  {
    from: z.string().optional().describe("起始日期 YYYY-MM-DD"),
    to: z.string().optional().describe("结束日期 YYYY-MM-DD"),
  },
  async ({ from, to }) => {
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    const data = await apiCall(`/api/stats?${query}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "get_topic_summary",
  "按主题获取笔记摘要集，用于写作时快速了解某个领域的积累",
  {
    topic: z.string().describe("主题关键词"),
    max_notes: z.number().optional().default(10).describe("最大笔记数量"),
  },
  async ({ topic, max_notes }) => {
    const data = await apiCall("/api/search", {
      method: "POST",
      body: JSON.stringify({ query: topic, limit: max_notes }),
    });
    const summaries = data.results.map((n: any) => ({
      id: n.id,
      title: n.title,
      summary: n.ai_summary,
      source: n.source_url,
      author: n.author,
      date: n.created_at,
    }));
    return { content: [{ type: "text", text: JSON.stringify(summaries, null, 2) }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("NoteOne MCP Server running on stdio");
}

main().catch(console.error);
```

**Step 3: Install dependencies and build**

```bash
cd mcp-server && npm install && npm run build
```

**Step 4: Commit**

```bash
git add mcp-server/
git commit -m "feat: add MCP server with search, notes, tags, stats tools"
```

---

### Task 3.2: MCP Server Configuration File

**Files:**
- Create: `mcp-server/README.md`

**Step 1: Write usage instructions**

```markdown
# NoteOne MCP Server

## Claude Desktop 配置

在 `~/Library/Application Support/Claude/claude_desktop_config.json` 中添加:

​```json
{
  "mcpServers": {
    "noteone": {
      "command": "node",
      "args": ["/path/to/noteone/mcp-server/dist/index.js"],
      "env": {
        "NOTEONE_API_URL": "http://localhost:3000",
        "NOTEONE_TOKEN": "your-jwt-token"
      }
    }
  }
}
​```

## 可用工具

- `search_notes` — 语义搜索笔记
- `get_note` — 获取单条笔记
- `list_tags` — 列出标签
- `get_stats` — 笔记统计
- `get_topic_summary` — 按主题获取摘要集
```

**Step 2: Commit**

```bash
git add mcp-server/README.md
git commit -m "docs: add MCP server setup instructions"
```

---

## Phase 4: macOS App

### Task 4.1: Create Xcode Project Structure

**Files:**
- Create: `apple/NoteOne/` (Xcode project with multiplatform target)

**Step 1: Create Xcode project**

Use Xcode to create a new multiplatform SwiftUI app:
- Product Name: `NoteOne`
- Team: (your team)
- Organization Identifier: (your identifier)
- Interface: SwiftUI
- Language: Swift
- Platforms: iOS, macOS

Save to `apple/NoteOne/`.

**Step 2: Set up shared directory structure**

```
apple/NoteOne/
├── NoteOne.xcodeproj
├── NoteOne/
│   ├── NoteOneApp.swift          # App entry point
│   ├── ContentView.swift
│   ├── Models/
│   │   ├── Note.swift            # Data model
│   │   └── Tag.swift
│   ├── Services/
│   │   ├── APIClient.swift       # HTTP client
│   │   ├── AuthService.swift     # Apple Sign In + JWT
│   │   └── SyncQueue.swift       # Offline queue
│   ├── Views/
│   │   ├── NoteListView.swift
│   │   ├── NoteDetailView.swift
│   │   ├── CaptureView.swift     # Quick capture UI
│   │   └── SettingsView.swift
│   ├── macOS/
│   │   ├── GlobalHotkey.swift    # ⌘⇧N handler
│   │   ├── FloatingPanel.swift   # Floating capture window
│   │   └── AppDelegate.swift
│   └── iOS/
│       └── ShareExtension/
│           ├── ShareViewController.swift
│           └── Info.plist
```

**Step 3: Commit**

```bash
git add apple/
git commit -m "feat: scaffold Xcode project structure"
```

---

### Task 4.2: Data Models (Swift)

**Files:**
- Create: `apple/NoteOne/NoteOne/Models/Note.swift`
- Create: `apple/NoteOne/NoteOne/Models/Tag.swift`

**Step 1: Write Note model**

```swift
// apple/NoteOne/NoteOne/Models/Note.swift
import Foundation

enum ContentType: String, Codable, CaseIterable {
    case text, image, video, link, mixed
}

enum NoteStatus: String, Codable {
    case pendingAi = "pending_ai"
    case active
    case archived
}

struct Note: Codable, Identifiable {
    let id: String
    var contentType: ContentType
    var title: String?
    var content: String
    var sourceUrl: String?
    var sourceApp: String?
    var author: String?
    var authorOrg: String?
    var aiSummary: String?
    var status: NoteStatus
    var tags: [NoteTag]?
    var createdAt: Date
    var updatedAt: Date
}

struct NoteTag: Codable {
    let tagId: String
    let name: String
    let dimension: String
    let confidence: Double?
    let isManual: Bool
}

struct CreateNoteRequest: Codable {
    let content: String
    var contentType: String = "text"
    var title: String?
    var sourceUrl: String?
    var sourceApp: String?
    var author: String?
    var authorOrg: String?
}
```

**Step 2: Write Tag model**

```swift
// apple/NoteOne/NoteOne/Models/Tag.swift
import Foundation

enum TagDimension: String, Codable, CaseIterable {
    case format, topic, domain, module
}

struct Tag: Codable, Identifiable {
    let id: String
    var name: String
    var dimension: TagDimension
    var parentId: String?
    var description: String?
}
```

**Step 3: Commit**

```bash
git add apple/NoteOne/NoteOne/Models/
git commit -m "feat: add Swift data models for Note and Tag"
```

---

### Task 4.3: API Client (Swift)

**Files:**
- Create: `apple/NoteOne/NoteOne/Services/APIClient.swift`

**Step 1: Write the API client**

```swift
// apple/NoteOne/NoteOne/Services/APIClient.swift
import Foundation

actor APIClient {
    static let shared = APIClient()

    private var baseURL: URL
    private var token: String?

    private init() {
        self.baseURL = URL(string: "http://localhost:3000")!
    }

    func configure(baseURL: String, token: String) {
        self.baseURL = URL(string: baseURL)!
        self.token = token
    }

    // MARK: - Notes

    func createNote(_ request: CreateNoteRequest) async throws -> Note {
        let data: [String: Any] = try await post("/api/notes", body: request)
        return data["note"] as! Note
    }

    func listNotes(limit: Int = 50, offset: Int = 0) async throws -> [Note] {
        let data: NoteListResponse = try await get("/api/notes?limit=\(limit)&offset=\(offset)")
        return data.notes
    }

    func getNote(id: String) async throws -> Note {
        let data: NoteResponse = try await get("/api/notes/\(id)")
        return data.note
    }

    // MARK: - Search

    func searchNotes(query: String, limit: Int = 20) async throws -> [Note] {
        let body = SearchRequest(query: query, limit: limit)
        let data: SearchResponse = try await post("/api/search", body: body)
        return data.results
    }

    // MARK: - Private

    private func get<T: Decodable>(_ path: String) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.setValue("Bearer \(token ?? "")", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder.noteoneDecoder.decode(T.self, from: data)
    }

    private func post<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token ?? "")", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder.noteoneDecoder.decode(T.self, from: data)
    }
}

private struct NoteListResponse: Decodable { let notes: [Note] }
private struct NoteResponse: Decodable { let note: Note }
private struct SearchRequest: Encodable { let query: String; let limit: Int }
private struct SearchResponse: Decodable { let results: [Note] }

extension JSONDecoder {
    static let noteoneDecoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}
```

**Step 2: Commit**

```bash
git add apple/NoteOne/NoteOne/Services/APIClient.swift
git commit -m "feat: add Swift API client for NoteOne backend"
```

---

### Task 4.4: Offline Sync Queue

**Files:**
- Create: `apple/NoteOne/NoteOne/Services/SyncQueue.swift`

**Step 1: Write sync queue**

```swift
// apple/NoteOne/NoteOne/Services/SyncQueue.swift
import Foundation

actor SyncQueue {
    static let shared = SyncQueue()

    private let fileURL: URL
    private var queue: [CreateNoteRequest] = []

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NoteOne", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.fileURL = dir.appendingPathComponent("sync_queue.json")
        self.queue = (try? JSONDecoder().decode([CreateNoteRequest].self, from: Data(contentsOf: fileURL))) ?? []
    }

    func enqueue(_ request: CreateNoteRequest) {
        queue.append(request)
        persist()
    }

    func flush() async {
        guard !queue.isEmpty else { return }
        var failed: [CreateNoteRequest] = []

        for item in queue {
            do {
                _ = try await APIClient.shared.createNote(item)
            } catch {
                failed.append(item)
            }
        }

        queue = failed
        persist()
    }

    var pendingCount: Int { queue.count }

    private func persist() {
        try? JSONEncoder().encode(queue).write(to: fileURL)
    }
}
```

**Step 2: Commit**

```bash
git add apple/NoteOne/NoteOne/Services/SyncQueue.swift
git commit -m "feat: add offline sync queue for note capture"
```

---

### Task 4.5: macOS Global Hotkey + Floating Capture Window

**Files:**
- Create: `apple/NoteOne/NoteOne/macOS/GlobalHotkey.swift`
- Create: `apple/NoteOne/NoteOne/macOS/FloatingPanel.swift`
- Create: `apple/NoteOne/NoteOne/Views/CaptureView.swift`

**Step 1: Write FloatingPanel**

```swift
// apple/NoteOne/NoteOne/macOS/FloatingPanel.swift
#if os(macOS)
import AppKit
import SwiftUI

class FloatingPanel: NSPanel {
    init(contentView: NSView) {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 480, height: 320),
            styleMask: [.titled, .closable, .fullSizeContentView, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        self.isFloatingPanel = true
        self.level = .floating
        self.titleVisibility = .hidden
        self.titlebarAppearsTransparent = true
        self.isMovableByWindowBackground = true
        self.backgroundColor = .clear
        self.contentView = contentView
        self.center()
    }
}
#endif
```

**Step 2: Write GlobalHotkey**

```swift
// apple/NoteOne/NoteOne/macOS/GlobalHotkey.swift
#if os(macOS)
import AppKit
import Carbon
import SwiftUI

class HotkeyManager {
    static let shared = HotkeyManager()
    private var panel: FloatingPanel?

    func register() {
        NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            // ⌘⇧N
            if event.modifierFlags.contains([.command, .shift]) && event.keyCode == 45 {
                DispatchQueue.main.async { self?.togglePanel() }
            }
        }
    }

    private func togglePanel() {
        if let panel = panel, panel.isVisible {
            panel.close()
            self.panel = nil
        } else {
            let view = NSHostingView(rootView: CaptureView(onDismiss: { [weak self] in
                self?.panel?.close()
                self?.panel = nil
            }))
            let panel = FloatingPanel(contentView: view)
            panel.makeKeyAndOrderFront(nil)
            self.panel = panel
        }
    }
}
#endif
```

**Step 3: Write CaptureView (shared between macOS floating panel and iOS)**

```swift
// apple/NoteOne/NoteOne/Views/CaptureView.swift
import SwiftUI

struct CaptureView: View {
    @State private var content: String = ""
    @State private var sourceUrl: String = ""
    @State private var isSaving = false
    var onDismiss: (() -> Void)?

    var body: some View {
        VStack(spacing: 16) {
            Text("顺手记").font(.headline)

            TextEditor(text: $content)
                .frame(minHeight: 100)
                .border(Color.secondary.opacity(0.3))

            TextField("来源链接（可选）", text: $sourceUrl)
                .textFieldStyle(.roundedBorder)

            HStack {
                Button("取消") { onDismiss?() }
                    .keyboardShortcut(.escape)

                Spacer()

                Button("保存") { save() }
                    .keyboardShortcut(.return)
                    .disabled(content.isEmpty || isSaving)
            }
        }
        .padding()
        .frame(width: 460)
        .onAppear { pasteFromClipboard() }
    }

    private func pasteFromClipboard() {
        #if os(macOS)
        if let text = NSPasteboard.general.string(forType: .string) {
            content = text
        }
        #endif
    }

    private func save() {
        isSaving = true
        let request = CreateNoteRequest(
            content: content,
            sourceUrl: sourceUrl.isEmpty ? nil : sourceUrl
        )

        Task {
            do {
                _ = try await APIClient.shared.createNote(request)
            } catch {
                await SyncQueue.shared.enqueue(request)
            }
            isSaving = false
            onDismiss?()
        }
    }
}
```

**Step 4: Commit**

```bash
git add apple/NoteOne/NoteOne/macOS/ apple/NoteOne/NoteOne/Views/CaptureView.swift
git commit -m "feat: add macOS global hotkey and floating capture window"
```

---

### Task 4.6: macOS Main Interface (Note List + Detail)

**Files:**
- Create: `apple/NoteOne/NoteOne/Views/NoteListView.swift`
- Create: `apple/NoteOne/NoteOne/Views/NoteDetailView.swift`
- Modify: `apple/NoteOne/NoteOne/ContentView.swift`

**Step 1: Write NoteListView**

```swift
// apple/NoteOne/NoteOne/Views/NoteListView.swift
import SwiftUI

struct NoteListView: View {
    @State private var notes: [Note] = []
    @State private var searchText = ""
    @State private var selectedNote: Note?

    var body: some View {
        NavigationSplitView {
            List(notes, selection: $selectedNote) { note in
                VStack(alignment: .leading, spacing: 4) {
                    Text(note.title ?? "无标题")
                        .font(.headline)
                        .lineLimit(1)
                    Text(note.aiSummary ?? note.content)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                    if let tags = note.tags {
                        HStack {
                            ForEach(tags.prefix(3), id: \.tagId) { tag in
                                Text(tag.name)
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(.blue.opacity(0.1))
                                    .cornerRadius(4)
                            }
                        }
                    }
                }
                .padding(.vertical, 4)
            }
            .searchable(text: $searchText, prompt: "搜索笔记...")
            .onSubmit(of: .search) { searchNotes() }
            .navigationTitle("NoteOne")
        } detail: {
            if let note = selectedNote {
                NoteDetailView(note: note)
            } else {
                Text("选择一条笔记").foregroundColor(.secondary)
            }
        }
        .task { await loadNotes() }
    }

    private func loadNotes() async {
        do {
            notes = try await APIClient.shared.listNotes()
        } catch {
            print("Failed to load notes: \(error)")
        }
    }

    private func searchNotes() {
        Task {
            do {
                notes = try await APIClient.shared.searchNotes(query: searchText)
            } catch {
                print("Search failed: \(error)")
            }
        }
    }
}
```

**Step 2: Write NoteDetailView**

```swift
// apple/NoteOne/NoteOne/Views/NoteDetailView.swift
import SwiftUI

struct NoteDetailView: View {
    let note: Note

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(note.title ?? "无标题")
                    .font(.title)

                if let summary = note.aiSummary {
                    Text(summary)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .padding()
                        .background(.gray.opacity(0.1))
                        .cornerRadius(8)
                }

                Divider()

                Text(note.content)
                    .font(.body)

                Divider()

                // Meta info
                Group {
                    if let url = note.sourceUrl {
                        Label(url, systemImage: "link")
                    }
                    if let author = note.author {
                        Label(author, systemImage: "person")
                    }
                    if let org = note.authorOrg {
                        Label(org, systemImage: "building.2")
                    }
                    Label(note.createdAt.formatted(), systemImage: "calendar")
                }
                .font(.caption)
                .foregroundColor(.secondary)

                // Tags
                if let tags = note.tags {
                    FlowLayout(spacing: 8) {
                        ForEach(tags, id: \.tagId) { tag in
                            Text(tag.name)
                                .font(.caption)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(colorForDimension(tag.dimension))
                                .cornerRadius(6)
                        }
                    }
                }
            }
            .padding()
        }
    }

    private func colorForDimension(_ dimension: String) -> Color {
        switch dimension {
        case "format": return .blue.opacity(0.15)
        case "topic": return .green.opacity(0.15)
        case "domain": return .orange.opacity(0.15)
        case "module": return .purple.opacity(0.15)
        default: return .gray.opacity(0.15)
        }
    }
}
```

**Step 3: Commit**

```bash
git add apple/NoteOne/NoteOne/Views/
git commit -m "feat: add note list and detail views for macOS/iOS"
```

---

## Phase 5: iOS App (Share Extension)

### Task 5.1: iOS Share Extension

**Files:**
- Create: `apple/NoteOne/ShareExtension/ShareViewController.swift`
- Create: `apple/NoteOne/ShareExtension/Info.plist`

**Step 1: Add Share Extension target in Xcode**

In Xcode: File → New → Target → Share Extension. Name: `NoteOneShare`.

**Step 2: Write ShareViewController**

```swift
// apple/NoteOne/ShareExtension/ShareViewController.swift
import UIKit
import Social
import UniformTypeIdentifiers

class ShareViewController: SLComposeServiceViewController {

    override func isContentValid() -> Bool {
        return !contentText.isEmpty || !extensionContext!.inputItems.isEmpty
    }

    override func didSelectPost() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachments = item.attachments else {
            extensionContext?.completeRequest(returningItems: nil)
            return
        }

        Task {
            var content = contentText ?? ""
            var sourceUrl: String?
            var contentType = "text"

            for attachment in attachments {
                if attachment.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    if let url = try? await attachment.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                        sourceUrl = url.absoluteString
                        contentType = "link"
                    }
                } else if attachment.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    if let text = try? await attachment.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                        content = text
                    }
                } else if attachment.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    contentType = "image"
                    if let url = try? await attachment.loadItem(forTypeIdentifier: UTType.image.identifier) as? URL {
                        sourceUrl = url.absoluteString
                    }
                }
            }

            let request = CreateNoteRequest(
                content: content,
                contentType: contentType,
                sourceUrl: sourceUrl
            )

            // Try API, fall back to queue
            do {
                _ = try await APIClient.shared.createNote(request)
            } catch {
                await SyncQueue.shared.enqueue(request)
            }

            extensionContext?.completeRequest(returningItems: nil)
        }
    }

    override func configurationItems() -> [Any]! {
        return []
    }
}
```

**Step 3: Configure App Group for shared data**

In Xcode, enable App Groups for both the main app and extension target. Group ID: `group.com.yourorg.noteone`.

**Step 4: Commit**

```bash
git add apple/NoteOne/ShareExtension/
git commit -m "feat: add iOS Share Extension for quick note capture"
```

---

### Task 5.2: Apple Sign In Integration

**Files:**
- Create: `apple/NoteOne/NoteOne/Services/AuthService.swift`

**Step 1: Write AuthService**

```swift
// apple/NoteOne/NoteOne/Services/AuthService.swift
import AuthenticationServices
import SwiftUI

class AuthService: NSObject, ObservableObject {
    @Published var isAuthenticated = false
    @Published var userName: String?

    func signInWithApple() {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.email, .fullName]

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.performRequests()
    }

    func signOut() {
        KeychainHelper.delete(key: "jwt_token")
        isAuthenticated = false
        userName = nil
    }
}

extension AuthService: ASAuthorizationControllerDelegate {
    func authorizationController(controller: ASAuthorizationController,
                                  didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else { return }

        let appleId = credential.user
        let email = credential.email
        let name = credential.fullName?.givenName

        Task {
            do {
                let response = try await exchangeToken(appleId: appleId, email: email, name: name)
                KeychainHelper.save(key: "jwt_token", value: response.token)
                await APIClient.shared.configure(
                    baseURL: "http://localhost:3000",
                    token: response.token
                )
                await MainActor.run {
                    isAuthenticated = true
                    userName = name
                }
            } catch {
                print("Auth failed: \(error)")
            }
        }
    }

    private func exchangeToken(appleId: String, email: String?, name: String?) async throws -> AuthResponse {
        var request = URLRequest(url: URL(string: "http://localhost:3000/auth/apple")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode([
            "appleId": appleId,
            "email": email ?? "",
            "name": name ?? "",
        ])
        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(AuthResponse.self, from: data)
    }
}

struct AuthResponse: Decodable {
    let token: String
    let user: UserInfo
}

struct UserInfo: Decodable {
    let id: String
    let name: String?
    let email: String?
}
```

**Step 2: Commit**

```bash
git add apple/NoteOne/NoteOne/Services/AuthService.swift
git commit -m "feat: add Apple Sign In authentication service"
```

---

## Phase 6: Docker Deployment

### Task 6.1: Dockerfile for Backend

**Files:**
- Create: `server/Dockerfile`
- Modify: `docker-compose.yml`

**Step 1: Write Dockerfile**

```dockerfile
# server/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/drizzle ./drizzle
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

**Step 2: Update docker-compose.yml for full stack**

```yaml
# docker-compose.yml
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: noteone
      POSTGRES_PASSWORD: noteone
      POSTGRES_DB: noteone
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  api:
    build: ./server
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://noteone:noteone@db:5432/noteone
      JWT_SECRET: ${JWT_SECRET:-change-me-in-production}
      QWEN_API_KEY: ${QWEN_API_KEY}
      QWEN_BASE_URL: ${QWEN_BASE_URL:-https://dashscope.aliyuncs.com/compatible-mode/v1}
    depends_on:
      - db

volumes:
  pgdata:
```

**Step 3: Test full stack startup**

Run: `docker compose up --build`
Expected: Both `db` and `api` services running.

Run: `curl http://localhost:3000/health`
Expected: `{"status":"ok",...}`

**Step 4: Commit**

```bash
git add server/Dockerfile docker-compose.yml
git commit -m "feat: add Docker deployment for full stack"
```

---

### Task 6.2: Stats API (for MCP)

**Files:**
- Create: `server/src/routes/stats.ts`

**Step 1: Write stats route**

```typescript
// server/src/routes/stats.ts
import { Router } from "express";
import { db } from "../db/client.js";
import { notes, noteTags, tags } from "../db/schema.js";
import { eq, and, sql, gte, lte, count } from "drizzle-orm";
import { AuthRequest } from "../middleware/auth.js";

const router = Router();

// GET /api/stats
router.get("/", async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const totalNotes = await db.select({ count: count() })
    .from(notes)
    .where(eq(notes.userId, userId));

  const byContentType = await db.select({
    contentType: notes.contentType,
    count: count(),
  })
    .from(notes)
    .where(eq(notes.userId, userId))
    .groupBy(notes.contentType);

  const topTags = await db.select({
    name: tags.name,
    dimension: tags.dimension,
    count: count(),
  })
    .from(noteTags)
    .innerJoin(tags, eq(noteTags.tagId, tags.id))
    .innerJoin(notes, and(eq(noteTags.noteId, notes.id), eq(notes.userId, userId)))
    .groupBy(tags.name, tags.dimension)
    .orderBy(sql`count(*) DESC`)
    .limit(20);

  res.json({
    totalNotes: totalNotes[0].count,
    byContentType,
    topTags,
  });
});

export { router as statsRouter };
```

**Step 2: Wire into index.ts**

```typescript
import { statsRouter } from "./routes/stats.js";
app.use("/api/stats", requireAuth, statsRouter);
```

**Step 3: Commit**

```bash
git add server/src/routes/stats.ts server/src/index.ts
git commit -m "feat: add stats API for MCP and app analytics"
```

---

## Phase Summary

| Phase | Tasks | Deliverable |
|-------|-------|-------------|
| 1. Backend Foundation | 1.1–1.8 | Express API + PostgreSQL + Auth + Notes CRUD + Tags |
| 2. AI Pipeline | 2.1–2.5 | LLM abstraction + Auto-tagging + Embedding + Semantic Search |
| 3. MCP Server | 3.1–3.2 | MCP tools for Claude integration |
| 4. macOS App | 4.1–4.6 | SwiftUI app with global hotkey + note management |
| 5. iOS App | 5.1–5.2 | Share Extension + Apple Sign In |
| 6. Docker Deploy | 6.1–6.2 | Full-stack Docker Compose + Stats API |

**Total: 20 tasks, estimated 3-4 days for backend/MCP, 1-2 weeks for native apps.**

---

## Implementation Order Recommendation

```
Phase 1 (backend) → Phase 2 (AI) → Phase 3 (MCP) → Phase 6 (Docker)
                                                          ↓
                                              Phase 4 (macOS) → Phase 5 (iOS)
```

Start with backend + AI + MCP (these are fully implementable in this environment). macOS/iOS apps require Xcode and should follow after the backend is stable.
