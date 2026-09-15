import { describe, expect, it } from "vitest";
import { enabledModuleNames, moduleNames, selectMergeModules } from "./index.js";

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

  it("falls back to the current order when a saved order only contains removed modules", () => {
    expect(selectMergeModules(["wechat"], ["github", "blog"]))
      .toEqual(["blog", "github"]);
  });
});

describe("enabledModuleNames", () => {
  it("drops removed modules instead of falling back to every module", () => {
    expect(enabledModuleNames({ enabled_modules: ["wechat"] })).toEqual([]);
  });

  it("keeps valid modules while discarding removed ones", () => {
    expect(enabledModuleNames({ enabled_modules: ["wechat", "github"] })).toEqual(["github"]);
  });
});
