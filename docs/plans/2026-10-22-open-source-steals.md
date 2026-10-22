# Open-Source Steals Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Absorb the best patterns from OpenHuman, OpenCode, and Hermes into Dock: resumable approval-gated runs, plan/build permission split, headless agent server, read-only subagents, LSP diagnostics, SKILL.md compatibility, cron-backed intel feed, and per-agent profiles.

**Architecture:** Everything hangs off the existing run system (`lib/queue.ts`, `lib/task-runs.ts`, migration 0005) and memory system (`lib/memory.ts`, migration 0009). No new frameworks. Pure-logic modules stay I/O-free in `lib/` (node-testable, per the P2 pattern), Supabase wiring stays in data layers, UI reads via existing API routes.

**Tech Stack:** Next.js 16 / React 19, AI SDK v6, Supabase, node:test for pure modules.

**License note:** OpenHuman is GPL-3.0 — ideas only, zero code. OpenCode (Apache-2.0) and Hermes (MIT) are clean to lift code from.

---

## Phases

| Phase | Steal | Source | Dependency |
|---|---|---|---|
| 1 | Resumable approval-gated runs (§2) | OpenHuman (pattern only) | none |
| 2 | Plan/Build permission split on kanban state (§5) + Explore/Scout read-only subagents (§6) | OpenCode | none |
| 3 | Headless agent server (§4) | OpenCode | Phase 1 (runs API) |
| 4 | Skills as SKILL.md packages (§8) | Hermes (MIT) | none |
| 5 | LSP/diagnostics tool (§7) | OpenCode | Phase 2 (tool plumbing) |
| 6 | Cron-backed intel feed with watermarks (§9) | Hermes watchers | none |
| 7 | Per-agent profiles (§10) + workflow canvas-lite / proposed plan graph (§3) | Hermes + OpenHuman | Phases 2, 4 |

---

## Phase 1 — Resumable Approval-Gated Runs

**Objective:** A run interrupted mid-execution (crash, lease expiry, restart) resumes from its last event instead of dying or restarting from scratch.

### Task 1.1: Checkpoint event kind + resume decision (pure logic)

**Files:**
- Modify: `lib/task-runs.ts`
- Test: `test/task-runs.test.ts` (extend existing)

**Step 1:** Write failing tests:
```ts
// resumes when last event was a checkpoint and run is not terminal
resumePlan("running", [{ kind: "checkpoint", data: { step: 3, snapshot: {...} } }], [])
  // -> { ok: true, fromStep: 3, snapshot: {...} }
// never resumes a terminal run
resumePlan("succeeded", [{ kind: "checkpoint", data: { step: 3 } }], [])
  // -> { ok: false, reason: "terminal" }
// no checkpoint -> fresh start
resumePlan("queued", [], []) // -> { ok: true, fromStep: 0, snapshot: null }
```

**Step 2:** Run `node --test test/task-runs.test.ts` — expect FAIL.

**Step 3:** Implement in `lib/task-runs.ts`:
```ts
export const EVENT = { /* existing */ ..., checkpoint: "checkpoint" }

export type ResumePlan =
  | { ok: true; fromStep: number; snapshot: Record<string, unknown> | null }
  | { ok: false; reason: "terminal" }

export function resumePlan(status: string, events: RunEventLike[], _all: RunEventLike[]): ResumePlan {
  if (TERMINAL_STATUSES.includes(status as RunStatus)) return { ok: false, reason: "terminal" }
  const cp = [...events].reverse().find((e) => e.kind === EVENT.checkpoint)
  if (!cp) return { ok: true, fromStep: 0, snapshot: null }
  return { ok: true, fromStep: Number(cp.data?.step ?? 0), snapshot: (cp.data?.snapshot as Record<string, unknown>) ?? null }
}
```

**Step 4:** Tests pass. **Step 5:** Commit `feat: resume plan decision for task runs`.

### Task 1.2: Worker writes checkpoints and resumes

**Files:**
- Modify: `lib/queue.ts` (worker claim path)
- Modify: the worker execution loop that calls the model (find via `search_files(pattern: "model_call", path: "~/dock/lib")`)

**Step 1:** After each completed step/turn, write a `checkpoint` event: `insertRunEvent(runId, { kind: "checkpoint", data: { step, snapshot: { lastToolResultsRef, messagesCursor } } })`.
**Step 2:** On lease claim, call `resumePlan(status, events, [])`. If `fromStep > 0`, rebuild the model message list from the snapshot instead of the payload's initial prompt. Cap snapshot at 8KB (truncate oldest message content first).
**Step 3:** Manual verify: start a run against a fake model that throws after 2 turns; restart the worker; confirm event history shows `checkpoint → lease_expired → leased → checkpoint(3) → completed` and output reflects the earlier turns.
**Step 4:** Commit `feat: resumable runs via checkpoint events`.

### Task 1.3: Approval resumption after restart

**Step 1:** Verify existing behavior: an `awaiting_approval` run whose approval is granted moves to `queued` (`statusAfterDecision` already does this — it's correct). The gap is the *work done before* the gate. Add to the approve endpoint: the re-queued run's payload gains `resumeSnapshot` from the last checkpoint.
**Step 2:** Test: park a run with a money action, restart worker, approve via API, confirm the resumed turn receives prior snapshot. **Step 3:** Commit `feat: approvals resume prior work`.

---

## Phase 2 — Plan/Build Permission Split + Read-Only Subagents

**Objective:** Kanban state is the permission boundary. "Planned" tasks run a read-only agent; crossing to "In Progress" flips edit/bash permissions on. Explore/Scout run read-only always.

### Task 2.1: Permission modes (pure logic)

**Files:**
- Create: `lib/tool-permissions.ts`
- Test: `test/tool-permissions.test.ts`

```ts
export type RunMode = "plan" | "build" | "explore"
export interface ToolPermission { tool: string; allowed: boolean; ask: boolean }
export function permissionsFor(mode: RunMode): ToolPermission[] {
  // plan:  read/grep/glob/webfetch allowed; edit/write/bash DENIED, bash ask=true
  // build: all allowed
  // explore: read/grep/glob allowed; everything else denied
}
export function modeForColumn(column: string): RunMode {
  // "Backlog" | "Planned" -> plan ; "In Progress" | "Review" -> build
}
```
TDD: failing test → implement → pass → commit `feat: tool permission modes`.

### Task 2.2: Enforce in the worker

**Step 1:** In the worker's tool-dispatch (the loop that executes tool calls for a run), look up `permissionsFor(mode)`; denied tools return `{ error: "denied: plan mode" }` to the model instead of executing.
**Step 2:** When a task's kanban column changes (drag event handler in `components/tasks/` + `lib/tasks.ts`), set `payload.mode` on any queued run; a *running* run finishing in "Planned" writes its findings to the task as an enrichment (reuse `lib/task-enrichment.ts`).
**Step 3:** Verify: drag task to In Progress → run executes `write` successfully; same task in Planned → `write` returns denied and the model produces a plan instead. **Step 4:** Commit `feat: kanban state gates tool permissions`.

### Task 2.3: Explore/Scout agent profiles

**Step 1:** Add `explore: true` to agent config in `lib/agent-templates.ts`; forces `permissionsFor("explore")` regardless of column.
**Step 2:** Test with a Scout research run: confirm no write/bash calls in event history. **Step 3:** Commit `feat: read-only explore agents`.

---

## Phase 3 — Headless Agent Server

**Objective:** Runs are driven by a server API any client can hit — dashboard, CLI (`dock`), mobile — instead of only the Next.js app.

### Task 3.1: Runs API hardening

**Step 1:** Audit `app/api/**` run endpoints (list runs, enqueue, events stream). Add what's missing: `POST /api/runs` (enqueue with agent, payload, mode), `GET /api/runs/:id/events` (poll or SSE of the existing `notificationEmitter`), `POST /api/runs/:id/decide`.
**Step 2:** Auth: machine tokens via `lib/agent-auth.ts` (exists — reuse), scoped per workspace.
**Step 3:** Verify with curl from a second terminal. Commit `feat: headless runs API`.

### Task 3.2: `dock` CLI subcommands

**Step 1:** Extend `bin/shipyard.js`: `dock runs list`, `dock run --agent scout --prompt "..."`, `dock runs watch <id>` (tails the events endpoint).
**Step 2:** Verify: enqueue a run from the CLI with the dashboard closed; confirm it executes and `dock runs watch` streams events. **Step 3:** Commit `feat: drive agents from the CLI`.

---

## Phase 4 — Skills as SKILL.md Packages

**Objective:** Dock agents load skills from SKILL.md files (Hermes format, MIT — can share the format and even files).

### Task 4.1: SKILL.md parser + loader (pure logic)

**Files:**
- Create: `lib/skills-skillmd.ts`
- Test: `test/skills-skillmd.test.ts`

Parse YAML frontmatter (name, description, tags) + markdown body; `loadSkills(dir)` reads a directory of skill folders. The DB skill rows already exist (`app/skills`, `lib/recommended-skills.ts`) — add a `source: "bundled" | "skillmd"` field.
**TDD → commit** `feat: SKILL.md loader`.

### Task 4.2: Inject into agent prompts + file-backed skills

**Step 1:** Worker prompt assembly: matched skills' frontmatter descriptions always; full body of top-2 matches by keyword overlap with the task payload.
**Step 2:** `app/skills` page: "Import from folder" button that reads `skills/` via a server route and upserts rows.
**Step 3:** Verify: drop a SKILL.md into the folder, import, run a task mentioning the skill's trigger, confirm the body appeared in `model_call` event data. Commit `feat: file-backed skills`.

---

## Phase 5 — LSP/Diagnostics Tool

**Objective:** Agents get compiler/linter errors without re-running builds.

### Task 5.1: Diagnostics tool (worker-side)

**Files:**
- Create: `lib/tool-diagnostics.ts` (worker host side — spawns `tsc --noEmit --pretty false` / `eslint -f json` in the project dir, caches results per run, timeout 60s)
- Test: `test/tool-diagnostics.test.ts` (pure part: parse tsc/eslint output into `{file, line, message}[]`)
- Register as a tool named `diagnostics` in the worker's tool map (Phase 2 permission: allowed in build, denied in plan/explore).

**TDD on the parser → wire → verify on a deliberately broken file → commit** `feat: diagnostics tool`.

---

## Phase 6 — Cron-Backed Intel Feed with Watermarks

**Objective:** Scout research runs continuously on a schedule; the Intel Feed shows accumulated results, not manually-triggered one-offs.

### Task 6.1: Watermark store (pure logic + Supabase)

**Files:**
- Create: `lib/watermarks.ts` — `getWatermark(ownerId, feedId)`, `setWatermark(...)` storing `{ seenAt, lastItemId }` in a new `watermarks` table (migration `0011_watermarks.sql`: id, owner_id, feed_id, value jsonb, updated_at).
- Test: `test/watermarks.test.ts` (dedupe logic: `shouldProcess(item, watermark)` — false when itemId == last or createdAt <= seenAt).

### Task 6.2: Wire schedules to the run queue + feed

**Step 1:** Replace `data/schedules.json` backing of `lib/schedules.ts` with the `watermarks`/schedule rows in Supabase (keep the JSON as fallback import). `calculateNextRun`/`isDue` are already pure and tested — reuse.
**Step 2:** `/api/schedules/tick`: due schedule → enqueue a Scout run with payload `{ kind: "intel", since: watermark }`; on success write the new watermark. Feed items that dedupe against the watermark are skipped.
**Step 3:** Intel Feed page (`app/intel`) reads run outputs — no UI change beyond a "scheduled" badge.
**Step 4:** Verify: create a daily schedule, call tick twice, confirm second tick enqueues nothing. Commit `feat: watermark-deduped scheduled intel runs`.

---

## Phase 7 — Per-Agent Profiles + Proposed-Plan Graph

### Task 7.1: Agent profile shape

**Objective:** Each agent = isolated profile with its own skills, memory scope, schedule, and budget — one shape used by dashboard, CLI, and worker.

**Files:**
- Modify: `lib/agent-templates.ts` — `AgentProfile { key, name, role, skills: string[], memoryScope, schedule?: AgentSchedule, budgetCents, mode: RunMode, explore?: boolean }`
- Migration `0012_agent_profiles.sql` or a jsonb column if agents already have a table (check `db/migrations` first).
- Refactor queue worker + dashboard agent cards to read the one shape.

**Commit** `refactor: unify agent profiles`.

### Task 7.2: Proposed-plan graph (canvas-lite)

**Objective:** In "Planned", the read-only agent's output is structured as a step graph the owner reviews; approving promotes the task to "In Progress" and each graph node becomes a queued run with dependencies.

**Files:**
- Create: `lib/plan-graph.ts` (pure): parse agent plan output (enforce a JSON plan block in the plan-mode system prompt) into `{ id, title, dependsOn[], agentKey, estimateCents }[]`; `topoOrder()` validation; reject cycles.
- Test: `test/plan-graph.test.ts`
- UI: `components/tasks/` — plan review card rendering nodes + approve button; approve → enqueue runs in topo order.

**TDD on plan-graph → UI → verify end-to-end (plan task → review → approve → ordered execution) → commit** `feat: plan review graph`.

---

## Verification checklist (whole plan)

- [ ] `node --test test/` green
- [ ] `npm run build` green
- [ ] Kill a run mid-flight; restart; it resumes from checkpoint (Phase 1)
- [ ] Planned task cannot write files; In Progress task can (Phase 2)
- [ ] `dock run` from CLI with dashboard closed executes and streams (Phase 3)
- [ ] Dropped SKILL.md loads into an agent prompt (Phase 4)
- [ ] Broken file's errors reach the agent via `diagnostics` without a full build (Phase 5)
- [ ] Second schedule tick dedupes via watermark (Phase 6)
- [ ] Plan → review → approve → topo-ordered execution (Phase 7)

## Out of scope (YAGNI)

- Full drag-and-drop workflow canvas editor (OpenHuman's full version)
- Local/Ollama inference mode
- 100+ OAuth connector layer (Dock already has its connector system)
- Embedding-based memory ranking changes (existing `@shipyard/memory` setup stays)
