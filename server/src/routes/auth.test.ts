import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// In-memory user store stand-in for the DB.
const dbHoist = vi.hoisted(() => {
    const users: any[] = [];
    return {
        users,
        db: {
            query: {
                users: {
                    findFirst: vi.fn(async () =>
                        users.find((u) => u.appleId === lastQueriedAppleId.value) ?? undefined,
                    ),
                },
            },
            insert: vi.fn(() => ({
                values: vi.fn((row: any) => ({
                    returning: vi.fn(async () => {
                        const created = { id: "user-" + users.length, ...row };
                        users.push(created);
                        return [created];
                    }),
                })),
            })),
        },
    };
});
const lastQueriedAppleId = vi.hoisted(() => ({ value: "" }));
vi.mock("../db/client.js", () => ({ db: dbHoist.db }));

// drizzle's `eq(users.appleId, value)` is opaque; intercept and stash the operand for findFirst.
vi.mock("drizzle-orm", async () => {
    const actual = await vi.importActual<any>("drizzle-orm");
    return {
        ...actual,
        eq: (_col: any, value: string) => {
            lastQueriedAppleId.value = value;
            return { __eq: value };
        },
    };
});

vi.mock("../config.js", () => ({
    config: {
        jwtSecret: "test-secret-must-be-at-least-16-chars-long",
        isProd: false,
    },
}));

import { authRouter } from "./auth.js";

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use("/auth", authRouter);
    return app;
}

describe("POST /auth/dev-token", () => {
    beforeEach(() => {
        dbHoist.users.length = 0;
    });

    it("creates a new user and returns a JWT", async () => {
        const res = await request(buildApp()).post("/auth/dev-token").send({ name: "Alice" });
        expect(res.status).toBe(200);
        expect(typeof res.body.token).toBe("string");
        expect(res.body.user.name).toBe("Alice");
        expect(res.body.user.id).toBeTruthy();
    });

    it("returns the same user on repeat login with the same name", async () => {
        const res1 = await request(buildApp()).post("/auth/dev-token").send({ name: "Bob" });
        const res2 = await request(buildApp()).post("/auth/dev-token").send({ name: "Bob" });
        expect(res1.body.user.id).toBe(res2.body.user.id);
    });

    it("defaults name to 'User' when empty", async () => {
        const res = await request(buildApp()).post("/auth/dev-token").send({});
        expect(res.status).toBe(200);
        expect(res.body.user.name).toBe("User");
    });
});
