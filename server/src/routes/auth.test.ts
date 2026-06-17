import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { SignJWT, generateKeyPair } from "jose";

// Mock `createRemoteJWKSet` so jwtVerify uses our local key instead of fetching Apple's.
const joseHoist = vi.hoisted(() => ({
    jwks: null as any,
}));
vi.mock("jose", async () => {
    const actual = await vi.importActual<typeof import("jose")>("jose");
    return {
        ...actual,
        createRemoteJWKSet: () => async (header: any) => joseHoist.jwks(header),
    };
});

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

import { authRouter } from "./auth.js";

let signingKp: Awaited<ReturnType<typeof generateKeyPair>>;

async function bootKeys() {
    signingKp = await generateKeyPair("RS256");
    joseHoist.jwks = async () => signingKp.publicKey;
}

async function makeAppleToken(opts: {
    sub: string;
    aud: string;
    iss?: string;
    email?: string;
    expSeconds?: number;
}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    let token = new SignJWT({ ...(opts.email ? { email: opts.email } : {}) })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(opts.iss ?? "https://appleid.apple.com")
        .setAudience(opts.aud)
        .setSubject(opts.sub)
        .setIssuedAt(now)
        .setExpirationTime(now + (opts.expSeconds ?? 600));
    return token.sign(signingKp.privateKey);
}

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use("/auth", authRouter);
    return app;
}

describe("POST /auth/apple", () => {
    beforeEach(async () => {
        await bootKeys();
        dbHoist.users.length = 0;
    });

    it("rejects requests with no identityToken", async () => {
        const res = await request(buildApp()).post("/auth/apple").send({});
        expect(res.status).toBe(400);
    });

    it("rejects requests with an unverifiable identityToken (signature)", async () => {
        // Sign with a different key — verification against our JWKS must fail.
        const otherKp = await generateKeyPair("RS256");
        const now = Math.floor(Date.now() / 1000);
        const bad = await new SignJWT({})
            .setProtectedHeader({ alg: "RS256" })
            .setIssuer("https://appleid.apple.com")
            .setAudience("com.noteone.app")
            .setSubject("apple-user-1")
            .setIssuedAt(now)
            .setExpirationTime(now + 600)
            .sign(otherKp.privateKey);
        const res = await request(buildApp()).post("/auth/apple").send({ identityToken: bad });
        expect(res.status).toBe(401);
    });

    it("rejects identityTokens with the wrong audience", async () => {
        const token = await makeAppleToken({ sub: "u1", aud: "com.evil.app" });
        const res = await request(buildApp()).post("/auth/apple").send({ identityToken: token });
        expect(res.status).toBe(401);
    });

    it("rejects identityTokens with the wrong issuer", async () => {
        const token = await makeAppleToken({
            sub: "u1", aud: "com.noteone.app", iss: "https://evil.example",
        });
        const res = await request(buildApp()).post("/auth/apple").send({ identityToken: token });
        expect(res.status).toBe(401);
    });

    it("ignores body-supplied appleId — sub from token wins", async () => {
        const token = await makeAppleToken({
            sub: "real-apple-id", aud: "com.noteone.app", email: "a@b.c",
        });
        const res = await request(buildApp())
            .post("/auth/apple")
            .send({ identityToken: token, appleId: "victim-apple-id", email: "spoof@evil" });
        expect(res.status).toBe(200);
        expect(res.body.token).toBeTruthy();
        // The created user must reflect the verified `sub`, not the body.
        expect(dbHoist.users.length).toBe(1);
        expect(dbHoist.users[0].appleId).toBe("real-apple-id");
        // Email preference: token email > body
        expect(dbHoist.users[0].email).toBe("a@b.c");
    });

    it("issues a JWT for a valid identityToken", async () => {
        const token = await makeAppleToken({ sub: "u-abc", aud: "com.noteone.app" });
        const res = await request(buildApp()).post("/auth/apple").send({ identityToken: token });
        expect(res.status).toBe(200);
        expect(typeof res.body.token).toBe("string");
        expect(res.body.user.id).toBeTruthy();
    });
});

describe("POST /auth/dev-token", () => {
    beforeEach(async () => {
        await bootKeys();
        dbHoist.users.length = 0;
    });

    it("returns 403 when ENABLE_DEV_LOGIN is false", async () => {
        // Default test env has ENABLE_DEV_LOGIN unset/false (see setup.ts).
        const res = await request(buildApp()).post("/auth/dev-token").send({ name: "Bob" });
        expect(res.status).toBe(403);
    });
});
