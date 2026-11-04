# Mobile release proposal, 2026-11-04

This is preparation for owner review. Nothing below is approval to merge, apply
SQL, deploy, enroll in Apple, submit a build, or run paid inference.

## Exact outcome of the first slice

A native Dock client can pair to the owner workspace, read the board, display
source result messages for a selected task, send a message, and show readable
approval cards. This is not yet the promised real task-to-agent-to-result path:
`lib/runtimes/index.ts` selects StubRuntime on Vercel, and `/api/messages` stores
messages without dispatching an agent. New isolated execution remains OFF.
Do not describe a board connection as an operational agent harness.

## Distribution discovered

Free Expo passwordless account: biscayne-halsey on the business email.
Free organization/project: https://expo.dev/accounts/biscayne-ventures/projects/dock-mobile
Project ID: 5615ef1b-3373-4ace-9784-ebe9438e3586. This is public project metadata,
not an authentication token. No build, card, enrollment, paid plan or invite.

- Custom signed iPhone build: EAS preview profile is prepared, not run. It needs
  existing paid Apple Developer signing access, device registration and APNs for
  push. Current membership is unverified. Apple account page is signed out and
  no saved Apple login is available. Both Gmail accounts were searched; developer
  newsletters and invitations to test others' apps do not prove signing access.
- TestFlight: requires signing and App Store Connect processing. It is not a
  guaranteed same-day delivery or a free way around membership.
- Local personal signing: Expo documents a Mac/Xcode path without paid Apple
  membership. No authorized available Mac/Xcode/device connection is established.
- Expo Go: temporary host app, not a standalone Dock icon or distribution build.
  Physical iOS requires the CLI and phone to use the same Expo account. Current
  owning versions endpoint advertises Expo Go SDK57; the draft client is now upgraded to SDK57.
  Dependency alignment, TypeScript, iOS Hermes bundle export and web export pass
  for SDK57. There is still no verified on-device Expo Go launch. No QR link
  has been offered as working. Native push is unverified on every route.

Sources read:
- https://docs.expo.dev/get-started/start-developing/
- https://docs.expo.dev/develop/development-builds/introduction/
- https://exp.host/--/api/v2/versions
- https://docs.expo.dev/versions/latest/sdk/notifications/

## Proposed database change

Only `supabase/migrations/20261104_mobile_pairings.sql` for this slice. Do not
include coding-call reservation migrations or any data backfill.

Adds `mobile_pairings`, `mobile_pairing_failures`, `mobile_devices`, three lookup
indexes, RLS enabled without client policies, and `exchange_mobile_pairing` RPC.
No existing table rows are rewritten. Pairings and devices cascade when their
workspace is deleted. The failure table stores workspace IDs without an FK.
RPC execute is revoked from PUBLIC and granted only to service_role. A
transaction advisory lock serializes guesses within a workspace. Code consume
is one transaction; device insertion is a separate server operation. If insertion
fails, the code remains consumed and the owner must generate another code.

Impact: phone auth begins depending on a service-role lookup. No service-role
secret enters the app. Device tokens are hashed at rest; returned once over
HTTPS. Owner creates/revokes codes from settings. Revoking a phone blocks future
credential checks; it does not erase data already seen by that phone.

Rollback: first stop/roll back code using the new tables and revoke devices.
Then, if desired, drop function `exchange_mobile_pairing(uuid,text,integer,bigint)`
and tables `mobile_devices`, `mobile_pairing_failures`, `mobile_pairings`. That
removes all pairing/device records and forces re-pairing after redeploy. It does
not touch workspace or task records. Keeping unused tables is safer if a rapid
code rollback is needed. SQL was tested in throwaway Postgres only.

## Minimum code groups to review together

1. `lib/mobile-{auth,auth-server,pairing,pairing-server}.ts`, all
   `app/api/mobile/*`, and the migration above.
2. `components/settings/MobilePairingSection.tsx` and its settings-page import.
3. Auth additions to task/message/repo/run list/decision/worktree routes, plus
   `lib/approval-card.ts`. These change previously unauthenticated surfaces:
   inspect owner and agent callback compatibility before deployment.
4. `mobile/*`, including project metadata, build profiles, result-message view,
   explicit push opt-in, failed-write retention, manual refresh/disconnect.
5. Push server pieces only with separately verified APNs/device registration.

This is not a cherry-pick-ready independent PR yet. Existing draft PR13 includes
91 files and isolation dependencies. Review a minimal extracted branch before
merge instead of approving the whole foundation PR to get pairing.

## Preflight before requesting merge/deploy approval

- Produce extracted mobile-only diff and run tests/build against current main.
- Confirm production persistence: `/api/tasks` uses KV or local files, while
  `/api/messages` writes local files. Vercel local writes are not a durable result
  store. A real result path needs persistent storage and an execution host.
- Inspect production configuration through its owning account without exposing
  secrets. Verify exactly one owner workspace, KV/storage health, and current
  runtime/host. No test activation that can spend is authorized.
- Use a real authenticated preview plus throwaway database to verify pairing,
  revoked device, task retention and readable result persistence.
- Verify native pixels and interactions on a simulator/device, then distribute.
  Web pixels and an exported JS bundle are not native verification.

## Local evidence

`python scripts/e2e/prove-mobile-pairing.py`: real throwaway Postgres, exactly one
winner from 8 same-code requests; exactly 10 failures and 14 blocks from 24
parallel distinct guesses; anon RPC denied, service-role RPC allowed; rollback
preserves workspace row. `test/mobile-{auth,pairing}.test.mjs`: 10/10.
Mobile TypeScript, dependency check and web export pass. Web screenshots at
390x844 inspect layout only with clearly badged fictional data. No native build,
production migration, merge, paid inference or live task dispatch performed.

## Dependency caveat

SDK57 uses Expo CLI57.0.32 with Zod3.25.76. npm audit reports
GHSA-mrhx-c7xc-m3w5 (oversized constrained collections memory exhaustion) and
moderate/low transitive advisories. Its suggested SDK58 upgrade does not match the
currently advertised Expo Go57 runtime. Do not force a Zod3-to4 override without
CLI compatibility evidence. No development server was exposed to the internet.
Source: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
