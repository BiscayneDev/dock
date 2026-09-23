# Dinghy Delight Pass — Implementation Plan

> **For Hermes:** Execute via parallel subagents, one per workstream, each on its own branch cut from `origin/main`. Workstreams touch disjoint files (noted per task) so branches merge clean.

**Goal:** Close the trust gaps (spend guardrails), drop Notion, make memory user-level, and add the three cheapest delight wins (default-on morning briefing, presence, .ics attachments).

**Architecture:** Four branches off `main`. Workstream A (guardrails) touches `src/lib/orchestrator/confirmation.ts`, `src/lib/auth/magic-link.ts`, `src/app/api/waitlist/route.ts`, `src/app/admin/page.tsx`, payment tools. B (Notion removal) touches Notion files + `src/app/api/cron/engagement/route.ts` (one line). C (briefing + presence + .ics) touches NEW `src/app/api/cron/briefing/route.ts`, `src/lib/spectrum/handler.ts`, `src/lib/spectrum/dinghy.ts`, `src/lib/spectrum/actions.ts`, `src/lib/spectrum/imessage-tools.ts`. D (user memory) touches `src/lib/spectrum/memory.ts` + new migration. Only shared file risk: none overlap between branches.

**Tech stack:** Next.js 15, Supabase (pgvector RPCs), spectrum-ts, vitest. Verify with `npm run lint`, `npx tsc --noEmit`, `npm test` before every commit.

---

## Workstream A — Spend guardrails & security fixes (branch `feat/spend-guardrails`) — P0

**Files:** `src/lib/orchestrator/confirmation.ts`, `src/lib/tools/paybox.ts`, `src/lib/tools/wallet.ts`, `src/lib/payments/process-payment.ts`, `src/lib/llm/agent-loop.ts`, `src/lib/auth/magic-link.ts`, `src/app/api/waitlist/route.ts`, `src/app/admin/page.tsx`. New: `supabase/migrations/0XX_spend_caps.sql`, `src/__tests__/spend-caps.test.ts`, `src/__tests__/magic-link.test.ts`.

### Task A1: Expand CONFIRM_TOOLS
Add to `CONFIRM_TOOLS` (`confirmation.ts:4-10`): `paybox_request_swap`, `paybox_request_payment`, `paybox_request_wallet_sign`, `wallet_sign_message`, `x402_fetch`. Add matching `TOOL_DESCRIPTIONS` entries (emoji + short label, matching existing style). Confirm the confirm-flow path handles these tools' args the same way as `wallet_send` (read how `wallet_send` flows through `orchestrator/index.ts` before assuming).

### Task A2: Spend caps
- Migration: table `spend_limits (user_id uuid pk references auth.users, daily_usd numeric not null default 50, updated_at timestamptz default now())` with RLS (user selects/updates own row; service role full).
- Helper `src/lib/payments/spend-caps.ts`: `getDailySpend(userId): Promise<number>` (sum today's settled spend from existing payment/ledger rows — find the right table in `src/lib/payments/`) and `assertWithinCap(userId, amountUsd): Promise<void>` (throws when today's spend + amount > cap).
- Call `assertWithinCap` in `paybox_request_swap`, `paybox_request_payment`, `wallet_send`, and `processPayment` (`process-payment.ts:54`) before any money moves. Test: cap of 0 blocks, cap of 100 allows 99 but blocks 101 cumulative.

### Task A3: Magic-link single-use
`src/lib/auth/magic-link.ts` is pure HMAC + TTL (replayable for 15 min). Add a consumed-token table (migration) or a Supabase RPC `consume_magic_token(jti)` that returns true exactly once (insert with pk on jti; unique violation = already used). Embed a random `jti` claim in the token; `verifyMagicToken` consumes atomically BEFORE issuing the session. Test: first verify ok, second verify fails, wrong sig fails.

### Task A4: Waitlist rate limit + admin password
- `src/app/api/waitlist/route.ts`: add per-IP rate limiting (reuse `src/lib/rate-limit.ts` in-memory limiter — acceptable for now; note Supabase/Upstash as the follow-up in the PR body). 5 POSTs / IP / hour.
- `src/app/admin/page.tsx:38`: delete `ADMIN_PASSWORD` and the client-side gate entirely; rely on the existing server `getAdminSession` check. Update the page to show a "not authorized" state when the server session is absent.

**Verify:** `npm test`, `npx tsc --noEmit`, `npm run lint`. Commit each task separately with `fix:`/`feat:` messages.

---

## Workstream B — Drop Notion (branch `feat/drop-notion`)

**Files:** delete `src/lib/tools/notion.ts`, `src/app/api/integrations/notion/auth/route.ts`; edit every file in: `src/app/auth/callback/[provider]/route.ts`, `src/app/admin/page.tsx`, `src/app/dashboard/recipes/{gallery,workspace,marketplace/[id]}/page.tsx`, `src/app/api/workspace/chat/route.ts`, `src/app/api/integrations/status/route.ts`, `src/app/api/recipes/{parse,public}/route.ts`, `src/lib/orchestrator/system-prompt.ts` (remove notion from `allPossible`, capabilities, tool routing), `src/app/api/cron/engagement/route.ts` (drop the notion suggestion line only — do NOT restructure this route, another branch owns its redesign), plus `grep -rin notion src supabase/migrations docs` for stragglers.

### Task B1: Remove Notion tools, routes, and prompt references
Grep-driven removal. Keep the `oauth_tokens` rows harmless (no migration needed — orphaned rows are inert; note this in the PR body).

### Task B2: Remove Notion from UI/recipes/engagement copy
Recipes UI and marketplace references, integration status lists, engagement-day-3 suggestion line. Landing page has no Notion mention (verified) — double-check anyway.

**Verify:** `grep -rin notion src` returns nothing; `npm test`, `npx tsc --noEmit`, `npm run lint` clean.

---

## Workstream C — Morning briefing, presence, .ics (branch `feat/briefing-presence`)

### Task C1: Daily briefing cron (NEW file — do not edit `cron/engagement`)
Create `src/app/api/cron/briefing/route.ts`: Bearer `CRON_SECRET` auth (same pattern as engagement route, but do NOT gate on `telegramEnabled()`). For each user with google connected AND briefing enabled: pull today's calendar events + unread inbox count via existing tools (`src/lib/tools/gcal.ts`, `gmail.ts`), compose one short lowercase digest, deliver via the iMessage outbox (study `src/lib/spectrum/` outbox sweep + webhook send path — reuse the existing outbound-send mechanism; do not invent a new one). Respect quiet hours via `src/lib/time-utils.ts`.

### Task C2: Briefing opt-in state
Migration: `briefing_settings (user_id pk, enabled boolean default true, muted boolean default false, updated_at)`. Default-ON for users with google connected; the digest itself ends with `reply mute mornings to stop these` — and the handler honors that exact intent (wire in `src/lib/spectrum/handler.ts` confirmation parsing area). Add a `/briefing` behavior note in the Dinghy system prompt (`dinghy.ts`).

### Task C3: Presence — periodic typing re-tap
`src/lib/spectrum/handler.ts`: typing currently fires once (line ~79). Start an interval (every 5s, `typing()` via spectrum-ts) when a turn begins with tool use; clear it in the existing stop path. Must never throw into the reply path (follow the existing `.catch(logErr)` pattern).

### Task C4: 👍 reaction on confirmed actions
In `src/lib/spectrum/actions.ts`, after a proposal is accepted and executed successfully, send a thumbs-up reaction on the user's confirmation message (check `spectrum-ts` reaction API; if reactions aren't supported by the SDK, fall back to appending a standalone `👍` message and note that in the PR).

### Task C5: .ics attachment on event create
When a `gcal_create_invite` proposal is accepted, generate an .ics file (RFC 5545, minimal: SUMMARY/DTSTART/DTEND/ATTENDEE) and attach via the existing native-attachment path (study #41-45's `create_file` attachment sweep). Test the .ics string generation with vitest (pure function — put it in `src/lib/spectrum/ics.ts`).

**Verify:** `npm test`, `npx tsc --noEmit`, `npm run lint`. The briefing route can be smoke-tested locally with a fake `CRON_SECRET` + one test user.

---

## Workstream D — User-level memory (branch `feat/user-memory`)

**Files:** `src/lib/spectrum/memory.ts` (all calls keyed by `chat_guid` today), new `supabase/migrations/0XX_user_memory.sql`, `src/__tests__/user-memory.test.ts`.

### Task D1: User-keyed memory tables/RPCs
Read migration 024 first (the `dinghy_memory_context`, `recent_chat_memories`, `claim_memory_update` RPCs). Add user-level variants: memories rows gain nullable `user_id`; new RPCs `dinghy_user_memory_context(p_user_id)`, `claim_user_memory_update(p_user_id, p_every)` that read/write across that user's chats. Tag each memory row with `source_channel` (e.g. 'imessage') at insert.

### Task D2: Switch the call sites
`memory.ts`: resolve `chat_guid → user_id` via the existing `spectrum_identities` binding (migration 011); use user-level RPCs when bound, fall back to chat_guid RPCs for unbound/guest chats. Keep the existing claim/lease semantics exactly (UPDATE_EVERY cadence).

### Task D3: Extraction + injection parity
Fact extraction and memory rendering (`renderMemoryBlock`) work unchanged over the user-scoped set. Test: two chats, same user — fact written in chat A is retrievable in chat B; guest chat is isolated.

**Verify:** `npm test`, `npx tsc --noEmit`, `npm run lint`. Manually verify RPCs against a local/branch Supabase if available; otherwise validate SQL syntax carefully and flag for review.

---

## Merge order
A (guardrails) first — nothing else touches its files, merge immediately when green. Then B, C, D in any order; C's presence work and D's memory work are independent. After all four: redeploy (Vercel, in-repo) and re-run the live check.

## Explicitly out of scope
Voice (SIP), Notion replacements, GitHub tools on iMessage (defer), PDF drafting suggestions, message effects.
