import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies so we can test the rendering logic in isolation.
vi.mock("../db/client.js", () => ({
  db: {
    query: {
      dailyReports: { findFirst: vi.fn() },
      notes: { findMany: vi.fn() },
    },
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("../db/schema.js", () => ({
  notes: { userId: "user_id", status: "status", createdAt: "created_at", id: "id" },
  noteTags: { noteId: "note_id", tagId: "tag_id" },
  tags: { id: "id", name: "name" },
  dailyReports: { id: "id", userId: "user_id", date: "date" },
  eq: vi.fn((a: any, b: any) => ({ col: a, val: b })),
  and: vi.fn((...args: any[]) => ({ and: args })),
  gte: vi.fn((a: any, b: any) => ({ col: a, val: b })),
  lte: vi.fn((a: any, b: any) => ({ col: a, val: b })),
  ne: vi.fn((a: any, b: any) => ({ col: a, val: b })),
  inArray: vi.fn((a: any, b: any) => ({ col: a, val: b })),
  desc: vi.fn((a: any) => ({ desc: a })),
  sql: vi.fn(),
}));
vi.mock("./llm.js", () => ({
  generateEmbedding: vi.fn(),
}));
vi.mock("./notty/agent-loop.js", () => ({
  runAgentLoop: vi.fn(),
}));
vi.mock("./web-search.js", () => ({
  searchWeb: vi.fn(async () => []),
  fetchSearchResult: vi.fn(async () => ""),
}));
vi.mock("./web-fetch.js", () => ({
  fetchUrlContent: vi.fn(async () => ({ title: "", content: "", error: "mocked" })),
}));
vi.mock("./user-config.js", () => ({
  getUserChatConfig: vi.fn(async () => ({ apiKey: "", baseUrl: "", model: "" })),
}));

import { db } from "../db/client.js";

// Import after mocks so the module picks up the mocked dependencies.
import { generateDailyReport } from "./report-generator.js";

describe("generateDailyReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns existing completed report (idempotent)", async () => {
    const existingReport = {
      id: "report-1",
      status: "completed",
      htmlContent: "<html>existing</html>",
      date: "2026-06-16",
    };
    (db.query.dailyReports.findFirst as any).mockResolvedValue(existingReport);

    const result = await generateDailyReport("user-1", "2026-06-16");
    expect(result.id).toBe("report-1");
    expect(result.status).toBe("completed");
    expect(result.htmlContent).toBe("<html>existing</html>");
  });

  it("generates empty report when no notes exist for the date", async () => {
    // No existing report
    (db.query.dailyReports.findFirst as any).mockResolvedValue(undefined);
    // No notes today
    (db.query.notes.findMany as any).mockResolvedValue([]);
    // Insert returns the new report
    (db.insert as any).mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: "report-new", status: "generating" }]),
      })),
    });
    // Update returns chain
    (db.update as any).mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(async () => {}),
      })),
    });

    const result = await generateDailyReport("user-1", "2026-06-16", "minimal", "brief");
    expect(result.status).toBe("completed");
    expect(result.htmlContent).toContain("安静的一天");
    expect(result.htmlContent).toContain("<!DOCTYPE html>");
  });

  it("regenerates when existing report is in failed state", async () => {
    const failedReport = {
      id: "report-failed",
      status: "failed",
      htmlContent: null,
      date: "2026-06-16",
    };
    (db.query.dailyReports.findFirst as any).mockResolvedValue(failedReport);
    // No notes today
    (db.query.notes.findMany as any).mockResolvedValue([]);
    // Delete mock
    (db.delete as any).mockReturnValue({
      where: vi.fn(async () => {}),
    });
    // Insert returns the new report
    (db.insert as any).mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: "report-new", status: "generating" }]),
      })),
    });
    // Update returns chain
    (db.update as any).mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(async () => {}),
      })),
    });

    const result = await generateDailyReport("user-1", "2026-06-16");
    expect(db.delete).toHaveBeenCalled();
    expect(result.status).toBe("completed");
  });

  it("renders all four style variants", async () => {
    (db.query.dailyReports.findFirst as any).mockResolvedValue(undefined);
    (db.query.notes.findMany as any).mockResolvedValue([]);
    (db.insert as any).mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: "report-style", status: "generating" }]),
      })),
    });
    (db.update as any).mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(async () => {}),
      })),
    });

    const styles = ["minimal", "academic", "dashboard", "handwritten"] as const;
    for (const style of styles) {
      const result = await generateDailyReport("user-1", "2026-06-16", style, "brief");
      expect(result.htmlContent).toContain(`style-${style}`);
      expect(result.htmlContent).toContain("<!DOCTYPE html>");
    }
  });

  it("renders all three depth variants", async () => {
    (db.query.dailyReports.findFirst as any).mockResolvedValue(undefined);
    (db.query.notes.findMany as any).mockResolvedValue([]);
    (db.insert as any).mockReturnValue({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: "report-depth", status: "generating" }]),
      })),
    });
    (db.update as any).mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(async () => {}),
      })),
    });

    const depths = ["brief", "deep", "action"] as const;
    for (const depth of depths) {
      const result = await generateDailyReport("user-1", "2026-06-16", "minimal", depth);
      expect(result.htmlContent).toContain(`depth-${depth}`);
    }
  });
});
