# Dock mobile release candidate

Narrow client: owner pairing, durable Supabase run status/output, approval cards,
and default-OFF text cloud submission. No legacy board, file-based messages,
sandbox coding, push dispatch, or experimental executor in this release.

The full agent harness remains a separate foundation project. A text generator
is not the final sandbox harness. No real paid run, native launch or phone
installation has been verified. See ../docs/mobile-release-slice.md.

Free Expo account/CLI is authenticated and project linkage confirmed:
https://expo.dev/accounts/biscayne-ventures/projects/dock-mobile

Current candidate SDK58 matches Apple App Store Expo Go58.0.5 release notes.
Generic Expo metadata advertised57 and one troubleshooting page still says54;
both conflict with the App Store's dated October22 SDK58 release. Native runtime
remains to be tested. No QR or install link is claimed ready.

Local checks:
```
cd mobile
npm ci
npx tsc --noEmit
npx expo install --check
npx expo export --platform ios
npx expo export --platform web
```

No public development server, build or hosted update has been started. Build
profiles are preparation only. Installing a custom iPhone build still needs
Apple signing; an update is not a way around that requirement.
