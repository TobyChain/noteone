-- Superseded: daily_reports (types/table/indexes) is fully created by
-- 0006_safe_vulcan.sql. This file predates it and duplicated the DDL with
-- IF NOT EXISTS guards, which breaks fresh installs on strict single-statement
-- drivers (PGlite). Kept as a journal-tracked no-op.
SELECT 1;
