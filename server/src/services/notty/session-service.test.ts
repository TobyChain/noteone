import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runAgentLoop: vi.fn(),
  insertValues: vi.fn(async () => undefined),
  transaction: vi.fn(),
}));

vi.mock("../../db/client.js", () => ({
  db: {
    query: {
      chatSessions: { findFirst: vi.fn(async () => ({ id: "session-1", userId: "user-1", title: null })) },
      chatMessages: { findMany: vi.fn(async () => []) },
    },
    insert: vi.fn(() => ({ values: mocks.insertValues })),
    update: vi.fn(),
    transaction: mocks.transaction,
  },
}));

vi.mock("../llm.js", () => ({
  chatCompletion: vi.fn(),
  isLLMConfigured: () => true,
}));

vi.mock("../user-config.js", () => ({
  getUserChatConfig: vi.fn(async () => ({ baseUrl: "http://test", apiKey: "key", model: "model" })),
  getUserLanguage: vi.fn(async () => "zh"),
}));

vi.mock("../context-manager.js", () => ({
  trimToTokenBudget: (messages: unknown[]) => messages,
  sanitizeToolMessageGroups: (messages: unknown[]) => messages,
  needsCompaction: () => false,
  getProtectionZone: () => 20,
  buildSummarizationPrompt: vi.fn(),
}));

vi.mock("./prompt-builder.js", () => ({
  buildNoteIndex: vi.fn(async () => ({ allNotes: [], version: "empty" })),
  buildStableSystemPrompt: () => "system",
  buildDynamicContext: () => "context",
}));

vi.mock("./tools.js", () => ({
  buildNottyToolkit: () => ({ tools: [], handlers: {} }),
}));

vi.mock("./agent-loop.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-loop.js")>();
  return { ...actual, runAgentLoop: mocks.runAgentLoop };
});

import { AgentLoopAbortError } from "./agent-loop.js";
import { processSessionMessage } from "./session-service.js";

describe("processSessionMessage cancellation", () => {
  beforeEach(() => {
    mocks.runAgentLoop.mockReset();
    mocks.insertValues.mockClear();
    mocks.transaction.mockReset();
  });

  it("does not persist a normal assistant reply after the client stops", async () => {
    const controller = new AbortController();
    mocks.runAgentLoop.mockImplementationOnce(async () => {
      controller.abort();
      return "must not be persisted";
    });

    await expect(processSessionMessage(
      "user-1",
      "session-1",
      "stop this",
      controller.signal,
    )).rejects.toBeInstanceOf(AgentLoopAbortError);

    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
