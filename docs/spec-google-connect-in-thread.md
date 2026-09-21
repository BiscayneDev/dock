# Spec: In-thread Google (Gmail/Calendar) connect flow for Dinghy

Status: **Spec PR — not implemented, not merged.** Storage decision blocked on Halsey's explicit approval (see §5).

## 1. Audit — what exists today (reusable)

Everything below is **existing, working code** in `src/`:

| Piece | Location | Notes |
|---|---|---|
| OAuth client + auth URL | `src/lib/integrations/google.ts` | `getOAuth2Client()` reads `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`; `getAuthUrl(scopes)` builds consent URL (`access_type=offline`, `prompt=consent`) |
| Start route | `src/app/api/integrations/google/auth/route.ts` | `GET /api/integrations/google/auth` — **requires a web session cookie**; redirects to `/onboarding` if none |
| Callback route | `src/app/auth/callback/[provider]/route.ts` | Exchanges code, fetches userinfo email, upserts tokens, redirects to `/onboarding?connected=google` |
| Scopes (both routes) | auth route + callback route | `gmail.readonly`, `gmail.send`, `gmail.modify`, `calendar.readonly`, `calendar.events` — already least-privilege for the tool set; keep as-is |
| Token storage | `src/lib/integrations/google.ts` (`storeGoogleTokens`, `getDecryptedGoogleTokens`) | Supabase `oauth_tokens` table, encrypted at rest via `src/lib/crypto.ts`; auto-refresh in `getAuthedClient()` |
| Gmail tools | `src/lib/tools/gmail.ts` | search/read/summarize/draft/send/reply/label/archive |
| Calendar tools | `src/lib/tools/gcal.ts` | list/today-briefing/create/etc. |
| Connection-state awareness | `src/lib/orchestrator/system-prompt.ts` (line 29, 76) | Prompt says "suggest connecting at /onboarding or The Harbor" when tool fails with auth error |
| Magic-link auth (Telegram) | `src/lib/auth/magic-link.ts`, used in `src/lib/orchestrator/index.ts` `/start` | Signs `telegramId` + ts into an `/auth/magic` URL |
| Env template | `.env.local.example` | Documents `GOOGLE_REDIRECT_URI = {APP_URL}/auth/callback/google` |

## 2. Gaps (what is missing)

1. **No in-thread connect link.** When a Gmail/Calendar request arrives while unconnected, the orchestrator just tells the user to visit `/onboarding`. It never sends a one-click Google OAuth start link in the Telegram/iMessage thread.
2. **Start route is web-session-gated.** `GET /api/integrations/google/auth` 401-redirects without a browser session — an iMessage/Telegram user tapping a link has no session.
3. **Callback doesn't resume.** After connect, callback redirects to `/onboarding?connected=google`; the original request that triggered the connect is lost.
4. **No connect-state confirmation in-thread.** Nothing messages "Google connected ✓" back into the originating chat.
5. **iMessage front door (`src/spectrum/index.ts`) has no integration awareness at all** — it's a stateless gateway proxy with in-memory history.

## 3. Target flow (to implement after approval)

1. Request arrives (Telegram webhook or iMessage Spectrum) → `buildUserContext` finds no `tokens.google` → instead of the "visit /onboarding" line, send in-thread:
   `connect google and i'll take it from there: {connectUrl}`
2. `{connectUrl}` = a **state-signed** start URL: `GET /api/integrations/google/auth?state=<base64url({platform, chatId, resume: originalRequest, ts})>&sig=<hmac>` — mirrors the existing `buildMagicLink` HMAC pattern in `src/lib/auth/magic-link.ts`. No session cookie needed; `sig` + fresh `ts` (≤10 min) prove authenticity. Also accept an existing session as today.
3. Google consent → callback `GET /auth/callback/google` (existing route, extended):
   - persist tokens (existing `storeGoogleTokens`)
   - verify connection with a cheap live call (e.g. `gmail.users.labels.list` or `calendar.calendarList.list`) — **never claim connected until verified**
   - if `state` present: send platform message to `chatId`: "google connected ✓ — picking up where you left off", then re-run the orchestrator on `state.resume`
   - else: existing redirect behavior
4. Update `system-prompt.ts` lines 29/76: replace "suggest connecting at /onboarding" with "send the google connect link (tool: `send_connect_link`)" so the LLM uses the new path.

### Reuse
`getAuthUrl`, `exchangeCode`, `storeGoogleTokens`, `getAuthedClient`, both tools files, `buildMagicLink` HMAC pattern, `sendMessage` (Telegram) — all reused unchanged. New code: state encode/verify helper, `?state` handling in the two routes, a `send_connect_link` platform adapter (Telegram `sendMessage`; iMessage Spectrum `sp.send`), prompt-line updates. Estimated ~300–400 LOC + tests.

## 4. Google OAuth client (Halsey's existing client)

- Account/client: Halsey's existing Shipyard Google Cloud OAuth client under `halsey@biscayneventures.xyz` — **reuse, do not create a new client.**
- Authorized redirect URIs to add/confirm in Cloud Console:
  - `https://getdinghy.sh/auth/callback/google` (production)
  - `https://<vercel-preview-domain>/auth/callback/google` (per-preview, only if testing via previews)
  - `http://localhost:3000/auth/callback/google` (local dev)
- Authorized JavaScript origins: **none needed** — the flow is full-page redirects, no browser JS calls Google directly.
- Env vars (Vercel dock project): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=https://getdinghy.sh/auth/callback/google`.
- Scopes: keep the current five (`gmail.readonly`, `gmail.send`, `gmail.modify`, `calendar.readonly`, `calendar.events`). Least-privilege justification: `gmail.modify` covers label/archive + send/readonly needs; dropping it would break `gmail_label`/`gmail_archive`.
- **Consent screen / testing:** if publishing status is *Testing*, every user must be a test user. Add all 10 beta members' Google addresses under *OAuth consent screen → Audience → Test users*. Gmail scopes are **restricted** — while in Testing, refresh tokens expire after 7 days; either keep Testing + re-auth weekly, or request verification/`internal` status before the 10-seat rollout. Flag to Halsey before either.

## 5. Token storage — PENDING Halsey's explicit approval

**No storage option is approved yet.** Halsey must explicitly confirm one of the options below before any refresh tokens are persisted for beta users.

Blueprint says **PayBox**; PayBox credentials are currently unavailable. Do **not** migrate anything until Halsey approves one of:

- **A. Keep Supabase `oauth_tokens` (status quo).** Already encrypted (`src/lib/crypto.ts`), already working, RLS-capable. Tradeoff: refresh tokens live in the same Postgres as app data; a service-role-key leak exposes all users' mail access. *This is the current code path — no change needed.*
- **B. PayBox vault (blueprint target).** Store refresh tokens keyed by user in PayBox; Supabase keeps only a non-sensitive pointer. Blocked on PayBox credentials/access. Cleanest end state.
- **C. Local macOS Keychain / Hermes vault per user** — only viable for Halsey's own single-user deployment, not 10 beta seats.

Recommendation: ship on **A** now (it is the existing audited path), file B as the migration once PayBox creds land. **Explicit approval from Halsey required before storing any refresh token in Supabase for beta users** — if A is not approved, the connect flow ships but tokens cannot persist, which defeats the feature; hence this decision gates implementation, not just polish.

## 6. Tests (to write with implementation)

1. `?state` signing: round-trip, tampered sig rejected, expired ts rejected.
2. Start route: with session (old behavior), with valid signed state (no session → consent URL), with bad sig → 400.
3. Callback: happy path persists tokens + verifies via live API call; sends "connected ✓" message to correct platform/chatId; resumes original request through orchestrator; no `state` → legacy redirect.
4. Connection verification: stubbed googleapis — failure marks connect unsuccessful, does NOT send success message.
5. Test-user access: integration test (manual, documented runbook) confirming a non-owner test user completes consent.
6. End-to-end (staging): unconnected user asks about email → receives link in-thread → completes consent → receives confirmation → original request answered with live Gmail data.
7. Never claim connected until step-6 verification passes in a real run.

## 7. Related (separate, small)

- **vCard PHOTO:** the iMessage contact card is sent via `nativeContactCard()` from the `@spectrum-ts/imessage` package (`src/spectrum/index.ts:17`) with no avatar argument. Fix requires the package's contact-card builder to accept a hosted image URL (e.g. `https://getdinghy.sh/logo.png` — the little-ship Photon avatar already in `public/`) and embed it as a base64 `PHOTO:` property in the vCard. Either patch the package locally (`patch-package`) or upstream the option. Not implementable in-repo today (no options plumbed through).
- **Persona/opener:** implemented in this PR — see `src/spectrum/index.ts` `SYSTEM_PROMPT` (grounded in shipped capabilities only; approved opener "what's eating your time this week?").
- **`.env.example` Supabase placeholders:** already present in `dock/.env.local.example` (lines 12–14: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) — no change needed.
