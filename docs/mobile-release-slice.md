# Narrow mobile release proposal, November 4, 2026

Preparation only. No merge, production SQL, production cutover, paid inference,
build, Apple enrollment or hosted update is authorized by this document.

## Exact scope

This branch starts from main6eecc11, not the91-file experimental foundation PR13.
It contains Expo client, owner-only pairing/settings, mobile auth on existing
Supabase run list/create/decision endpoints, readable approval cards and pairing
SQL. No sandbox executor, Git isolation, Graphify, home inference, legacy board,
legacy messages or push dispatch changes. Full harness remains separate; a text
run is not sandbox coding and is not completion of the user's final goal.

Runs uses existing Supabase task_runs output/events. It does not rely on Vercel
local files. New submissions require runs:create and default-OFF DOCK_MOBILE_RUNS.
Mobile can only submit text cloud work, never isolated payloads or money proposals.
Current worker checks a fixed estimate then settles actual or estimated cost.
The $0.10 budget field is NOT a guaranteed provider charge ceiling. Do not enable
or perform an end-to-end paid run without separate scoped authority.

## Live readiness facts

- Dock Vercel masked env-name list includes Supabase, Shipyard and CRON_SECRET;
  no KV variables. Storage page has no linked database; Supabase is separate.
- Business-email authenticated /api/runs returned200, zero runs, homeOnline false.
  App lands on initial setup. No setup submitted or worker endpoint called.
- /api/models reports Shipyard configured, other providers false. Not call proof.
- Cron settings show /api/worker/tick enabled every minute. Filtered runtime logs
  had no matching records, so successful cron execution is still unverified.

Sources:
https://vercel.com/halsey-biscaynevents-projects/dock/settings/environment-variables
https://vercel.com/halsey-biscaynevents-projects/dock/stores
https://vercel.com/halsey-biscaynevents-projects/dock/settings/cron-jobs
https://dock-harness.vercel.app/

## Native delivery and exact owner steps

Free Expo business-email passwordless account biscayne-halsey is created. CLI
passwordless device login confirmed; credentials are restricted to Developer on
biscayne-ventures only, not Owner/all accounts. project:info confirmed project
5615ef1b-3373-4ace-9784-ebe9438e3586:
https://expo.dev/accounts/biscayne-ventures/projects/dock-mobile

Apple live store metadata says Expo Go58.0.5, released2026-10-22, supports SDK58,
minimum iOS16.4. Candidate is SDK58. The store page version history independently
confirms58.0.5/SDK58. Expo generic versions endpoint still advertises57; one
troubleshooting page says App Store stops54. Treat those as conflicting/stale,
not proof of physical iPhone compatibility. Native launch still untested.

https://apps.apple.com/us/app/expo-go/id982107779?uo=4
https://itunes.apple.com/lookup?id=982107779&country=us
https://expo.dev/changelog/sdk-58
https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/

Temporary Expo Go route: owner installs/updates free Expo Go, signs into the same
Expo account as CLI, and opens a verified compatible transport link. It is not a
standalone Dock app. No working link claimed yet. A hosted Expo update avoids a
running vulnerable public development server, but current docs disagree about
iOS Go launch support: SDK updates reference says browse updates in Expo Go;
FAQ specifically promises share URLs in Expo Go on Android. Need actual native
transport verification before asking owner to install/open anything.

Custom signed route: owner supplies existing Apple Developer access securely and
registers their device. Read-only Apple account check was signed out, no saved
login; inbox newsletters/TestFlight invites do not establish membership. No
phone prompt initiated. Existing membership is unverified, not absent. Expo Free
currently includes15 iOS builds (low priority;90+ min possible),1K update MAUs,
no update overage. Custom iPhone signing still requires Apple membership. No paid
plan or enrollment started. End-to-end update code signing is Production-plan
only, not included Free. Expo simulators are limited beta/paid, not a free proof.

https://expo.dev/pricing
https://docs.expo.dev/develop/development-builds/introduction/
https://docs.expo.dev/versions/latest/sdk/updates
https://docs.expo.dev/faq

Before a real install, the user-owned decisions are: (1) approve reviewed narrow
merge + additive pairing migration when ready, not whole foundation; (2) supply
existing Apple signing if choosing standalone native distribution; (3) authorize
an exact bounded paid execution proof only after the actual charge bound is
established. Agent72 identity is still pending separately for sandbox choice.

## Pairing migration and rollback

Only supabase/migrations/20261104_mobile_pairings.sql. Adds mobile_pairings,
mobile_pairing_failures,mobile_devices, three indexes and exchange_mobile_pairing.
RLS enabled with no client policies. PUBLIC RPC execute revoked; service_role
only. Advisory transaction lock serializes workspace guesses. Codes hashed,
5-minute single-use; devices hashed/revocable. Consume and device insert are
separate operations: insert failure consumes code; owner generates a new one.
No existing rows rewritten or backfilled. Pairings/devices cascade on workspace
deletion. Failure table workspace ID has no FK.

Rollback: roll back dependent code first; then optionally drop function
exchange_mobile_pairing(uuid,text,integer,bigint) and the three mobile tables.
This discards only pairing/device records and forces re-pairing later. Workspace,
run and task records remain. Keeping unused tables is safer for rapid code rollback.

## Tests

Throwaway real Postgres:8 same-code exchanges, exactly one winner;24 parallel
wrong-code guesses,10 invalid/14 blocked; anon RPC denied/service role allowed;
rollback preserves workspace. Pure auth/pairing/gate tests, root/mobile TypeScript,
dependency alignment, iOS Hermes bundle/web exports. Actual exported client
contract test renders stored run output and disables submission by default.
390x844 fictional pixels inspected, not native/production proof. No live model
call, native build, hosted update, migration or production write performed.

Latest extracted-branch checks:225total223pass2skip0fail; standalone TypeScript
passes. Next compilation succeeded; its combined build was killed137 during
TypeScript under a2GB local memory limit, so full extracted production build is
not yet verified. This is an open pre-merge check, not a success claim.
