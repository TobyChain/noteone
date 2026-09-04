import { describe, expect, it } from "vitest";
import { buildFarViewSnapshot, extractPhrases, type FarViewSourceItem } from "./engine.js";

const item = (partial: Partial<FarViewSourceItem> & Pick<FarViewSourceItem, "sourceId" | "observedDate">): FarViewSourceItem => ({
  sourceType: "paper", title: "Agent Harness for Reliable AI Agents", summary: "Agent harness evaluation",
  ...partial,
});

describe("FarView seven-day heat engine", () => {
  it("deduplicates phrases and normalizes explicit aliases", () => {
    const phrases = extractPhrases(item({ sourceId: "1", observedDate: "2026-09-02", keywords: ["AI Agents"] }));
    expect(phrases.filter((value) => value === "ai agent")).toHaveLength(1);
    expect(phrases).toContain("agent harness");
    expect(new Set(phrases).size).toBe(phrases.length);
  });

  it("filters generic words, source boilerplate, versions, numbers, and URLs", () => {
    const phrases = extractPhrases(item({
      sourceId: "noise", observedDate: "2026-09-02",
      title: "New Study v2.4: Click Here for 2026 Results",
      summary: "Read more at https://example.com about this research method",
      keywords: ["model", "12345", "official blog", "retrieval augmented generation"],
    }));
    expect(phrases).toContain("rag");
    expect(phrases).not.toEqual(expect.arrayContaining([
      "new", "study", "model", "12345", "official blog", "click here", "read more", "2 4",
    ]));
  });

  it("filters grammatical fragments and merges common LLM variants", () => {
    const phrases = extractPhrases(item({
      sourceId: "language", observedDate: "2026-09-02",
      title: "Large language models do more rather than less",
      summary: "This language model does not require more training", keywords: ["LLMs"],
    }));
    expect(phrases.filter((value) => value === "llm")).toHaveLength(1);
    expect(phrases).not.toEqual(expect.arrayContaining([
      "large language", "language models", "models llms", "language models llms",
      "does not", "rather than", "are increasingly", "existing methods", "extensive experiments",
    ]));
  });

  it("includes exactly the seven calendar days ending at the requested date", () => {
    const snapshot = buildFarViewSnapshot([
      item({ sourceId: "inside-start", observedDate: "2026-08-29", keywords: ["agent harness"] }),
      item({ sourceType: "github", sourceId: "inside-end", observedDate: "2026-09-04", keywords: ["agent harness"] }),
      item({ sourceId: "too-old", observedDate: "2026-08-28", keywords: ["agent harness"] }),
      item({ sourceId: "future", observedDate: "2026-09-05", keywords: ["agent harness"] }),
    ], "2026-09-04", { minimumCount: 2 });

    expect(snapshot.periodDays).toBe(7);
    expect(snapshot.periodStart).toBe("2026-08-29");
    expect(snapshot.periodEnd).toBe("2026-09-04");
    expect(snapshot.totalItems).toBe(2);
    expect(snapshot.topics.find((topic) => topic.name === "agent harness")?.currentCount).toBe(2);
  });

  it("uses the local calendar day when the requested endpoint is a Date", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "Asia/Shanghai";
    try {
      const snapshot = buildFarViewSnapshot([
        item({ sourceId: "local-today", observedDate: "2026-09-05", keywords: ["agent harness"] }),
      ], new Date("2026-09-04T16:30:00.000Z"), { minimumCount: 1 });
      expect(snapshot.periodEnd).toBe("2026-09-05");
      expect(snapshot.totalItems).toBe(1);
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it("returns a deterministic top ten ordered by weekly heat", () => {
    const items = Array.from({ length: 12 }, (_, topicIndex) => [
      item({ sourceId: `p-${topicIndex}`, observedDate: "2026-09-02", title: `Topic ${String.fromCharCode(65 + topicIndex)} Signal`, summary: "", keywords: [`topic-${topicIndex}`] }),
      item({ sourceType: "github", sourceId: `g-${topicIndex}`, observedDate: "2026-09-03", title: `Topic ${String.fromCharCode(65 + topicIndex)} Signal`, summary: "", keywords: [`topic-${topicIndex}`] }),
    ]).flat();
    items.push(item({ sourceType: "blog", sourceId: "boost", observedDate: "2026-09-04", keywords: ["topic-0"] }));

    const first = buildFarViewSnapshot(items, "2026-09-04", { minimumCount: 2, limit: 50 });
    const second = buildFarViewSnapshot([...items].reverse(), "2026-09-04", { minimumCount: 2, limit: 50 });
    expect(first).toEqual(second);
    expect(first.topics).toHaveLength(10);
    expect(first.topics[0].name).toBe("topic-0");
  });

  it("keeps one nested phrase when identical items support both candidates", () => {
    const snapshot = buildFarViewSnapshot([
      item({ sourceId: "one", observedDate: "2026-09-02", title: "Vector Database Search", summary: "" }),
      item({ sourceType: "github", sourceId: "two", observedDate: "2026-09-03", title: "Vector Database Search", summary: "" }),
    ], "2026-09-04", { minimumCount: 2 });
    const overlapping = snapshot.topics.filter((topic) =>
      topic.name === "vector database" || topic.name === "vector database search",
    );
    expect(overlapping).toHaveLength(1);
  });

  it("normalizes source volume and selects diverse representatives", () => {
    const items = [
      ...Array.from({ length: 20 }, (_, index) => item({
        sourceType: "paper", sourceId: `paper-${index}`, observedDate: "2026-09-02",
        title: index < 4 ? "Sparse Topic" : `Background Item ${index}`, summary: "",
        keywords: index < 4 ? ["sparse topic"] : [`background-${index}`],
      })),
      item({ sourceType: "blog", sourceId: "blog-1", observedDate: "2026-09-02", title: "Sparse Topic", summary: "", keywords: ["sparse topic"] }),
      item({ sourceType: "github", sourceId: "github-1", observedDate: "2026-09-02", title: "Sparse Topic", summary: "", keywords: ["sparse topic"] }),
    ];
    const topic = buildFarViewSnapshot(items, "2026-09-04", { minimumCount: 3 })
      .topics.find((candidate) => candidate.name === "sparse topic");
    expect(topic?.currentCount).toBe(6);
    expect(topic?.normalizedHeat).toBeGreaterThan(0.7);
    expect(topic?.sourceDiversity).toBe(3);
    expect(new Set(topic?.representatives.map((entry) => entry.sourceType)).size).toBe(3);
  });

  it("excludes configured topics and pervasive template phrases", () => {
    const items = Array.from({ length: 20 }, (_, index) => item({
      sourceType: index % 2 ? "github" : "paper", sourceId: `item-${index}`, observedDate: "2026-09-03",
      title: "Weekly Digest", summary: "", keywords: ["weekly digest", index < 4 ? "useful topic" : `specific-${index}`],
    }));
    const snapshot = buildFarViewSnapshot(items, "2026-09-04", {
      minimumCount: 2, blockedTopics: ["useful topic"],
    });
    expect(snapshot.topics.map((topic) => topic.name)).not.toEqual(
      expect.arrayContaining(["weekly digest", "useful topic"]),
    );
  });
});
