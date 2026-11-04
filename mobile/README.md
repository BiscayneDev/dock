# Dock mobile

Expo native client for Dock. Current app uses SDK57. It is a reviewable draft,
not a verified phone release. See `../docs/mobile-release-slice.md` for exact
production, distribution and execution dependencies.

## Client behavior

- Pair with a single-use 6-digit code from owner-authenticated Dock settings.
  Store the returned scoped credential in SecureStore on native. Never paste
  a superuser token into the app. Web preview uses localStorage, not Keychain.
- Runs is the primary screen: existing Supabase queue status/output persists
  across sessions. Text-only cloud submission has an explicit server opt-in,
  default OFF. It is not sandbox coding or browser execution.
- Read legacy tasks, per-task worktree summaries, canonical message/results and approval
  proposals. Missing proposal details prevent approval.
- New submits to `/api/runs` only when server flag DOCK_MOBILE_RUNS is on.
  No legacy task activation from the phone. The displayed $0.10 budget is not a
  provider-charge ceiling: current worker uses estimates and later settlement.
  No paid run or live result delivery has been verified or authorized.
- Legacy task messages are retained until the server confirms. Network failures
  preserve the last board and expose a warning; they do not imply an empty board.
- Explicitly opt into native push after connecting. No automatic phone prompt.
  Push setup and delivery are not yet verified.
- Disconnect clears the local connection. Revoke the credential separately in
  Dock settings if the phone should lose server access.

## Free Expo setup

Organization/project: https://expo.dev/accounts/biscayne-ventures/projects/dock-mobile
Project metadata in app.json, preview/simulator profiles in eas.json. No builds
or signing enrollment have been submitted. EAS build commands can incur use of
credits or require paid Apple signing; do not run without scoped approval.

## Local checks

```
cd mobile
npm ci
npx tsc --noEmit
npx expo install --check
npx expo export --platform web
```

Web fictional preview: `?demo=board|task|approvals|new`. This never establishes
backend or native readiness. The App Store Expo Go runtime must match this
project; current owning metadata advertises SDK57 and the draft now matches57. Dependency
alignment, iOS JS bundle and web export pass; on-device runtime remains unverified.
See the release proposal for transitive CLI audit findings.
