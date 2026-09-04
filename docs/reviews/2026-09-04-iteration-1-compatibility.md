# Iteration 1 — Naming compatibility and release integrity

## Problems found

- The canonical names are OldEcho, NewLore, and FarView, but migration only read the oldest `.ascan` config and skipped `.newsee`.
- User settings skipped `newseeConfig`.
- Import accepted only `newloreConfig`, `newloreHistory`, and `newlore-reports/`, so older backups could silently lose NewLore configuration, history, and reports.
- Markdown sidecar detection was not scoped to the report date.
- Local-data cleanup briefly targeted entire legacy roots, which could delete checked-in compatibility schema files in development.

## Iteration plan

Centralize a three-generation compatibility chain: NewLore first, then NewSee, then Ascan. Keep compatibility at storage and API boundaries; use only current names in primary application flows.

## Changes and verification

- Added config fallback for `.newsee` and `.ascan`; updates copy legacy content into `.newlore`.
- Added `newseeConfig` and `newseeHistory` import compatibility alongside existing Ascan fields.
- Accepted all three report archive directories and filename prefixes.
- Fixed date-specific Markdown sidecar detection.
- Export now includes readable reports from all three storage generations.
- Local-data cleanup removes runtime data only, not legacy schema/templates.
- Added `compatibility.test.ts` for field precedence, report paths, and sidecar dates.

Verification completed: TypeScript build passed; 121 unit tests passed; PGlite integration tests passed 7/7.

## Code review

- Correctness: Required cleanup-scope bug found and fixed. Compatibility precedence is explicit.
- Readability: Compatibility rules are centralized in helpers and ordered arrays.
- Architecture: Legacy names remain at boundaries instead of leaking into primary flows.
- Security: Import continues to validate basenames and writes only below the resolved report directory.
- Performance: Compatibility scans are bounded to three known directories.

## Iteration verdict

Approved. The required cleanup-scope defect found during review was fixed and revalidated. This iteration improves upgrade safety but does not make FarView feature-complete.
