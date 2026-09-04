import { describe, expect, it } from "vitest";
import { hasReportArtifact } from "./reports.js";
import {
  isNewLoreReportEntry,
  selectImportedNewLoreConfig,
  selectImportedNewLoreHistory,
} from "../../routes/import.js";

const basePayload = {
  schemaVersion: "1.2",
  notes: [],
  tags: [],
  noteTags: [],
  chatSessions: [],
};

describe("NewLore compatibility", () => {
  it("prefers current config and accepts both previous config field names", () => {
    expect(selectImportedNewLoreConfig({ ...basePayload, ascanConfig: { enabled_modules: ["arxiv"] } }))
      .toEqual({ enabled_modules: ["arxiv"] });
    expect(selectImportedNewLoreConfig({
      ...basePayload,
      newseeConfig: { enabled_modules: ["blog"] },
      ascanConfig: { enabled_modules: ["arxiv"] },
    })).toEqual({ enabled_modules: ["blog"] });
    expect(selectImportedNewLoreConfig({
      ...basePayload,
      newloreConfig: { enabled_modules: ["github"] },
      newseeConfig: { enabled_modules: ["blog"] },
    })).toEqual({ enabled_modules: ["github"] });
  });

  it("accepts history and report paths from all three naming generations", () => {
    const legacyHistory = { papers: [{ arxivId: "1" }] };
    expect(selectImportedNewLoreHistory({ ...basePayload, ascanHistory: legacyHistory }))
      .toEqual(legacyHistory);
    expect(isNewLoreReportEntry("newlore-reports/NewLore-20260904.html")).toBe(true);
    expect(isNewLoreReportEntry("newsee-reports/NewSee-20260904.md")).toBe(true);
    expect(isNewLoreReportEntry("ascan-reports/Ascan-20260904.summary")).toBe(true);
    expect(isNewLoreReportEntry("newlore-reports/../../escape.html")).toBe(false);
  });

  it("checks Markdown sidecars for the same report date only", () => {
    const files = ["NewLore-20260903.md", "NewSee-20260904.html"];
    expect(hasReportArtifact(files, "20260904", "md")).toBe(false);
    expect(hasReportArtifact([...files, "Ascan-20260904.md"], "20260904", "md")).toBe(true);
  });
});
