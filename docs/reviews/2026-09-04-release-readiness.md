# Release readiness after final remediation

## Decision

The source tree is ready to commit, push, and release. The macOS DMG is ad-hoc signed (this is a personal open-source project without an Apple Developer certificate), so first launch requires a one-time Gatekeeper override. Version `0.2.4` build `6` is the next source version; the latest remote release is `v0.2.3`.

## Implemented scope

- The primary module names and order are FarView → NewLore → OldEcho. Legacy NewSee and Ascan names remain only at compatibility boundaries.
- FarView computes a deterministic, globally shared Top 10 from the latest seven local calendar days across six NewLore source types. User preferences only re-rank the response.
- Noise phrases, URLs, versions, generic prose, pervasive templates, duplicate n-grams, and configured blocked topics are filtered.
- The macOS global hotkey is registered independently from server startup. Selected-text capture uses Accessibility first and a source-process copy fallback.
- Permission onboarding is shown once and protected access is requested only when the corresponding feature needs it.
- Quick Capture uses a standard closable macOS window, preserves drag interactions, aligns the prompt and cursor, and receives captured text before presentation.

## Remediation completed

- Removed the unpushed commit that tracked build artifacts and contained an assistant attribution trailer; all source changes remain in the working tree for clean commits.
- Added `dist-*` ignore coverage.
- Unified current-day calculation on the server's local calendar date and added a UTC-boundary regression test.
- Repaired the Drizzle snapshot parent chain and generated metadata for migration `0010`; `drizzle-kit check` passes.
- Pinned and verified the Node runtime archive SHA-256 before extraction.
- Changed release CI to select an available iPhone simulator.
- Kept release packaging as ad-hoc signing suitable for an open-source project distribution.
- Updated permission, architecture, release, and FarView design documentation to match the implemented behavior.

## Verification

- TypeScript build passed.
- Unit suite passed: 139 tests; 10 database integration cases were skipped by design in the unit invocation.
- Fresh PGlite integration suite passed: 10/10. Its default runner now creates and removes a unique temporary database, so stale migrations cannot contaminate later runs.
- `drizzle-kit check` passed.
- Production dependency audit passed with zero vulnerabilities.
- The full dependency audit reports four moderate findings in the `drizzle-kit` development-only chain and no high or critical findings; none is shipped in the production dependency set.
- macOS XCTest and iOS XCTest passed; CI-compatible simulator selection used the first available iPhone simulator.
- macOS and iOS Release builds passed.
- A fresh local ad-hoc DMG was built successfully. Its Node v22.21.1 archive matched the pinned SHA-256, `hdiutil verify` passed, and the packaged app passed deep strict code-signature verification.
- The packaged app reports version `0.2.4` build `6`; the app and embedded Node runtime are arm64.
- Plists, entitlement files, JSON files, JavaScript syntax, shell syntax, and `git diff --check` passed.
- No build artifact is tracked, and no assistant attribution or obvious secret appears in the pending source tree.

## Release packaging

The macOS DMG is ad-hoc signed and published from the tagged release workflow. This is an open-source project with no Apple Developer identity, so users perform a one-time Gatekeeper override on first launch. The release CI builds, verifies the artifact, publishes the GitHub Release, and updates the Homebrew cask.

## Issue #1 roadmap

The rolling seven-day ranking requested for the current MVP is implemented. Issue #1 should remain open for LLM explanations with citations, governed embedding aliases and merge feedback, followed topics, historical trend states, source filters, and event notifications. The original eight-week baseline is superseded by the accepted seven-day heat definition and is not a remaining requirement.
