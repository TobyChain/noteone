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
                    // config.where → dev-token lookup by appleId;
                    // config.orderBy → /auth/local "first user by createdAt".
                    findFirst: vi.fn(async (config: any) => {
                        if (config?.orderBy) return users[0];
                        return users.find((u) => u.appleId === lastQueriedAppleId.value) ?? undefined;
                    }),
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
const testConfig = vi.hoisted(() => ({
    jwtSecret: "test-secret-must-be-at-least-16-chars-long",
    isProd: false,
    isLoopbackHost: true,
    trustExternalLoopbackBinding: false,
    accessToken: "",
    enableDevLogin: true,
}));
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
    config: testConfig,
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
        testConfig.enableDevLogin = true;
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

    it("is hidden unless explicitly enabled", async () => {
        testConfig.enableDevLogin = false;
        const res = await request(buildApp()).post("/auth/dev-token").send({ name: "Alice" });
        expect(res.status).toBe(404);
    });
});

describe("POST /auth/local", () => {
    beforeEach(() => {
        dbHoist.users.length = 0;
        lastQueriedAppleId.value = "";
        testConfig.enableDevLogin = true;
        testConfig.isLoopbackHost = true;
        testConfig.trustExternalLoopbackBinding = false;
        testConfig.accessToken = "";
    });

    it("creates a default user when none exists", async () => {
        const res = await request(buildApp()).post("/auth/local").send({ name: "Ignored Name" });
        expect(res.status).toBe(200);
        expect(typeof res.body.token).toBe("string");
        expect(res.body.user.name).toBe("本地用户");
        expect(res.body.user.id).toBeTruthy();
        expect(dbHoist.users[0].appleId).toBe("local-default");
        expect(dbHoist.users[0].email).toBeNull();
    });

    it("rejects browser page origins from obtaining a localhost session", async () => {
        const res = await request(buildApp()).post("/auth/local")
            .set("Origin", "https://attacker.example").send({});
        expect(res.status).toBe(401);
    });

    it("allows an installed browser extension to open the local session", async () => {
        const res = await request(buildApp()).post("/auth/local")
            .set("Origin", "chrome-extension://abcdefghijklmnop").send({});
        expect(res.status).toBe(200);
    });

    it("reuses the first existing user instead of creating another", async () => {
        const first = await request(buildApp()).post("/auth/dev-token").send({ name: "Alice" });
        const res = await request(buildApp()).post("/auth/local").send({ name: "Bob" });
        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe(first.body.user.id);
        // Existing user wins — the requested name must not create a second account.
        expect(res.body.user.name).toBe("Alice");
        expect(dbHoist.users).toHaveLength(1);
    });

    it("requires the bootstrap token when exposed beyond loopback", async () => {
        testConfig.isLoopbackHost = false;
        testConfig.accessToken = "0123456789abcdef";
        const denied = await request(buildApp()).post("/auth/local").send({});
        expect(denied.status).toBe(401);

        const allowed = await request(buildApp()).post("/auth/local")
            .set("X-NoteOne-Access-Token", testConfig.accessToken).send({});
        expect(allowed.status).toBe(200);
    });
});
