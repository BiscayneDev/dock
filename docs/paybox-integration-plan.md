# Paybox Integration — Plan

> Docs read on 2026-06-09 from **https://docs.paybox.sh/** (now reachable — the
> egress allowlist blocker below is resolved). This revises the earlier brief,
> whose core premise turned out to be wrong once the real docs were available.

## What changed after reading the docs

The earlier brief assumed Paybox was a **writable backing vault** Dock would push
user OAuth tokens / API keys into (Plan A "secret store", Plan B "KMS / envelope
encryption"), making it the store of record behind `oauth_tokens` + `crypto.ts`.

**That is not what Paybox is.** Per the docs:

- There is **no programmatic vaulting / write API**. "Credential vaulting, client
  management, approvals, and audit are done by the user in the Paybox app — they
  are not a public API" (`/api-reference`). Dock cannot stuff Google/Notion/etc.
  refresh tokens into Paybox automatically.
- The entire developer surface is **OAuth 2.1 (authorize) → MCP (act)**. An agent
  never receives a raw credential — it gets a **scoped output**: a one-time
  virtual card, a signature, or a short-lived secret token.
- Credentials are user-curated and of three kinds: **card** (Basis Theory),
  **wallet** (MoonX MPC), **secret** (envelope-encrypted). Not an arbitrary KV
  secret store Dock can read/write by key.

So Plans A and B from the old brief are **infeasible** and are dropped. Paybox
does not replace Dock's `oauth_tokens` ciphertext-in-Postgres model.

## What Paybox actually is (and where it fits in Dock)

A **passkey-gated credential vault for AI agents**. The right framing for Dock is:
Paybox is a new **agent-capability provider** — it gives Dock's agent the ability
to **pay, sign, reveal secrets, and swap** on behalf of the user, each operation
scoped by a user-approved grant and gated by a passkey step-up. This sits
naturally alongside Dock's existing money/crypto surface (`openwallet` +
`src/lib/tools/wallet.ts`, `/api/payments`, x402) and the agent loop — **not**
behind the credential-encryption seam.

### The Paybox surface (what we integrate against)

- **Origins:** API/OAuth issuer + MCP = `https://api.paybox.sh`; consent UI =
  `https://app.paybox.sh`. MCP endpoint: `POST https://api.paybox.sh/mcp`
  (streamable HTTP, protocol `2025-06-18`), `Authorization: Bearer <token>`.
- **Auth:** OAuth 2.1 Authorization Server, **authorization-code + PKCE (S256)**,
  **public clients only** (`token_endpoint_auth_method=none`, no client secret),
  **dynamic client registration** (RFC 7591) at `/oauth/register`. Discovery at
  `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`.
  Scopes: `mcp`, `offline_access` (opt-in for a refresh token).
- **Tokens:** access = JWT, 60 min, audience-bound to the MCP resource. Refresh =
  opaque, 30-day sliding, **rotated on every use** (must persist the new one;
  replaying a spent token revokes the client). Auth code single-use, 5 min.
- **MCP tools** (`/reference/mcp-tools`): `list_credentials`, `request_payment`,
  `request_secret`, `request_wallet_sign`, `request_swap`, `get_portfolio`,
  `get_request`.
- **Result envelope / lifecycle** (`/concepts/requests`): write tools return a
  `status`: `success` (use `output`), `pending_approval` (surface `approval_url`,
  user approves with passkey, then poll), `pending_signature` (signing window /
  SDK finishes it, then poll), `denied` (`reason`), `error` (`message`).
  **Golden rule: submit once, then poll `get_request` by `request_id` — never
  re-call a write tool to "finish" it** (that double-charges / double-signs).
- **SDK/CLI** (`/sdk-cli`): `@paybox-sh/sdk` + `paybox` CLI mirror the tool
  surface over REST (no MCP host), and can sign **in-process** using a `pbxk1.`
  signing key (non-custodial; the MoonX secret never reaches the client).

### Architectural caveat that drives scope (important)

Wallet **signing never happens in agent code**. Normally the MCP *host* renders an
in-chat **signing window** (`ui://paybox/wallet-sign`) that signs client-side via
MoonX MPC. **Dock is a server-side agent (Next.js) with a Telegram/web chat — it
does not render an MCP host signing window.** Consequences:

- `request_payment` and `request_secret` complete **fully server-side** over
  MCP/REST → these work today with just OAuth.
- `request_wallet_sign` and `request_swap` will **stall at `pending_signature`**
  unless Dock signs in-process via `@paybox-sh/sdk` with a provisioned `pbxk1.`
  signing key. So wallet sign/swap is a **later phase** requiring the SDK + key
  provisioning, not the MCP-only path.

## How Dock is built (the seam we plug into)

- **Per-provider integration modules** — `src/lib/integrations/*.ts`. Each does
  auth-URL → exchange-code → `store…Tokens` → `getDecrypted…Tokens`, persisting to
  the `oauth_tokens` table (`(user_id, provider)`, AES-256-GCM via
  `src/lib/crypto.ts`). **Twitter already implements OAuth 2.1 + PKCE** with a
  cookie-stored code verifier (`src/lib/integrations/twitter.ts`, callback in
  `src/app/auth/callback/[provider]/route.ts`) — Paybox's PKCE flow mirrors it.
- **Auth routes** — `src/app/api/integrations/<provider>/auth/route.ts` start the
  flow; shared callback `src/app/auth/callback/[provider]/route.ts`; connection
  state in `src/app/api/integrations/status/route.ts`.
- **Agent tools** — `src/lib/tools/*.ts`, each a `Tool` (`{name, description,
  inputSchema, execute(input, ctx)}` → `ToolResult {success, data?, error?}`),
  registered in `src/lib/tools/index.ts`. Tools read creds via
  `ctx.tokens[provider]` (`UserContext`, hydrated from `oauth_tokens`). The
  closest analog is `src/lib/tools/wallet.ts` over `openwallet`.
- **Existing MCP registry** — `src/lib/mcp/client.ts` + `/api/mcp`,
  `mcp_connections` table. It already speaks streamable-HTTP MCP, discovers +
  caches `tools/list`, and proxies `tools/call` with a Bearer token into the
  agent loop. **But** its `oauth` auth type only accepts a **pre-pasted**
  `accessToken` in `auth_config` — there is **no** code to run PKCE / dynamic
  registration / refresh, and its generic text-proxy does not understand
  Paybox's `pending_approval` / `get_request` poll lifecycle.

## Recommended approach: first-party `paybox` provider (Shape 2)

Treat Paybox like the other providers (own integration module + typed tools),
because it needs (a) the OAuth 2.1 PKCE + dynamic-registration + rotating-refresh
dance, and (b) explicit handling of the submit→poll + `approval_url` lifecycle —
neither of which the generic MCP proxy does. Reuse `mcp/client.ts`'s low-level
`mcpRequest` JSON-RPC transport rather than reimplementing it.

(Alternative — *Shape 1*: teach the MCP registry's `oauth` path to do PKCE+DCR and
add `api.paybox.sh/mcp` as a managed connector. Less new surface, but the generic
proxy returns raw text and can't cleanly surface `approval_url` or run the poll
loop, so payments/secrets UX suffers. Not recommended as the primary path.)

### Phase 1 — Connect + read + pay/reveal (MCP-only, no signing key)

1. **`src/lib/integrations/paybox.ts`**
   - `getAuthUrl()`: dynamic-register a public client once (cache `client_id`),
     build `/oauth/authorize` with PKCE S256 (`scope=mcp offline_access`,
     `resource=https://api.paybox.sh/mcp`); store `code_verifier` in a cookie like
     Twitter.
   - `exchangePayboxCode(code, verifier)`: POST `/oauth/token`; return access +
     refresh + `expires_at`.
   - `storePayboxTokens` / `getDecryptedPayboxTokens`: reuse `oauth_tokens` with
     `provider='paybox'` (access in `access_token`, refresh in `refresh_token`,
     `expires_at`). Add `refreshPayboxToken` that **persists the rotated refresh
     token** every time, and is called when the JWT is near expiry.
   - A thin `PayboxClient` over `mcpRequest` (from `mcp/client.ts`) exposing the
     seven tools and a `pollRequest(request_id)` helper.
2. **Auth route** `src/app/api/integrations/paybox/auth/route.ts` (mirror twitter);
   add a `case 'paybox'` to the shared callback; add `paybox` to the status route.
3. **`src/lib/tools/paybox.ts`** — typed tools registered in `tools/index.ts`:
   `paybox_list_credentials`, `paybox_request_payment`, `paybox_request_secret`,
   `paybox_get_request`. Each maps the result envelope to `ToolResult`:
   on `pending_approval`, return `success:true` with the `approval_url` + a clear
   "ask the user to approve in the Paybox app, then call `paybox_get_request`"
   instruction (surfaceable over Telegram/chat); on `success`, return `output`.
   Hold `request_id`; never re-issue the write call.
4. **Env:** `PAYBOX_API_URL` (default `https://api.paybox.sh`),
   `PAYBOX_REDIRECT_URI`. No client secret (public client). Persist the registered
   `client_id` (env or a small row) so we don't re-register per user.

### Phase 2 — Wallet signing + swaps (needs the SDK + signing key)

5. Add `@paybox-sh/sdk`. Provision a per-user `pbxk1.` signing key (the app's
   signing-key page, scoped to granted wallets) and store it encrypted alongside
   the Paybox tokens. Add `paybox_request_wallet_sign` / `paybox_request_swap` /
   `paybox_get_portfolio` that sign in-process via the SDK, so they don't stall at
   `pending_signature`. Without the key, gate these tools off (mirror the CLI's
   `canSign`).

### Cross-cutting

- Surface `approval_url` to the user through Dock's existing chat channel; the
  agent must wait for approval and poll, not retry.
- Audit every Paybox op in Dock's logs (Paybox also keeps its own audit trail).
- Feature-flag the provider; ship Phase 1 first.

## Open questions (smaller now)

1. **Dynamic registration cadence** — one Dock-wide `client_id`, or one per user?
   (One Dock-wide public client is simplest; the per-user grant set lives in the
   token, not the client.)
2. **Phase-2 signing-key provisioning UX** — can the `pbxk1.` key be minted in a
   headless/server flow, or does it require the user in the Paybox app each time?
3. Do we want `request_secret` with `raw:false` (paybox-mediated egress token) vs
   `raw:true` (plaintext) — default to `raw:false` so secrets never transit the
   model.

## Env vars (Phase 1)

- `PAYBOX_API_URL` — optional, defaults to `https://api.paybox.sh`.
- `PAYBOX_REDIRECT_URI` — optional, defaults to
  `${NEXT_PUBLIC_APP_URL}/auth/callback/paybox`. Must match the registered
  redirect exactly (HTTPS, or `http://localhost` for dev).
- `PAYBOX_CLIENT_ID` — optional. If set, reuse this app-wide public client;
  otherwise a public client is dynamically registered per connect and its
  `client_id` is stored on the token row (`provider_account_id`).

No client secret (Paybox public clients only). Reuses the existing
`ENCRYPTION_KEY` for token-at-rest encryption.

## Phase 1.5 — Make Paybox necessary (adoption / lock-in)

Decision: **gate money + secret actions** behind a Paybox connection, with
Paybox as the **default** rail and the existing rails (OpenWallet, x402) kept as
**fallback** executors. Read-only tools (balances, prices, search) stay open.

How it resolves the two states:
- **Paybox not connected** → gated money/secret tools refuse with a standard
  "Paybox required" result (`payboxRequired()` in `integrations/paybox.ts`) that
  carries the connect URL (`/api/integrations/paybox/auth`). The agent is told
  *not* to improvise another payment path — it surfaces the link, which starts
  Paybox OAuth and **creates the account** (email + passkey) if the user has
  none. This is the conversion funnel.
- **Paybox connected but can't serve the op** (e.g. Phase-1 wallet signing gap,
  or a `denied`) → the existing rail runs as the fallback so the user isn't
  blocked.

Gated tools: `wallet_send` (OpenWallet spend), `x402_fetch` (paid call), and the
Paybox tools themselves. The agent's system prompt now states money/secrets run
on Paybox and to push account creation when it's missing. Onboarding tile is
relabeled "Required to authorize payments & secrets".

Note: this changes behavior for existing users — someone with OpenWallet but not
Paybox can no longer spend until they connect Paybox. That is the intended
lock-in. As Phase 2 lands, `wallet_send` / `x402` signing routes *through*
Paybox rather than just being gated by it.

## Phase 2 — Wallet signing, swaps, portfolio (built)

Adopted the official **`@paybox-sh/sdk`** (v0.5.0) and refactored the whole
integration onto it, replacing the hand-rolled MCP client from Phase 1 (the part
flagged as unverified). The SDK talks to Paybox's REST `/agent/*` surface using
the same OAuth bearer token we already mint, returns typed `AgentResponse`s, and
signs wallet ops **in-process / non-custodially** with a `pbxk1.` key (the MoonX
secret never reaches Dock). It's fully bundled (no `@paybox/mcp-app` runtime dep)
and typechecks under `skipLibCheck`.

- `getPayboxSdk(tokens, userId)` builds the SDK client with a fresh access token
  (+ the signing key when present). `agentResultToTool` maps `AgentResponse` to
  Dock's `ToolResult`, preserving the submit→poll lifecycle (no `approval_url` on
  the REST surface — we surface `approval_id` + the app URL instead).
- New tools: `paybox_request_wallet_sign` (message / typedData / transaction /
  solana intents), `paybox_request_swap`, `paybox_get_portfolio`. Sign/swap
  complete immediately on an autonomous grant + a configured signing key,
  otherwise return `pending_signature` / `pending_approval` and poll.
- **Signing key provisioning:** migration `005_paybox_signing_key.sql` adds an
  encrypted `signing_key` column on the paybox token row; `POST/DELETE
  /api/integrations/paybox/signing-key` stores/clears it; the onboarding page
  grows a "Paybox signing key" tile (only once Paybox is connected) to paste the
  `pbxk1.` key. Reads are tolerant — pre-migration or no-key just means sign/swap
  stall at `pending_signature`.

**Must apply migration 005** to the live DB for signing-key storage to work.

Follow-up worth doing: route Dock's x402 spend through Paybox via the SDK's
`useService` / `payX402` / `discoverServices` (the gate already requires Paybox
for `x402_fetch`), retiring the OpenWallet-backed x402 signer.

## Skill surface — coverage of MoonPay's agent products

Two distinct MoonPay agent products; Dock now covers both:

- **Paybox CLI/SDK** (`@paybox-sh/sdk`) — integrated first-party. Dock now
  exposes the **full v0.5.0 tool surface**: `list_credentials`,
  `request_payment`, `request_secret`, `request_wallet_sign`, `request_swap`,
  `get_portfolio`, `get_request`, plus the x402/Bazaar trio
  `discover_services`, `use_service`, `pay_x402`. (`use_service` is also wired
  into `x402_fetch` as the default rail.)
- **MoonAgents** (`moonpay.com/agents`, `@moonpay/cli`) — onramp / offramp /
  swap / card / Open Wallet Standard. These are delivered by running
  `mp mcp` (a local MCP server) and connecting it, which Dock already supports
  via its **MCP connector registry** (`/dashboard/integrations`, featured
  "MoonPay Agents" tile). Tools are auto-discovered, so they stay current
  without hardcoding — nothing to add in-tree.

## Security hardening (Supabase advisories)

Applied alongside this work:
- `006` — enable RLS on `engagement_events` (was fully exposed to the anon
  key; service-role-only table, so no policies needed). CRITICAL → resolved.
- `007` — drop the permissive public `INSERT (WITH CHECK true)` / `UPDATE
  (USING true)` policies on `recipe_payments` (anyone could forge a paid
  record); writes are service-role only, owner-scoped SELECT kept. WARN →
  resolved.

Remaining (pre-existing, not addressed — your call): `health_documents` public
bucket allows listing, Auth leaked-password protection disabled, Postgres
security patches available.

## Status / next steps

- [x] Egress allowlist resolved; docs fetched and read.
- [x] Plan corrected against real docs (this file).
- [x] Phase 1: `paybox.ts` integration + PKCE/DCR auth + callback + status.
- [x] Phase 1: `tools/paybox.ts` (list / pay / secret / get_request) + register.
- [x] Phase 1: onboarding connect tile.
- [x] Phase 1.5: gate money/secret tools on Paybox + signup deep-link + agent policy.
- [x] Phase 2: `@paybox-sh/sdk` refactor + `pbxk1.` signing key → wallet sign /
      swap / portfolio, with provisioning endpoint + onboarding UI + migration 005.
- [ ] Apply migration 005 to the live DB.
- [ ] Live end-to-end test against a real Paybox account: OAuth consent, a secret
      round-trip, and a wallet sign + swap with a real `pbxk1.` signing key.
      Untestable here without an account + passkey.
- [ ] Follow-up: route x402 through Paybox (`useService` / `payX402`).
