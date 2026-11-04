# Dock mobile

Expo native client for Dock. Current app uses SDK57. It is a reviewable draft,
not a verified phone release. See `../docs/mobile-release-slice.md` for exact
production, distribution and execution dependencies.

## Client behavior

- Pair with a single-use 6-digit code from owner-authenticated Dock settings.
  Store the returned scoped credential in SecureStore on native. Never paste
  a superuser token into the app. Web preview uses localStorage, not Keychain.
- Read tasks, per-task worktree summaries, canonical message/results and approval
  proposals. Missing proposal details prevent approval.
- Create a task, request activation, and send task messages. These are separate
  operations. Failed activation preserves the saved task in backlog and reports
  the failure; it is not a completed run. Messages are retained until a server
  response confirms the send. Network failure does not mean an empty board.
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
