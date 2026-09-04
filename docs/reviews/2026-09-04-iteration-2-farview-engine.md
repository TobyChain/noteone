# Iteration 2 — FarView trend engine and API

> Historical iteration record. The ten-week implementation described below was replaced by the current rolling seven-day heat ranking. See the FarView design and release-readiness review for current behavior.

## Problems found

- FarView had only a placeholder entry; no trend model, calculation, persistence, or API existed.
- A first implementation produced order-dependent representative items.
- The first migration put two SQL statements in one PGlite prepared statement.
- Representative selection could be dominated by one source.
- Refresh was initially synchronous and date validation accepted impossible dates.
- Loading article bodies for the ten-week scan would create avoidable memory growth.

## Iteration plan

Implement a deterministic, non-LLM multi-source engine. Persist one global snapshot per week, expose asynchronous refresh/status/overview/topic APIs, and trigger refresh after a successful NewLore merge. Missing weeks remain missing rather than being converted to zero.

## Changes and verification

- Added a deterministic English/Chinese phrase extractor with aliases and stopwords.
- Added ten-week counts, up to eight covered baseline weeks, growth and burst scores, source diversity, stable topic IDs, and diverse representative items.
- Added per-source weekly normalization so high-volume sources cannot dominate the score by raw ingestion volume alone.
- Added `farview_snapshots`, migration `0010`, and idempotent weekly upsert.
- Added `/api/farview/overview`, `/topics/:id`, `/refresh`, and `/status`.
- NewLore completion triggers FarView asynchronously; either subsystem can fail independently.
- Limited source loading to titles, summaries, one-liners, and keywords; full article bodies are not loaded.
- Unit tests cover first-week output, partial baselines, determinism, source diversity, and invalid dates.
- PGlite integration covers six-table query shape and snapshot upsert.

Verification completed: TypeScript build passed; 129 unit tests passed; FarView PGlite integration passed 1/1; general PGlite integration passed 7/7 after migration repair.

## Code review

- Correctness: Fixed order-dependent representatives, impossible-date acceptance, and PGlite migration statement splitting.
- Readability: Pure statistical functions are separate from database orchestration and HTTP routes.
- Architecture: FarView owns its engine/service/routes and only receives an asynchronous trigger from NewLore.
- Security: Routes remain behind the existing authenticated `/api` boundary; dates are validated before queries.
- Performance: Reads are bounded to ten weeks and avoid full article bodies; snapshots prevent repeated page-load scans.

## Iteration verdict

Approved for the backend MVP. Statistical quality still needs real-data backtesting before a public claim that FarView reliably detects industry trends.
