# Dock mobile (iOS)

Thin native client for Dock: the phone is where you see tasks, isolated-run
reviews and notifications. Dock (the Next.js app) stays the board and the
harness; this app is a client of its HTTP APIs, not a rebuild.

Stack: Expo (React Native). iOS builds via EAS Build; push notifications via
the Expo Push Service, which handles APNs
(https://docs.expo.dev/pushnotifications/overview/ - see docs.expo.dev/push-notifications/overview/).

## What it does today

- Sign in once with your Dock URL and the scoped mobile token
  (`DOCK_MOBILE_TOKEN` on the server - NOT the superuser agent token). Stored
  in the iOS Keychain via expo-secure-store; nothing is hardcoded.
- Board: tasks grouped by column (`GET /api/tasks`), 30s refresh.
- New task: create + activate from the phone, optionally in an isolated
  worktree of a registered repo (`POST /api/tasks` + `POST /api/tasks/activate`
  with `repoPath`; repos listed via `GET /api/repos`).
- Task detail: isolated-run review card - branch, commits, diff stat and the
  attestation result (`GET /api/tasks/<id>/worktree`) - plus messaging the
  assigned agent (`POST /api/messages`).
- Approvals: runs parked in `awaiting_approval` with Approve/Reject
  (`GET /api/runs`, `POST /api/runs/<id>/approve|reject`).
- Push: registers its Expo push token with Dock (`POST /api/mobile/push-token`);
  `POST /api/notify` fans out to registered devices through the Expo Push
  Service (APNs), so finish / fail / info alerts reach the phone.

Verified: `npm install`, `npx expo install --check`, `npx tsc --noEmit`, and
`npx expo export --platform ios` (Metro/Hermes bundle) all pass. On-device or
simulator run needs macOS/Xcode or EAS Build.

## Not yet wired (next steps)

- Approvals for money actions carry the full approval card detail (amount,
  command) - the app currently shows type + prompt.
- EAS Build + App Store distribution, notification tap → deep link into the
  task (`scheme: dock`).

## Run

```
cd mobile
npm install
npx expo install --fix   # aligns dependency versions to the installed SDK
DOCK_URL and token: entered in-app, kept in the Keychain
npx expo start           # dev client on a simulator or Expo Go
npx eas build --platform ios   # real iOS build (needs an Expo account)
```
