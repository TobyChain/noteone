import { describe, expect, it } from "vitest";
import { moduleNames, selectMergeModules } from "./index.js";

describe("selectMergeModules", () => {
  it("uses all modules only when active modules are omitted", () => {
    expect(selectMergeModules()).toEqual(moduleNames());
  });

  it("keeps an explicitly empty module set empty", () => {
    expect(selectMergeModules(undefined, [])).toEqual([]);
  });

  it("preserves configured order while filtering disabled modules", () => {
    expect(selectMergeModules(["blog", "arxiv", "github"], ["github", "blog"]))
      .toEqual(["blog", "github"]);
  });
});
