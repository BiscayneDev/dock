# PayBox gaps blocking Dinghy wallet sends and the token vault

Status: proposal for the PayBox side. Written from Dinghy's integration against `@paybox-sh/sdk` 1.0.0 and docs.paybox.sh (concepts/requests, reference/mcp-tools, sdk-cli), Sep 23 2026.

Dinghy is an iMessage agent running on serverless (Vercel). It has no browser and no MCP host UI. Every user action happens on a web page we text them (a branded link). These two gaps are what stop Dinghy from shipping sends ("send 20 USDC to sam.eth") and a tokens-only vault on public PayBox surfaces.

---

## Gap 1: an approved `wallet_sign` can't be finished by a server

### Today

- `requestWalletSign()` POSTs `/agent/wallet-sign`. It signs in-process only when PayBox answers `pending_signature` right away (autonomous grant) **and** the client has a pbxk1 signing key (`chunk-SMPW2GUM.js` ~878).
- Under an `always_approve` grant it returns `pending_approval`, and nothing public takes it further:
  - `waitForApproval` exists for `requestSwap` / x402 / `useService` (`completeSwap` ~926), not for `requestWalletSign`.
  - The helper that would finish it, `signWalletRequest()` (~579: `/agent/requests/:id/moonx-sign`, then `/agent/requests/:id/signature`), is internal and not exported.
  - `getRequest()` after approval only reports status; it doesn't sign.
- On MCP hosts the `ui://paybox/wallet-sign` signing window finishes the flow. iMessage has no window.
- Every in-process path also needs the user's pbxk1 signing key on the agent server. For a hosted agent serving many users, that means holding a signing key per user. The only way to get one today is pasting it in.

Result: "passkey approval" plus "server executes the send" isn't possible on the public SDK. The only workable option is autonomous grants, which skip the passkey. We won't ship that for sends.

### Proposal (either A or B unblocks us; B is the better product)

**A. SDK: resume-sign for approved wallet_sign**

```ts
// Mirrors completeSwap: wait while pending_approval, then sign in-process.
client.requestWalletSign(args, { waitForApproval: { timeoutMs, intervalMs } })

// Resume a request created earlier (serverless: the approval arrives on a later invocation).
client.completeWalletSign(requestId, intent): Promise<RequestResponse>
```

`completeWalletSign` = `getRequest` → if `pending_signature`, `signWalletRequest(...)` with the stored binding → `requestAfterSign`. It must be idempotent: calling it twice after a lost response returns the final state and never double-signs. That matches `signWithReconcile`.

This still needs a signing key on our server, so A alone is only acceptable for self-hosted agents.

**B. Hosted approve-and-sign (preferred)**

The request response carries a URL where the user reviews, approves with passkey, and **PayBox signs and broadcasts** in the same step. The agent never holds a signing key.

```jsonc
// POST /agent/wallet-sign  ->  pending_approval
{
  "request_id": "req_…",
  "status": "pending_approval",
  "approval_url": "https://app.paybox.sh/approve/req_…?return_to=<registered redirect>",
  "expires_at": "…"            // existing ~10 min approval TTL
}
```

- `return_to` must be a redirect URI already registered for the OAuth client, so Dinghy can land the user back on its success page.
- Terminal states are readable via `getRequest(id)`: `completed` (with `tx_hash`, `chain`), `rejected`, `expired`, `failed` (with reason). A webhook to the client on terminal state would let us drop polling. Nice to have.
- The approval screen shows exactly what the agent can't fake: amount, token, chain, recipient (with ENS/SNS if resolved), fees, and the agent/client name.

With B, Dinghy's flow becomes: the model proposes → we call `requestWalletSign` → we text the user the `approval_url` (branded interstitial on getdinghy.sh that shows the same summary, then hands off) → the user approves with passkey on PayBox → our sweep sees `completed` and texts the tx link.

### Acceptance

- The user can approve an ERC-20 transfer and a native SOL transfer on a phone browser with only a passkey, and the agent server holds no signing key.
- Approval-then-execute survives the agent process dying between create and approve (state lives in PayBox).
- A replayed or reused `approval_url` after a terminal state shows the final state and does nothing.

---

## Gap 2: a `secret_token` (raw=false) can't be used against anything

### Today

`request_secret` with `raw: false` returns "a one-time-use `secret_token` for PayBox-mediated egress" (reference/mcp-tools). Nothing documents what egress means: no endpoint, no header format, no scope. So a tokens-only secret can't call a third-party API, and Halsey chose tokens-only ("Tokens only", no plaintext grants ever).

### Proposal: an authenticated egress proxy

```
POST https://api.paybox.sh/agent/egress
Authorization: Bearer <agent access token>
X-PayBox-Secret-Token: <secret_token>
Content-Type: application/json

{
  "method": "POST",
  "url": "https://api.example.com/v1/things",
  "headers": { "Content-Type": "application/json" },
  "body": "…",
  "inject": { "header": "Authorization", "format": "Bearer {secret}" }
}
```

- PayBox resolves the token to its secret, injects it (header, query param, or basic-auth), makes the call, and returns `{ status, headers, body }` with the secret redacted from any echo.
- Each token is single-use, bound to the credential and to an allowlisted host set on the grant (e.g. `api.openai.com`), with a short TTL. A request to another host is refused before any network call.
- Audit entry per use: agent, credential, host, path, status. The user can see and revoke it in PayBox.
- Limits: body size caps, streaming optional, timeouts documented.
- SDK: `client.egress({ secretToken, request, inject })`.

### Acceptance

- Dinghy can call a third-party API with a user's key without ever seeing the key.
- A token can't be replayed, can't reach an unlisted host, and every use shows in the user's audit log.

---

## What Dinghy builds once these exist

- Sends: a `wallet_propose_send` tool, the review interstitial at `/approve/[id]`, and sweep polling (or webhook) that texts the outcome. No autonomous sends.
- Vault: a `use_secret` tool that only ever calls `egress` with `raw: false` hardcoded; `request_account_change` manage links for adding secrets.
- Meanwhile we can ship **swaps** with passkey approval (`requestSwap` + `waitForApproval` already works), but that still needs a per-user signing key collected through a web form, never a text.
