import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, getTestDb, integrationEnabled, resetTables } from "../../test/db.js";
import { db } from "../../db/client.js";
import { farviewSnapshots, newloreBlogPosts, newloreGithubRepos, newlorePapers } from "../../db/schema.js";
import { getFarViewStatus, getLatestFarViewSnapshot, loadFarViewSourceItems, refreshFarView } from "./service.js";

describe.skipIf(!integrationEnabled)("FarView persistence", () => {
  beforeAll(() => { getTestDb(); });
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it("loads multiple sources, persists a snapshot, and replaces the same week idempotently", async () => {
    await db.insert(newlorePapers).values(Array.from({ length: 4 }, (_, index) => ({
      arxivId: `2609.0000${index + 1}`, title: "Agent Harness Reliability", abstract: "Reliable agent harness",
      absUrl: `https://arxiv.org/abs/2609.0000${index + 1}`, published: "2026-06-02", firstSeenDate: "2026-09-02", keywords: ["agent harness"],
    })));
    await db.insert(newloreGithubRepos).values(Array.from({ length: 2 }, (_, index) => ({
      fullName: `demo/agent-harness-${index}`, owner: "demo", name: `agent-harness-${index}`,
      description: "Agent harness reliability", topics: ["agent-harness"],
      url: `https://github.com/demo/agent-harness-${index}`, firstSeenDate: "2026-09-03",
    })));
    await db.insert(newloreBlogPosts).values(Array.from({ length: 2 }, (_, index) => ({
      source: "demo", slug: `agent-harness-${index}`, url: `https://example.com/agent-harness-${index}`,
      title: "Agent Harness Reliability", summary: "Reliable agent harness", firstSeenDate: "2026-09-04",
    })));

    const items = await loadFarViewSourceItems("2026-09-04");
    expect(new Set(items.map((item) => item.sourceType))).toEqual(new Set(["paper", "github", "blog"]));
    const first = await refreshFarView("2026-09-04");
    const second = await refreshFarView("2026-09-04");
    expect(second).toEqual(first);
    expect((await getLatestFarViewSnapshot())?.topics.some((topic) => topic.name === "agent harness")).toBe(true);
    expect((await getFarViewStatus()).periodStart).toBe("2026-08-29");
  });

  it("does not expose a legacy ten-week payload as a seven-day ranking", async () => {
    await db.insert(farviewSnapshots).values({
      weekStart: "2026-08-31", sourceThrough: "2026-09-04", status: "completed",
      payload: { weekStart: "2026-08-31", windowStart: "2026-06-29", topics: [] },
    });

    expect(await getLatestFarViewSnapshot()).toBeNull();
    expect((await getFarViewStatus()).periodStart).toBeNull();
  });
});
