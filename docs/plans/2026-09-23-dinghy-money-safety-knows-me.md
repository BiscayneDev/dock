# Dinghy — Money Safety + Knows-Me Pass

> **For Hermes:** Execute via SOLO subagents, sequentially (never parallel in this repo). Branch off latest `origin/main`. Dedupe migration numbers before merge (next free: 037).

**Goal:** Close the two remaining trust gaps (spend ledger, x402 recipe injection surface) and the three cheapest "knows me" wins (memory transparency, day-1 interview, extraction cadence audit).

---

## Workstream E — Money safety (branch `feat/spend-ledger`)

### Task E1: Shared spend ledger
- New migration (037+): `spend_events (id uuid pk default gen_random_uuid(), user_id uuid not null, source text not null check (source in ('paybox_payment','paybox_swap','wallet_send','x402','recipe')), amount_usd numeric not null, currency text, memo text, created_at timestamptz default now())` — RLS on, user read-only, service-role writes.
- Helper `src/lib/payments/spend-caps.ts`: add `recordSpend(userId, source, amountUsd, memo)`. Replace the `recipe_payments`-only sum in `getDailySpend` with a sum over `spend_events`.
- Write `recordSpend` from: `paybox_request_payment`, `paybox_request_swap` (on settlement, not request), `wallet_send`, `x402_fetch` (paid calls only), `processRecipePayment` (keep its existing pending-record flow; add the ledger row).
- `wallet_send` amounts are native units without a USD price — record `amount_usd = 0` plus the raw amount in `memo` (or a `native_amount` text column) so the row exists and the over-cap block still applies. Note the USD-pricing follow-up in the PR body.
- Vitest: cap counts cumulative spend across sources; ledger write failure fails closed (block the spend, don't just log).

### Task E2: x402 recipe execution sandbox
`src/app/api/x402/recipes/[id]/execute/route.ts` (~:76-95) currently loads the creator's full user context and tool set and feeds untrusted `userInput` into the LLM. Change: build a read-only tool subset (web search/fetch, plus explicit read tools only — no gmail_send, no wallet/paybox, no deletes, no recipes, no spend). Execute with a restricted context that cannot reach the creator's tokens for write paths. Document the allowed tool list in a comment. Test: the tool list exposed to an execution contains no write/spend tools.

**Verify:** `npx tsc --noEmit` clean; no NEW vitest/lint failures (baseline: 7 undici failures, 3 lint errors). `git push -u origin feat/spend-ledger`; no merge/deploy.

---

## Workstream F — Knows me (branch `feat/knows-me`)

### Task F1: `/memory` transparency in iMessage
In `src/lib/spectrum/` (handler + a new small module or memory.ts additions): support `/memory` → list the user's profile facts + recent memories (via the user-keyed RPCs from 035, chat fallback for guests), rendered as a short lowercase list. Support "forget X" / "forget that" intent → delete matching memories (there is prior art: the old `memory_forget` tool in git history on `feat/native-memory`). Confirmation for destructive forgets: "forgot that" is fine to do directly for single facts; bulk clears require a yes (reuse the pending-action confirm pattern in `actions.ts` only if simple — otherwise an explicit "reply YES to wipe all" gate).

### Task F2: Day-1 interview
On first bound message (opener gate already exists — find it in `dinghy.ts`/handler), after the opener question gets a substantive reply, ask at most 2 short follow-ups across separate turns spread naturally: confirm what to call them, and one "what should mornings look like?" Store answers as profile facts via the existing extraction path. Never more than 2 questions total; skip if the user's first message already answers them.

### Task F3: Extraction cadence audit + fix
Check current main: is fact extraction gated on every-Nth-message (`% 10` or the 035 `claim_user_memory_update` `p_every`)? If yes, lower to run over the gap since last claim (messages since previous extraction), keeping the claim/lease semantics — goal: no stated personal fact waits more than a few messages to be extracted. Keep cost sane: one cheap extraction call per claim window.

**Verify:** same gates. `git push -u origin feat/knows-me`; no merge/deploy.

---

## Merge order
E first, then F (F touches memory.ts which E doesn't). Renumber F's migrations if E took 037. After merge: apply migrations to prod (remember the `public.users` FK lesson from PR #60), redeploy, smoke-test `/memory` and one capped spend.
