# Project Central Thread: Spec

Status: draft v1, decisions locked by product owner (2026-10-22)
Scope: how a project conversation in the Dock assistant shell turns into approved, tracked agent work.

## 1. Decisions (locked)

1. **Every spawn requires approval.** No threshold in v1. Every real-work spawn produces a brief card the user must approve.
2. **Agent roster is global.** Agents are defined once. Each project enables a subset.
3. **Chief of staff (CoS) owns the central thread and the ledger.** Subagents contribute input (answers, drafts, status) but do not write ledger entries.
4. **A project without a CoS gets one automatically** at creation.

## 2. Core model

- **Project** has exactly one **central thread**. Opened from the assistant shell with the project in context.
- **Messages** in the thread come from: the user, the CoS, or a subagent (labelled by agent identity).
- **Work** is a **run**: one approved brief, one agent (or a CoS-coordinated set), one outcome.
- **Ledger** is an append-only list of entries derived from runs and decisions. It is a view of the central thread, not a second store.

## 3. Message types

| Type | Who creates it | Effect |
|---|---|---|
| `chat` | user or CoS | Conversation only. No spend, no side effects. |
| `question` | user, addressed to an agent via `@agent` | Agent answers in-thread. No spend beyond the answer's own tokens. |
| `brief` | CoS (or user via "Make this work") | Renders a brief card. Not executed until approved. |
| `decision` | user (approve / edit / cancel on a brief) | Updates the brief state. On approve, creates a run. |
| `status` | CoS, on run state change | Updates in place on the run's status card. |
| `result` | subagent or CoS, on run completion | Attaches artifacts and summary to the run. |
| `ledger` | CoS only | Writes an entry (see §6). |

Rule: only `brief` + `decision(approve)` can create a run. Nothing else spawns work.

## 4. Routing

**CoS routing.** Every user message in the central thread is classified by the CoS as one of: `chat`, `question`, `work request`, `status request`, or `decision`. Classification must be visible: the message shows a small label ("Treated as work request") that the user can click to change.

**Direct @-mention.**
- `@agent <text>` routes to that agent, bypassing CoS classification.
- If the agent is a question, it answers in-thread.
- If the agent wants to do work, it must emit a `brief` message. It cannot start a run itself. The CoS reviews the brief for conflicts with other runs, then the card is shown to the user.
- The @-message still enters the central thread, and the CoS sees it.
- @-mention of an agent not enabled for the project returns an inline error with the option to route to CoS instead.

**Escape hatch.** Any message can be promoted with "Make this work," which asks the CoS to draft a brief from it.

**No agent-to-agent messages.** Subagents post to the thread. They do not address each other. If the designer needs copy from the copywriter, the CoS creates a brief for the copywriter whose result feeds the designer's brief.

**Loop guard.** At most 3 consecutive agent messages without a user message. After that the CoS must post a `chat` asking the user for direction. (Mirrors Lovable's 3-message cap.)

## 5. Brief card

A brief is the contract for a run. Fields:

- `id`, `project_id`, `created_by` (cos | user), `agent` (roster id)
- `goal` (one sentence)
- `context` (what the agent should read: files, prior runs, decisions, links)
- `deliverables` (list, each with a type: file, asset, message, record)
- `constraints` (budget cap, deadline, forbidden actions)
- `estimated_cost` (credits or $, with range) and `estimated_duration`
- `risk_flags` (spends money, contacts external people, writes to production, deletes data). Any flag shows prominently.
- `state`: `proposed` | `edited` | `approved` | `cancelled` | `running` | `done` | `failed`

Actions: **Approve**, **Edit** (changes create a new revision, prior revision kept), **Cancel**.

Approve creates a run and immediately moves the card to `running`. Edits after approval require a new brief.

## 6. Ledger entry

Written by the CoS only. Append-only. Reverting is a new entry, never a deletion.

- `id`, `project_id`, `timestamp`
- `kind`: `run_started` | `run_completed` | `run_failed` | `decision` | `reverted` | `budget_change`
- `brief_id`, `run_id` (when applicable)
- `agent`, `summary` (one line), `artifacts` (links)
- `cost_actual` and `cost_estimated`
- `approved_by` (user id)
- `parent_entry_id` (for reverts and follow-ups)

The ledger tab of a project filters the same data: `run_*` and `decision` entries by default, with a toggle to show everything in the thread.

## 7. Status card

One card per run, updated in place by `status` messages. Shows: state, current step (one line), elapsed time, spend so far against the cap, and links to the brief and ledger entry. The card is clickable to expand a live log.

Any run with no status update for a threshold (suggest 5 min) shows "no update since X" rather than silently sitting in `running`. This is the direct fix for the visibility complaint users had with NanoCorp.

## 8. Budgets

- Each brief carries a hard `budget cap`. The run stops at the cap and posts a `status` asking for direction.
- Projects have a total monthly cap set by the user. Approving a brief that would exceed the project cap is blocked with a clear message.
- The CoS's own token cost for routing and briefing is posted as a line item in the ledger, so it is not hidden.

## 9. Roster

Global agent definitions: `id`, `name`, `role`, `capabilities`, `default_budget`, `allowed_actions`, `requires_approval_for` (defaults to all spawns, per decision 1).

Per project: an enabled subset, with optional per-project overrides of budget and allowed actions.

## 10. Failure handling

- **Misroute.** User changes the classification label; CoS logs the correction for later tuning. No run is created by a misrouted chat message.
- **Run failure.** Run goes to `failed`, status card shows the reason, CoS posts a `chat` with options (retry, edit brief, cancel). No automatic retry that spends money without a new approval.
- **Agent unavailable or not enabled.** Inline error on the @-message with a route-to-CoS action.

## 11. Open items (not blocking v1)

- Whether side threads come later, as Lovable-style private chats that promote to the central thread. Out of scope for v1.
- Team visibility and permissions on central threads. v1 assumes single-user projects.
- Whether approved briefs can be batched ("approve these three"). Nice to have.

## 12. Build order (suggested)

1. Message types + thread rendering with agent labels.
2. Brief card + approve/edit/cancel, persisted, no real agent yet (stub run).
3. CoS classification + "Make this work" + label/override.
4. `@agent` routing and roster enablement check.
5. Ledger entries and ledger tab view.
6. Status card with stale-run detection.
7. Budgets (run cap, project cap).

Each step should be testable against the stub run before real subagents are wired in.
