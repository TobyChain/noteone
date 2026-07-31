-- Migration 0009: content_type enum expansion (html, md)
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction (drizzle wraps migrations).
-- The actual enum expansion is done in db/client.ts bootstrap before migrate() runs.
SELECT 1;
