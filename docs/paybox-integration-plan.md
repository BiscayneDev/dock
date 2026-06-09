# Paybox Integration — Working Brief

> Continuity note for the Paybox credential-management integration.
> Branch: `claude/paybox-dock-integration-lhdlzj`. Written before a planned
> session restart (network-policy change), so the next session resumes here
> instead of re-deriving the analysis.

## Goal

Integrate **Paybox** (https://paybox.sh) into Dock as the **backing vault for
user credentials** — Paybox becomes the store of record for secret material
(OAuth access/refresh tokens, API keys), and Dock holds only a reference plus
the Paybox auth, instead of today's "ciphertext in Postgres under one
`ENCRYPTION_KEY`" model.

## BLOCKER (resolve first)

Paybox docs were **not reachable** from the web session: the egress proxy
denies any non-allowlisted host (`x-deny-reason: host_not_allowed`).
`paybox.sh` is not on the allowlist, so the docs password (`paybox3645`) never
gets submitted. Confirmed `example.com` is also blocked while `api.github.com`
is allowed — it's the network policy, not Paybox.

**Action required:** allowlist `paybox.sh`, `www.paybox.sh`, and the API host
(likely `api.paybox.sh`) in the environment's network policy, then start a
fresh session on this branch. Once reachable, fetch the docs (password
`paybox3645`) before writing any code — do NOT build against a guessed API.

## How Dock manages credentials today (map of the seam)

- **`oauth_tokens` table** — `supabase/migrations/001_initial_schema.sql:20`.
  One row per `(user_id, provider)`. `access_token` / `refresh_token` stored as
  AES-256-GCM-encrypted JSON; also `expires_at`, `scopes`,
  `provider_account_id`, `provider_account_email`.
- **Encryption** — `src/lib/crypto.ts`. `encryptTokenForDb` /
  `decryptTokenFromDb`, key from `ENCRYPTION_KEY` env (hex).
- **Per-provider modules** — `src/lib/integrations/*.ts`
  (google, notion, github, whoop, oura, twitter = OAuth;
  `openwallet.ts` = API-key style, reuses `oauth_tokens` and stashes the
  endpoint URL in `expires_at`/`provider_account_id`). Each exposes the same
  shape: auth URL → exchange code → refresh → `store…Tokens` →
  `get…AccessToken` / `getDecrypted…Tokens`.
- **Auth routes** — `src/app/api/integrations/<provider>/auth/route.ts`,
  shared callback `src/app/auth/callback/[provider]/route.ts`, status at
  `src/app/api/integrations/status/route.ts`.
- **Consumption** — tools in `src/lib/tools/*` read decrypted creds via
  `UserContext.tokens[provider]` (`DecryptedTokens` in `src/lib/llm/types.ts:66`).
  This is the hot path — runs on every tool call.
- **Separately**, an MCP server registry exists (`/api/mcp`, the dashboard
  "Integrations" page) — not the target here.

## Plan

Introduce **one `CredentialStore` abstraction** that all `store…Tokens` /
`get…Tokens` paths and the `UserContext.tokens` hydration go through, so the
change is centralized rather than edited into all seven integration modules.

Pick the sub-shape based on the docs:

- **A — Secret store:** token JSON lives in Paybox at e.g.
  `users/<userId>/<provider>`; `oauth_tokens` keeps only a `paybox_ref`.
  Implement `PayboxStore`, keep the AES store as fallback.
- **B — KMS / envelope encryption:** keep ciphertext in Postgres, but have
  Paybox wrap each per-secret data key. Less hot-path latency (cache unwrapped
  DEK), least invasive. Prefer this if read latency / per-call cost is a
  concern.

Cross-cutting:
- Feature-flag the new store (per provider or per user).
- Lazy-migrate on next write; keep `decryptTokenFromDb` fallback so existing
  rows never break.

## Open questions for the docs

1. **Auth model** — per-app API key vs per-user OAuth vs service token + per-user
   namespacing. Drives how Dock authenticates to Paybox and isolates users.
2. **Secret model** — KV? versioned? path/namespace scoping per user?
3. **Read latency / rate limits** — decides A vs B (hot path).
4. **Raw secrets vs KMS** — does Paybox store secret values, or wrap keys?
5. Self-host vs hosted endpoint (mirrors the `openwallet` endpoint pattern?).

## Next steps (post-restart)

1. Verify `paybox.sh` is reachable; fetch + read docs (pw `paybox3645`).
2. Answer the open questions; choose A or B.
3. Draft the `CredentialStore` interface + `PayboxStore`.
4. Wire env vars (Paybox base URL / token), migration for `paybox_ref` if A.
5. Refactor integration modules onto the abstraction behind the flag.
6. Test, commit, push to this branch.
