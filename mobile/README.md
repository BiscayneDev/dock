# Dock mobile (iOS)

Thin native client for Dock: the phone is where you see tasks, isolated-run
reviews and notifications. Dock (the Next.js app) stays the board and the
harness; this app is a client of its HTTP APIs, not a rebuild.

Stack: Expo (React Native). iOS builds via EAS Build; push notifications via
the Expo Push Service, which handles APNs
(https://docs.expo.dev/pushnotifications/overview/ - see docs.expo.dev/push-notifications/overview/).

## What it does today

- Sign in once with your Dock URL and agent token (stored in iOS Keychain via
  expo-secure-store; nothing is hardcoded).
- Task board: tasks grouped by column, pulled from `GET <dock>/api/tasks`.
- Task detail: title, status, and the isolated-run review card -
  branch, commits, diff stat and the attestation result from
  `GET <dock>/api/tasks/<id>/worktree` (accepts the agent token).
- Registers an Expo push token on launch (expo-notifications).

## Not yet wired (next steps)

- Push delivery: Dock's notify pipeline needs to send to the Expo Push Service
  with this device's token (finish / fail / needs-approval - the same alert
  set T3 Code documents).
- Approvals: `GET/POST /api/approvals` actions from the phone.
- Activate a task from the phone (the API already supports it).

## Run

```
cd mobile
npm install
npx expo install --fix   # aligns dependency versions to the installed SDK
DOCK_URL and token: entered in-app, kept in the Keychain
npx expo start           # dev client on a simulator or Expo Go
npx eas build --platform ios   # real iOS build (needs an Expo account)
```
