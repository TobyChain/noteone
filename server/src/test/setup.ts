// Test bootstrap. Sets predictable env defaults for unit tests so config.ts doesn't blow up
// at import time. Integration tests opt in via TEST_DATABASE_URL — when unset, they skip.

process.env.NODE_ENV ??= "test";
process.env.JWT_SECRET ??= "test-secret-must-be-at-least-16-chars-long";

// When integration tests are enabled, point the application's `db` client at the test DB.
// Must happen BEFORE any module that reads DATABASE_URL is imported.
if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
// DATABASE_URL is required by config.ts; unit tests never touch the DB but importing the
// module still needs it to be a syntactically valid string.
process.env.DATABASE_URL ??= "postgres://noteone:noteone@localhost:5432/noteone_test";
