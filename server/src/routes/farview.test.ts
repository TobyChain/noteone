import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const service = vi.hoisted(() => ({
  getLatestFarViewSnapshot: vi.fn(),
  getFarViewTopic: vi.fn(),
  startFarViewRefresh: vi.fn(),
  getFarViewStatus: vi.fn(),
}));
vi.mock("../services/farview/service.js", () => service);
vi.mock("../services/newlore/pipeline/index.js", () => ({
  readUserPreferences: vi.fn(async () => undefined),
}));

import { farviewRouter, personalizeSnapshot } from "./farview.js";

const app = express();
app.use(express.json());
app.use("/api/farview", farviewRouter);

describe("FarView routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an explicit not-generated state", async () => {
    service.getLatestFarViewSnapshot.mockResolvedValue(null);
    const response = await request(app).get("/api/farview/overview");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ state: "not_generated", snapshot: null });
  });

  it("rejects impossible dates before starting a refresh", async () => {
    const response = await request(app).post("/api/farview/refresh").send({ through: "2026-99-99" });
    expect(response.status).toBe(400);
    expect(service.startFarViewRefresh).not.toHaveBeenCalled();
  });

  it("starts refresh asynchronously", async () => {
    service.startFarViewRefresh.mockReturnValue({ started: true });
    const response = await request(app).post("/api/farview/refresh").send({ through: "2026-09-04" });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ started: true });
  });

  it("re-ranks related topics without changing their global scores", () => {
    const snapshot = { topics: [
      { name: "computer vision", score: 10 },
      { name: "agent harness", score: 3 },
    ] };
    const personalized = personalizeSnapshot(snapshot, ["agent"]);
    expect(personalized.topics.map((topic) => topic.name)).toEqual(["agent harness", "computer vision"]);
    expect(personalized.topics.map((topic) => topic.score)).toEqual([3, 10]);
  });
});
