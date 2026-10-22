# Harness plan: Dock + Dinghy

Status: draft for review. Written 2026-10-21 from the decisions made in conversation.
Scope: how the products fit together, what exists today, and the build order.

## 1. Products

**Dinghy** (cloud, standalone, iMessage). Works for anyone with an iPhone, with or without Dock. It runs on hosted infrastructure, so it is always up. Its voice and behaviour do not change for this plan.

**Dock** (optional, for business users). The harness that runs a business or project: a named Chief of Staff, specialist subagents, computer-use tasks, scheduled work. It runs on the user's home node (Mac mini, always on) and optionally on a laptop when it is awake. A hosted Dock web app is a control panel and admin surface, not the place work runs.

Dinghy never depends on a Mac being on. Dock never needs Dinghy.

## 2. Pairing and handoff

- A Dinghy account can pair with one Dock instance. Pairing is opt-in and can be undone.
- At pairing, Dinghy stores the **Chief of Staff's name** (chosen by the user at Dock onboarding).
- In iMessage, the user addresses the Chief of Staff with an **@ mention** (for example "@Vic check my sales today"). Only that name is routed to Dock. Messages without an @ mention go to Dinghy as today.
- **Subagents are not addressable from Dinghy.** They are reached through the Chief of Staff ("@Vic have Research pull the competitor pricing"). Dinghy's routing table holds one name per user.
- A rename in Dock triggers a confirmation text from Dinghy before the new name takes effect, so an accidental rename cannot silently break @ mentions.
- If the home node is offline, Dinghy tells the user in its normal voice and queues the message. It is delivered when the node reconnects.
- Replies from the Chief of Staff come back through Dinghy and show the agent's name.
- Routing only resolves names on the same account. A name never resolves across users.

## 2a. Onboarding

Eleven screens: ten questions (the last of which names the Chief of Staff) and a review. Each question has Back, an "x of 11" counter, and "Skip: agent decides" (except the goal and the Chief name, which are required). A skip stores null with `skipped = true`; no value is invented. Answers save as the user moves forward. Stored in `workspace_profile` (one row per workspace) and `workspace_rules` (one row per rule), both owner-only under RLS (`db/migrations/0002_workspace_profile.sql`).

**Wave background.** The sign-in page and onboarding use a looping wave video (`public/onboarding-wave.mp4`, 1280x720, muted, about 2.2 MB) with a poster (`public/onboarding-wave-poster.jpg`) and a dark scrim behind the form. Reduced motion shows the poster only. The video pauses when the tab is hidden. The form cards stay solid `--surface-1`. The video is not shown on /assistant or other app pages.

**x402 network defaults (owner decision).** Solana first, then Base, both USDC.

1. **Goal** (required): one sentence. Stored as `goal`, mirrored to `workspaces.building`.
2. **Source**: start blank (recommended) or import a GitHub repo as a copy. Stored as `source_choice`. The import is not built; a TODO hook marks where it goes.
3. **Story**: own frustration, agent infrastructure, friends kept asking, or something else.
4. **Stage**: just me, a few users, nobody yet, or something else.
5. **Direction**: carry on as is (recommended), narrow it down, rethink it, or something else.
6. **First paying customer**: busy professional, small business owner, solo founder, or something else.
7. **Pricing and payments**: charging model (subscription, usage-based, free then paid, or something else) and how customers pay (USDC, recommended; card; both). USDC touches money-transmission and consumer-protection rules and needs legal review before launch. Agents never move money without the existing confirm and spend-cap rules.
8. **Acquisition**: founder social posts, friends and referrals, paid ads, communities, or something else.
9. **Keep (rules)**: four defaults, checked: no spending without approval, no public posts without approval, no sharing customer or private data outside the workspace, no pricing changes without asking. Plus up to ten of the user's own. Stored in `workspace_rules`.
10. **Chief of Staff name**: suggested "Vic", unique per workspace, saved only on Confirm.
11. **Review**: shows what is saved, with an Edit link per step, then Confirm.

The Chief of Staff's system prompt includes the saved profile and enabled rules as short bullets, with the instruction that rules override user requests. A user with no profile gets no added text. Only the user's Chief of Staff receives this; other agents do not.

## 3. Home node and devices

- **Mac mini:** home node. Runs the Chief of Staff, subagents, scheduler, and computer-use tasks. Needs sleep disabled and auto-login set up for GUI work.
- **MacBook Air:** optional worker when open. It can run tasks that need apps only it has logged in. When it sleeps, work moves back to the mini.
- **iPhone:** front door through Dinghy only.
- **Task ownership** uses a lease with a heartbeat, so only one machine works a task at a time. A lease that expires is taken over by the next available node.
- **Shared state** lives in Supabase (tasks, conversations, the queue, pairing). Provider logins and API keys stay in each machine's own keychain and do not sync.

## 4. Models and inference

- **Shipyard Inference is the default** for every user. It is the standard, always-available layer.
- **Bring your own API keys** (Anthropic, OpenAI, Google, others) can be added per user, per machine. Keys never go to Dinghy's cloud.
- **Subscriptions (Claude Pro/Max, ChatGPT/Codex) run only on the user's own machine,** through the official client they sign into. Dock never routes subscription logins or tokens through a hosted service.
- **The Chief of Staff chooses the model per delegated task**, using the quality tier and the per-call cost telemetry that Shipyard already returns. The choice is recorded on the run.

## 5. Terms of service constraints

Checked against the public pages in October 2026:

- **Anthropic:** third-party tools must use API keys. A product cannot offer Claude sign-in, route requests through a user's Free/Pro/Max credentials, or store their session tokens. A user may sign in to the unmodified Claude Code binary with their own subscription on their own machine.
- **OpenAI:** Codex sign-in with a ChatGPT plan is described for the Codex clients. I did not find a rule that lets a third-party product use a user's plan usage. Treat as not allowed until confirmed. "Sign in with ChatGPT" for developers exists under Service Terms §15; it is unclear whether it covers Codex plan usage.
- **Google Gemini:** the API terms are written for professional use with API keys. No rule found that lets a consumer Gemini subscription power a third-party product. Treat as not allowed until confirmed.
- **Gmail-derived content** follows Google's Limited Use rules. It is not sent to non-private model endpoints or stored outside the rules.

## 6. Computer use

- The **CUA driver** (installed on the owner's Mac at `~/.local/bin/cua-driver`) is the desktop driver. It is not yet integrated into Dock. Integration means: a task type that calls the driver on the home node, with an approval gate on anything that spends money, posts publicly, or changes an account.
- Cloud sandboxes (for example E2B, as used in Dinghy) are for users without a home node. This is a later step.

## 7. Memory

- **Shipyard Memory** (`@shipyard/memory`, in `~/projects/shipyard-memory`) was extracted from Dinghy in its first phase. It is not yet used by Dock.
- Three scopes per user: conversation history, durable facts, project knowledge.
- Embeddings are tagged with their model, so vectors from different models are never compared.
- Dock's current `/memory` page reads local markdown files. It will not work on Vercel and is to be replaced by Shipyard Memory.

## 8. What exists today (checked in the repos)

Built and live:
- Dock harness on Vercel (`dock-harness.vercel.app`): email-code sign-in, owner-only gate.
- Assistant chat with Vic as the default agent, model picker (Shipyard default), per-run trace with tokens and cost from Shipyard telemetry.
- Missions board with an Agent Inbox view.
- Agent callbacks require a shared secret (`DOCK_AGENT_TOKEN`).
- Floating Vic panel removed and merged into `/assistant`.

Not built:
- Multi-user data model (everything is still single-owner, with file and env state).
- Onboarding and naming of the Chief of Staff.
- Subagent roster and `delegate()`.
- Dinghy pairing, @ mention routing, rename confirmation.
- Home-node runtime (a daemon that runs on the Mac mini).
- CUA driver integration.
- Shipyard Memory integration.
- SMTP for sign-in (Resend key found; `getdinghy.sh` not yet verified in Resend).

## 9. Build order

**P0: unblock (days)**
1. Verify `getdinghy.sh` in Resend, then point Supabase sign-in email at Resend.
2. Roll out `DOCK_AGENT_TOKEN` to the agent machines (the agent config outside this repo).
3. Replace the `/memory` page's local-file reads with Shipyard Memory, or hide the page until then.

**P1: tenancy and onboarding**
4. Per-user data model in Supabase with row-level security. Move tasks, agents, conversations, and memory off files.
5. Sign-in for many users; invite-only for the closed beta.
6. Onboarding: goals, the project to launch, and naming the Chief of Staff.

**P2: home node and delegation**
7. Home-node daemon on the Mac mini: runs the Chief of Staff, scheduler, task leases, Supabase sync.
8. Subagent roster (Research, GTM, Engineering, Design/brand, Ops/finance) and `delegate(role, task, model)`.
9. Model routing per delegated task, recorded on the run.

**P3: Dinghy pairing**
10. Pairing flow from Dock to Dinghy, one-time code and opt-in.
11. @ mention routing for the Chief of Staff, rename confirmation, offline queue.

**P4: memory and computer use**
12. Shipyard Memory per user across Dock and Dinghy (shared identity).
13. CUA driver as a task type on the home node, with approval gates.

**P5: controls**
14. Per-user and per-agent budgets built on the existing cost telemetry.
15. Approval flows for spend, public posts, and account changes.
16. Evaluation and run review across all agents.

## 10. Open decisions

1. Dinghy-only users: same named character as the Chief of Staff, or a separate lighter assistant? Dinghy's voice stays unchanged either way.
2. Closed beta: Dinghy alone first, or Dinghy and Dock together?
3. Should agent names be unique across a user's agents? (Proposed: yes, enforced at onboarding.)
4. Cloud fallback for Dock tasks when the home node is off? (Proposed: no. Dinghy stays up; Dock work waits.)
5. Mobile beyond iPhone: iMessage is iPhone only. Android needs a separate channel. Not in the beta.
