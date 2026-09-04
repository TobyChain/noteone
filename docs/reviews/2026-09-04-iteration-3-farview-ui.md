# Iteration 3 — FarView UI and module navigation

> Historical iteration record. Ten-week charts and baseline coverage were subsequently removed in favor of the current rolling seven-day Top 10. Current release state is documented in `2026-09-04-release-readiness.md`.

## Problems found

- FarView was only a placeholder and did not call the trend API.
- Module order did not match the requested FarView → NewLore → OldEcho hierarchy.
- iOS tabs used integer tags, so reordering could silently break capture routing.
- macOS module headers had inconsistent click behavior.
- Refresh failure could replace a valid cached ranking with a full-screen error.
- Trend bars used raw heights and could overflow with large counts.
- FarView snapshots were missing from export, import, and local-data cleanup.
- User focus/topics from previous naming generations were not read.

## Iteration plan

Create a separate FarView model and view boundary, connect it to the authenticated API, represent every loading state explicitly, reorder both Apple navigation surfaces, and close data lifecycle gaps.

## Changes and verification

- Added typed FarView response models and API methods.
- Added overview, empty, insufficient-data, running, stale-with-error, ranking, and topic-detail states.
- Added ten-week normalized charts, source mix, representative items, and baseline coverage messaging.
- Reordered iOS tabs and macOS sidebar to FarView → NewLore → OldEcho.
- Replaced integer iOS tab tags with `AppTab`; capture routing now targets `.capture`.
- Unified macOS module header behavior and removed OldEcho search from unrelated modules.
- Added snapshot export/import/clear-local-data handling.
- Added personal relevance re-ranking while preserving global scores.
- Added Swift decoding and tab-order tests.

Verification completed: server build passed; 133 unit tests passed; fresh PGlite integration passed 9/9; macOS XCTest passed; iOS XCTest passed (an earlier run required one retry after a simulator Busy/preflight failure); macOS/iOS Debug and Release builds passed.

## Code review

- Correctness: All UI states map to explicit API states; cached data survives refresh errors.
- Readability: FarView models and views are no longer embedded in NewLore files.
- Architecture: FarView is an independent sibling module; NewLore only triggers asynchronous refresh.
- Security: No new unauthenticated routes or external data rendering were introduced. URLs are displayed as metadata only in this MVP.
- Performance: Charts are normalized; the page reads cached snapshots rather than scanning source tables.

## Iteration verdict

Approved as an internal release candidate at the end of this iteration. Later remediation replaced its ten-week model, completed dependency and UX verification, and retained `v0.2.4` as the next release because the remote latest release is `v0.2.3`.
