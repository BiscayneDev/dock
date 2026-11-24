# Dock transformation plan: the coordination spine for human+agent work

Status: plan for review. Written 2026-11-24.
Inputs: John Suh's "Agent platform 2027" blueprint (@john_ssuh, 2026-11-22), Multica's 170k-runs/day field notes (@jiayuan_jy, 2026-11-23) and teardown of multica-ai/multica, Harrison Chase's "knowledge factory" (LangChain, 2026-11-21), plus a late-2026 landscape scan.
Scope: product/engineering transformation of `~/dock`. Planning only — no code changes until the decisions in §9 are answered.

---

## 1. Thesis

The three inputs converge on one product skeleton, reached independently:

1. **The work record is the unit of coordination**, not chat. Humans assign, agents execute, state lives on the record.
2. **The inbox is the primary human interface.** Not a prompt feed — a queue of approvals, reviews, questions and blockers, each carrying its artifact and rationale inline.
3. **Conversation != session.** User-facing threads persist; runtimes/models swap underneath.
4. **Agents wake on conditions, not cron.** Event listeners with filters, dedupe and replay beat hourly timers.
5. **Knowledge is maintained, not written once.** Skills + domain knowledge + data-access guidance, kept current by a flag → curator loop with human-approved writes.
6. **Permissions follow the human, not the machine.** Owner-chain attribution, deny-by-default, task-scoped credentials.
7. **Run economics are a product surface.** Cache-hit rate, coordination-token tax, liveness-based expiry, and infra-vs-agent error classification decide whether a fleet is viable.

Dock already owns real plumbing for all seven (`lib/briefs*.ts`, `lib/queue.ts`, `lib/task-runs.ts`, `lib/approval-card.ts`, `lib/memory-core.ts`, `lib/schedules.ts`, `lib/devices.ts`, `lib/tool-permissions.ts`). The transformation is therefore **consolidation and completion, not a rewrite**: collapse ~24 competing surfaces around Inbox + Work, finish the knowledge loop, add listeners and per-run identity, and make cost/liveness legible.

**Explicit counter-bet.** Suh predicts "one and only application layer." We bet the opposite: the market fragments by trust boundary and harness. Dock stays multi-workspace, self-hostable, and harness-agnostic — which is already encoded in `lib/token-scoping.ts` (reject `DOCK_AGENT_TOKEN` when more than one workspace exists) and the `devices`/`runtimes` split. Do not chase a single global everything-OS.

---

## 2. Evidence → principle → Dock status

| # | Principle | Strongest evidence | Dock today | Verdict |
|---|---|---|---|---|
| 1 | Work record > chat | Multica: "Chat is for intent; an issue board is the coordination protocol"; 170k runs/day | Tasks board, briefs + append-only ledger (`lib/briefs.ts`, migration 0007) | **Keep, make primary** |
| 2 | Inbox is the human front door | Suh "Inbox"; Multica: humans shifted to reviewing/approving/unblocking; bottleneck is review bandwidth | Fragmented: Gmail-only `/api/inbox` (returns `[]` on Vercel), Agent Inbox inside Missions (`components/tasks/AgentInbox.tsx`), approvals inside Assistant (`components/assistant/ApprovalCard.tsx`), plus `/alerts`, `/activity` | **Gap — build one inbox** |
| 3 | Conversation != session | Suh: raw sessions are debugging UI; Multica: "single-session coding wrappers break" | `lib/conversations.ts` + `app/api/sessions` exist, but sessions are still surfaced as product UI | **Partial — make explicit** |
| 4 | Condition triggers > cron | Suh "listeners, monitors"; Multica: "wait on conditions, not cron timers" | `lib/schedules.ts` supports hourly/daily/weekly only (comment claims cron expressions; switch defaults to hourly). One inbound Dinghy webhook path | **Gap — add listeners** |
| 5 | Knowledge maintained by a loop | LangChain: flag tool + curator agent + three knowledge types; storage deliberately non-prescriptive | Extract-only memory (`lib/memory-core.ts`: remember/recall/forget/extractFacts). No flag tool, no curator, no data-access-guidance type, no provenance/trust tier, DB rows not portable artifacts | **Gap — build the loop** |
| 6 | Permissions follow the human | Multica: "permissions must follow the human, not the machine"; task-scoped tokens, deny by default | Per-connection connector tokens with owner attribution (`lib/connector-rules.ts`); tool modes (`lib/tool-permissions.ts`); device leases. Instance-wide `DOCK_AGENT_TOKEN` remains, correctly rejected in multi-workspace | **Partial — add per-run scoped identity** |
| 7 | Economics are a surface | Multica: 93% of parallel-work tokens are cache reads; up to 29% of tokens go to coordination/polling; 36% of failures are offline machines | Budgets + spend caps + Shipyard cost telemetry (`/api/costs`, `/api/company/budgets`, `/api/projects/[name]/spend`). No cache-hit metric, no coordination accounting, no liveness expiry, no retry taxonomy | **Gap — instrument** |

---

## 3. Current state (verified against `~/dock`, 2026-11-24)

Inventory: 24 pages, 101 API routes, 60 lib modules, 11 migrations, 25 test files. HEAD `7755df9`.

**Assets to protect**
- Brief → ledger → approval invariants (only an approved brief creates a run; ledger append-only; outcome hook never throws into the run).
- Queue/lease model with heartbeats (`lib/queue.ts`, migration 0005) and checkpoint/resume (`lib/task-runs.ts`, `lib/run-resume.ts`).
- Tool-mode permission split plan/build/explore (`lib/tool-permissions.ts`) and kanban-state mapping.
- Plan-review graph (`lib/plan-graph.ts`, `components/tasks/`), diagnostics tool, SKILL.md import (`lib/skills-skillmd.ts`), watermark-deduped scheduled intel.
- Connector security: hashed secrets, single-use pairing, replay window, approval-hash binding (`lib/connector-rules.ts`, `lib/connector-events.ts`).
- Tenancy RLS, workspace scoping, `tokenScoping` fail-closed.

**Defects worth fixing during the transformation**
- `app/api/inbox/route.ts` is a Gmail reader, not an agent inbox, and silently returns `[]` in production (Vercel).
- `AgentInbox` has Reject and Retry hard-disabled ("Not wired yet"), so review is approve-only.
- `lib/schedules.ts` documents cron expressions but implements hourly/daily/weekly only.
- Duplicate migration numbers already exist (`0008_connector.sql` vs `0008_project_monthly_cap.sql`; `0009_memory.sql` vs `0009_task_assignments.sql`). Next migration numbers must be taken from the union of `origin/main` and untracked files.
- README/CLAUDE.md describe an older product (create-shipyard-app wizard, Vic naming). Docs drift is itself a coordination cost; refresh in WS2.

---

## 4. Target information architecture

Proposal — five surfaces instead of twenty-four top-level pages. Routes stay (bookmarks, deep links, API consumers); navigation collapses.

| Surface | Route | Absorbs | Purpose |
|---|---|---|---|
| **Inbox** | `/inbox` | Agent Inbox, approvals, `/alerts`, notifications, Gmail/Calendar surfaces | Everything waiting on a human: approve, reject-with-reason, answer, reassign, snooze. One decision per card, artifact + rationale inline, verdict recorded. |
| **Work** | `/work` | Missions board, briefs, Command Deck, runs/activity, projects, intel, calendar, company goals | The exec-brief surface: today's plan, records by state, run trace, project war room. Command Deck becomes the top of Work, not its own page. |
| **Agents** | `/agents` | roster, skills, per-agent knowledge/budgets, runtimes | Who does what, with which permissions and playbook. |
| **Knowledge** | `/knowledge` | `/memory`, skills library, flag/curator queue | Beacon surface: facts, skills, data-access guidance, trust/provenance, review queue. |
| **Settings** | `/settings` | devices, connectors, schedules/listeners, treasury, billing, workspace, invites | Operations and plumbing, out of the way. |

Mobile nav drops to four: Inbox, Work, Agents, Settings. The "Launch a venture" button stays. This directly serves the standing preference for a cleaner, product-focused, brief-first IA — and it is what all three external inputs describe.

Out of the nav but not deleted: `/conversations`, `/messages`, `/activity`, `/costs`, `/treasury`, `/projects`, `/intel`, `/calendar`, `/docs`, `/shipwright`, `/setup`, `/onboarding` remain reachable via Work/Settings links, search (`CommandPalette`), and deep links. Measure: nav item count 12 → 5.

---

## 5. Workstreams

### WS1 — One inbox and a decision ledger (P0)

**Objective.** A single queue of human decisions, each bound to an exact artifact version, with a recorded verdict. Replace approve-only review; make the inbox a hard gate, not a suggestion box.

**Current files:** `app/api/inbox/route.ts`, `components/tasks/AgentInbox.tsx`, `components/assistant/ApprovalCard.tsx`, `lib/approval-card.ts`, `lib/approval-preview.ts`, `app/api/approvals*`, `app/api/runs/[id]/approve|reject/route.ts`, `lib/alerts.ts`, `app/api/notify*`.

**New files:** `lib/decisions.ts` (pure: decision request/verdict state machine, version binding, refusal rules), `lib/inbox-query.ts` (pure: aggregation/filter rules over alerts, approvals, runs, briefs, messages), migration `NNNN_decisions.sql`, `app/api/decisions/*`, `components/inbox/*`.

**Tasks**
1. Define the decision object: `{ id, kind: approval|review|question|blocker, artifactRef, artifactHash, requestedByRun, options[], expiresAt, status }`. Pure module, node-tested, import-free.
2. Unify interrupts into three kinds — notify / question / review — with a `stop`/kill path on every run. Mirror Linear's elicitation vocabulary, not Trigger.dev's unbound Approve.
3. Artifact-scoped cards: show diff/draft/options inline; verdict binds to `artifactHash`; any later change invalidates the decision (reuse the `approvalDetailsHash` idea in `lib/connector-rules.ts`).
4. Verdict set: approve / request-changes-with-reason / edit-and-accept / reassign / escalate. Reviewer != producer enforced at the run level (the completer cannot approve its own work).
5. Wire existing producers into the inbox: approvals, `awaiting_approval` runs, in-review tasks, alerts, connector approvals, brief approvals. Delete the Gmail-only inbox semantics but keep Gmail as one *source*.
6. Snooze/archive and "key updates only" filters; per-type switches. Bulk actions for clean-up.
7. Audit: every decision appended to the ledger with actor, timestamp, artifact hash, reason.

**Acceptance.** From `/inbox` alone: approve a brief, reject a run with a reason, answer a question, and watch the corresponding run/task/brief move. A stale approval is refused after the artifact changes. Test: `node --test test/decisions.test.mjs`, plus an API-level test for hash-invalidated decisions.

### WS2 — IA consolidation (P0)

**Objective.** Five-surface navigation; docs match the shipped product; no lost functionality.

**Files:** `components/Sidebar.tsx`, `components/ConditionalLayout.tsx`, all `app/*/page.tsx` headers, `README.md`, `CLAUDE.md`, `docs/harness-plan.md` (status update only).

**Tasks**
1. Implement the §4 nav; keep every route live. No 404s for old bookmarks (redirect unknown legacy paths into the new surfaces).
2. Move Command Deck content to `/work` as the "today" brief; board, briefs, runs and project health become sections/filters within Work.
3. Fold Treasury and Projects into Work (rails) and Settings (billing/connections) respectively; Intel and Calendar become Work feeds.
4. Refresh README/CLAUDE.md to the shipped architecture; remove create-shipyard-app/Vic claims that no longer hold.
5. Add a `docs/plans` status line to `docs/harness-plan.md` noting what superseded it (do not rewrite history).

**Acceptance.** Nav has 5 items; every previously top-level page is reachable in ≤2 clicks from Work/Settings; `npm run build` green; no route removed.

### WS3 — Knowledge factory: flag → curator → approved, portable knowledge (P0)

**Objective.** Turn extract-only memory into the loop LangChain describes, on a substrate the rest of the field is converging on.

**Current files:** `lib/memory-core.ts`, `lib/memory.ts`, `db/migrations/0009_memory.sql`, `app/api/memory/route.ts`, `app/memory/page.tsx`, `lib/injectable-skills.ts`, `lib/skills-skillmd.ts`, `lib/recommended-skills.ts`.

**Design (proposal, needs §9 decision on format).**
- Three knowledge types, explicitly modeled: **skills** (procedures), **domain knowledge** (facts/policies), **data access guidance** (which source, where, how to query — not a copy of the data).
- **Flag tool** exposed to every run: `flag_knowledge({ kind: missing|wrong|stale, ref, suggestedFix })`. Pure parser + schema in `lib/knowledge-flags.ts`.
- **Curator agent** on a cadence (start: nightly, one recurring schedule row), reading flags + run traces + raw sources, proposing edits. It never writes durable knowledge directly: proposals land in a review queue and require human approval (propose → approve), preserving the ledger invariant style already used for briefs.
- **Trust tiers and provenance** per item: unverified / machine-confirmed / human-reviewed, plus sources and `stale_after`. An agent edit demotes human-reviewed → machine-confirmed until re-review (OKF v0.3 semantics, which are well-specified and worth adopting verbatim).
- **Portable substrate**: versioned Markdown + YAML frontmatter in a git-tracked directory (OKF-shaped: `index.md`, append-only `log.md`, `type/title/description/resource/tags/sources/status/stale_after`). Database stays the query index; markdown is the source of truth and the export format. This matches Karpathy wiki / Obsidian / Letta MemFS / OKF convergence and keeps Beacon portable across agent environments.
- **Expose two ways**: MCP `memory_search`/`memory_write` (scoped) and as Agent Skills (procedural subset), so skills and knowledge are the same objects in two costumes.

**New files:** `lib/knowledge-flags.ts`, `lib/knowledge-schema.ts` (pure validation, OKF-aligned), `lib/knowledge-curator.ts` (pure planning: given flags+traces+sources → proposed edits, conflict detection), migration `NNNN_knowledge.sql` (flags, proposals, trust/provenance columns, knowledge type), `app/api/knowledge/*`, `components/knowledge/*`.

**Acceptance.** A run can flag a missing/wrong fact; the flag appears in `/knowledge`; the curator proposes a fix; approval updates the markdown artifact, bumps the log, and the next recall surfaces it with a provenance line. Tests: pure modules for schema validation, conflict detection, and demotion on edit; API tests for the approval gate (curator write without approval must fail).

### WS4 — Event listeners and monitors (P1)

**Objective.** Strict superset of cron: agents wake when a condition holds, with verified ingress, filtering, dedupe, replay, and correlation back to the triggering event.

**Current files:** `lib/schedules.ts`, `lib/watermarks.ts`, `app/api/schedules/tick/route.ts`, `lib/connector-webhook.ts`, `lib/queue.ts`, `app/api/worker/tick/route.ts`.

**New files:** `lib/listener-rules.ts` (pure: match/filter/decide-no-action, rate limits), `lib/listeners.ts` (DB wiring), migration `NNNN_listeners.sql`, `app/api/listeners/*`, `app/api/webhooks/[token]/route.ts` (verified ingress), UI inside Settings → Listeners.

**Tasks**
1. Model: `listener { source: webhook|http|kafka|cdc|schedule, filter rules, target agent/runbook, idempotency key, correlation id, enabled, cadence guard }`.
2. Cron remains a trigger type (fix `calculateNextRun` to actually honor cron expressions or drop the claim).
3. Ingress: signature verification, idempotency keys, replay window (reuse `CONNECTOR_REPLAY_WINDOW_SECONDS` pattern). No unverified webhooks.
4. Filter noise before a run: deterministic rules first, cheap-model classifier only as an opt-in second stage. Record why a listener did or did not fire.
5. Every run carries `correlation_id` back to the source event; the run trace shows the event payload that woke it.
6. Circuit breaker: auto-pause a listener after a failure burst (Multica uses ≥50 runs/7d at 90% failure).

**Acceptance.** Create a listener "when PR merges in repo X → Scout summarizes"; merge a PR (or replay a captured event); exactly one run starts, with correlation visible. Second delivery with the same idempotency key enqueues nothing. Tests: pure rule engine + idempotency, plus a webhook signature test.

### WS5 — Per-run identity and permissions (P1)

**Objective.** No instance-superuser agent identity. Credentials are short-lived, task-scoped, judged by the human at the top of the chain, deny-by-default.

**Current files:** `lib/agent-auth.ts`, `lib/token-scoping.ts`, `lib/device-rules.ts`, `lib/devices.ts`, `lib/connector-rules.ts`, `lib/tool-permissions.ts`, `docs/agent-callbacks.md`.

**Tasks**
1. Issue a per-run scoped credential (capability list + expiry + owner identity) instead of accepting the workspace-wide `DOCK_AGENT_TOKEN`. Keep rejecting token auth when >1 workspace (current behavior is correct).
2. Owner-chain attribution: every agent action records `acting_as` = top-of-chain human, propagated through delegation; access checks evaluate against that human, not the daemon user.
3. Deny-by-default policy ordering (deny → ask → allow) across tools, extending `lib/tool-permissions.ts`; managed/workspace rules override agent defaults.
4. Spend ceiling attached to the run credential; money-moving actions still park in `awaiting_approval` (unchanged rule).
5. Audit trail: who authorized what, when, under which run — queryable from the inbox/ledger.

**Acceptance.** A run cannot act beyond its issued scope; a revoked/expired run credential fails closed; delegation from a lower-privilege human cannot escalate. Tests: pure policy evaluation and expiry; integration test for fail-closed.

**Dependency note.** Requires agent-side cooperation (OpenClaw/CLI changes outside this repo). Phase-gate: if the agent harness cannot present a scoped credential yet, ship the server-side model + audit first and adapter work last.

### WS6 — Run economics and liveness (P1)

**Objective.** Make the fleet's real cost drivers visible and its failure handling correct.

**Current files:** `app/api/costs*`, `app/api/company/budgets*`, `app/api/projects/[name]/spend/route.ts`, `lib/task-runs.ts`, `lib/run-resume.ts`, `app/api/runs/failures/route.ts`, `app/api/worker/tick/route.ts`.

**Tasks**
1. Surface cache-read share, cache-write cost, and coordination/polling tokens per run and per agent (verify the Shipyard telemetry fields exist before promising the UI; see `references/shipyard-cost-telemetry.md`).
2. Classify failures: infra (drop/retry with backoff) vs agent (never auto-retry; surface to inbox with a fix loop). Record the class on the run.
3. Expire queued work by runtime liveness, not wall-clock age; idle watchdog replaces fixed caps (Multica: 36% of failures were offline machines).
4. Per-run budget enforcement with a hard stop, not just monthly warnings.
5. Failure summary → knowledge flag bridge: repeated agent errors become curator input for skills/guidance.

**Acceptance.** A run page shows token breakdown including cache share and coordination overhead; an infra glitch retries while a bad-build failure lands in the inbox once. Tests: pure failure classification and budget math.

---

## 6. Sequencing

Ordered by user-visible payoff and dependency, not by elegance.

| Phase | Workstreams | Exit criterion |
|---|---|---|
| **0. Decisions** | none (answer §9) | Scope cuts agreed; IA approved; knowledge format chosen |
| **1. Front door** | WS1 + WS2 | Inbox is the daily surface; nav is 5 items; docs refreshed |
| **2. Brain** | WS3 | Flag → curator → approved knowledge loop live end-to-end |
| **3. Nervous system** | WS4 + WS5 | Condition triggers live; per-run credentials enforced |
| **4. Hygiene** | WS6 | Economics visible; retry/liveness correct |
| **5. Gated** | Harness-agnostic CLI adapters; mobile/desktop; managed sandboxes | Only if demand proves it |

Do not start WS4 before WS1: listeners create runs, and without the inbox those runs have nowhere to land. Do not start WS3 before WS2: knowledge surfaces need a home in the IA.

---

## 7. Out of scope (explicit cuts)

- Building our own sandbox/compute layer. Capital-dominated and being bundled; integrate E2B/Daytona/Fly/Cloudflare later if required, never build.
- Building an agentic IDE or coding wrapper. Already consolidated by M&A; also violates the standing preference for focus.
- A shared POSIX filesystem/RBAC-FS product. Leave to JuiceFS/S3/CF Artifacts; Dock stores artifacts and identity, not petabytes.
- A single global "everything OS" positioning or cross-workspace agent super-tokens. Bet against it; keep `tokenScoping` fail-closed.
- Stripe or any payment-rail change. MoonPay Commerce + x402 stand; no confirm-rule changes.
- Native mobile/desktop apps in this plan. Responsive web only.
- Full workflow-canvas editing; keep the plan graph review, which already works.
- Chasing Height-style agent-native PM purism. Multica's public criticism (#6876, "Human Bureaucracy Wearing an AI Skin") is the warning: process inflation kills these products. Keep the brief as the anti-bloat mechanism.

---

## 8. Risks and mitigations

- **Consolidation hides power features.** Mitigate with saved views, ⌘K palette, and search over canonical records; measure time-to-find before/after.
- **Curator trust.** Curator never writes directly; propose-then-approve, append-only `log.md`, deterministic supersession, poison/secret filters retained from `looksSecret`.
- **Per-run credentials need agent-side work.** Server model ships first; adapters gated (WS5 dependency note).
- **Listener abuse/cost.** Idempotency, replay windows, filter-before-run, circuit breakers, per-listener spend caps.
- **Migration collisions.** Sibling agents write untracked migrations; always pick numbers from the union of `origin/main` and the working tree, and treat existing duplicate `0008`/`0009` as a hygiene cleanup.
- **Metric honesty.** Do not ship a cache-hit dashboard until the gateway telemetry actually reports cache reads; otherwise the number is fabricated.
- **Brief/ledger invariants.** WS1/WS3 must not weaken "only an approved brief creates a run" or the append-only ledger.

---

## 9. Decisions needed from Halsey

1. **IA:** approve the five-surface collapse (Inbox / Work / Agents / Knowledge / Settings), or name the surfaces you want?
2. **Knowledge format:** adopt OKF-shaped markdown + frontmatter as the source of truth (database as index), or keep the database authoritative and export markdown read-only?
3. **Curator autonomy:** propose-then-approve always (slower, safer) or allow auto-apply for machine-confirmed low-risk edits with a review backlog?
4. **First listener source:** webhook (fastest, matches Dinghy/GitHub) or CDC/Kafka (heavier, needs infrastructure)? Recommendation: webhook + HTTP, CDC later.
5. **Per-run credentials:** commit to the server-side model now and phase the agent-side adapters, or wait until OpenClaw/CLIs can present scoped credentials?
6. **Positioning:** keep the name "Beacon" for the knowledge layer, or fold it under Dock?
7. **Sequencing:** agree Phase 1 = inbox + IA, or would you rather see the knowledge loop first?

---

## 10. Verification and test plan (global)

- `node --test test/*.test.mjs` from repo root (Node 25 on PATH). Every new pure module (`lib/decisions.ts`, `lib/knowledge-schema.ts`, `lib/knowledge-curator.ts`, `lib/listener-rules.ts`, policy evaluators) must be import-free and node-testable — mirror `lib/tool-permissions.ts` / `lib/task-runs.ts`.
- `npm run build` before every push (standing rule, Node 25 first on PATH, timeout 600).
- Migrations: dry-run in a rolled-back transaction, then apply only on explicit user go; verify idempotence.
- Deploy verification by commit SHA with `scripts/verify_deploy.py <project> <team> <sha> 150`, then curl the served surface for the new strings (not "a deployment exists").
- Each workstream carries its own acceptance list above; treat those as the definition of done.

---

## 11. Sources

- John Suh, "Agent platform 2027" — https://x.com/john_ssuh/status/2124336124172935336 (blueprint screenshots: actors, N agents × M computers, RBAC filesystem, session≠conversation, inbox, listeners/monitors, app containers).
- Jiayuan Zhang / Multica — https://x.com/jiayuan_jy/status/2124790534313312648 and https://x.com/jiayuan_jy/status/2124554017766621343; https://multica.ai/ and https://github.com/multica-ai/multica (57,598 stars, 2,026 open issues at 2026-11-24; source-available "Multica License", Apache-2.0 + conditions, SPDX NOASSERTION).
- Multica criticism: issue #6876 "An Indictment of Multica: Human Bureaucracy Wearing an AI Skin" (closed); #8753/#8754 coordination churn; #6008 prompt-cache destruction; #9502 handoff deadlock.
- Harrison Chase, "How to build a knowledge factory" — https://www.langchain.com/blog/knowledge-factory (three knowledge types, flag tool, curator agent, storage non-prescriptive).
- OKF spec — https://raw.githubusercontent.com/open-knowledge-format/open-knowledge-format/main/SPEC.md (v0.1→v0.3; trust tiers, provenance, stale_after, superseded_by).
- Agent Skills spec — https://agentskills.io/specification (AAIF/Linux Foundation governance; adopted by Codex, Gemini CLI, Cursor, Copilot).
- Landscape: Cloudflare Agents/Durable Objects/Artifacts; Vercel Eve (GA 2026-11-17); Rivet; Restate; Temporal Agent Harness; E2B; Modal; Daytona; Fly.io Machines; OpenAI Agents SDK/Responses; Anthropic Claude Agent SDK/Claude Code; LangChain ($3B, Nov 2026); Linear Agent; Plane Agents; Multica; Novu Agent Inbox; handup; Impri; Height (shut down 2025-09-24); tldraw; Cua.
- Human-in-the-loop UX: Linear Reviews and agent elicitation signals; Trigger.dev Linear connector; Plane workflows/approvals; Pi Docket; Microsoft Today (Ignite 2026); Taskade agent inbox; Impri approval inbox.
- Identity primitives: MCP authorization spec (2025-11-25); Cloudflare Access Managed OAuth; WorkOS Agent Auth blueprints; Vercel Agent permission scopes and Vercel Connect.
