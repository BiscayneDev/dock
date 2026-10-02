# Profile wallet and files QA, revision 2

Base: cc7ff0ab9ac8491795736c1d6e8ae08e2925a62f.
Supersedes revision 1: daily briefs are NOT saved. No daily brief index, retention, share-link creation or filter remains. No outbox or briefing cron changes.
No production changes, migrations, links, wallets or messages were made by this patch.

## Verified locally

- Full Vitest: 85 files, 687 tests passed.
- Targeted ESLint passed for changed components, routes and helpers.
- Scoped TypeScript check passed for profile, profile components and API routes plus dependencies. Full-project typecheck exceeded the local memory budget and remains a CI gate.
- Embedded Postgres (PGlite): metadata migration syntax, rerun safety, existing-content preservation, privacy privileges, revocation and rejection of brief kind passed. Not exercised on Supabase.
- Six fresh Chrome screenshots: 1440px desktop and 390px mobile, populated / empty / error. Inspected pixels, no horizontal overflow. Render the exact shipped components with sample data, not authenticated production state.
- Local Turbopack cannot decode the repository's existing favicon.ico. Temporarily moved for previews, restored unchanged. No favicon fix bundled.

## Reproduce visuals

Install playwright outside the repo or in a disposable workspace. Copy preview-page.tsx.txt to src/app/profile-preview-local/page.tsx, temporarily disable Next dev indicators, run dev on port 3100, then run scripts/qa/profile-wallet-files-shots.cjs. Remove preview route before committing. Preview uses no account data. Screenshot directory defaults to /downloads; set SHOT_DIR to override. Set CHROME_PATH if needed.

## SQL checks

Install @electric-sql/pglite in a disposable workspace. Run scripts/qa/profile-wallet-files-sql.cjs from repo root with NODE_PATH pointing at that installation. Creates an in-process temporary database only, not Supabase.

## PR/deployment gates

- Main is handling current PayBox contract verification separately. SDK 1.0.0 returns Promise<unknown>. Normalizer accepts top-level holdings and total_usd, and fails closed for unsupported shapes. A redacted real response fixture must validate normalization before calling the feature production-ready; no recursive guessing or partial-dollar totals.
- Migration 064_profile_files.sql is still REQUIRED before deployment but included only. Adds kind (file/itinerary) and revoked_at to existing dinghy_files. Nothing else: no source key, brief enqueue RPC, archival or retention function. Renumber if another migration lands first. Existing records default to file, without title-based itinerary guesses.
- Files remain hosted on here.now. Live shelf links open here.now directly. Private saved copy is plain text for expired/never-shared files. No new share-link endpoint and no background republication; users can still ask Dinghy to remake an expired file using its existing workflow.
- Library APIs are session-owned, metadata-only for shelf, private/no-store. Full contents require authenticated file detail. Filters apply to loaded pages and say so when empty.
- Revocation updates revoked_at after hosted deletion; retains original URL for ownership/retry recovery. Recall excludes revoked records. Database ownership can reconcile a here.now 404 after a successful delete.
- No payment buttons, signing, funding, admin gallery, deployment or PR creation.
