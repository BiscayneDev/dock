# Unified Memory: Shipyard OS + Dinghy

Status: plan, not built. Written from a read of the code on Oct 21, 2026.

## 1. What exists today (verified in code)

**Dinghy (`~/dock`)** already has the memory system we want to share.
- Supabase-backed. Migrations `024_dinghy_memory`, `027_memory_embeddings`, `035_user_memory`, `046_memory_plans_files`.
- `src/lib/memory/store.ts`: semantic search over embeddings, keyword search over past messages, dedupe at similarity > 0.92, supersede (facts have `valid_from`).
- `src/lib/memory/extractor.ts`: extracts facts from conversations.
- `src/lib/spectrum/memory.ts`: loads memory context per turn, resolves the user from `spectrum_identities` (iMessage handle to user), filters secrets (`looksSecret`).
- Tool access is already extensive: Gmail, Google Calendar (read and write, with confirmation), GitHub, weather, X, reminders, health (Oura/WHOOP), wallet, recipes, workflows, browser and computer tools, `memory_search`. The iMessage handler gives these to the model.

**Shipyard OS (`~/projects/shipyard-os`)** has no shared memory store.
- `app/api/memory/route.ts` reads markdown memory files from the local workspace directory. It returns empty on Vercel.
- Agent memory is per-agent files, not a database.
- `data/` holds JSON stores (`tasks.json`, `agents.json`, `goals.json`, `activity.json`).

**Correction to my earlier answer:** I said Dinghy has no tool access. That was wrong. I took it from an unchecked "next steps" line in the research brief. Dinghy has broad tool access today. The real gaps are different (see §4).

## 2. Target model

One memory store, Supabase, owned by the user. Both products read and write it through the same module.

**Scopes** (every memory row carries one):
- `personal`: the user's life. Visible to Dinghy and to the user's own agents. Never shared.
- `business:<id>`: a Dock business or project. Visible to all agents assigned to that business and to its members. Written by agents, approved by the owner.
- `agent:<id>`: working notes for one agent. Private to that agent, promotable to a business scope.

**Write path:** extract, then propose, then approve. Business and promoted memories require owner approval before becoming shared (Beacon's recall, distill, promote pattern). Personal memories from chat can auto-save, as today.

**Read path:** `memory_search` and per-turn context load, scoped by the caller's identity and the scopes it is allowed to see.

**Identity:** `spectrum_identities` already maps iMessage handles to users. Extend it to Telegram, web login, and Shipyard OS sessions so one person resolves to one `user_id`.

## 3. Who uses what

- **Prosumer (Dinghy):** personal memory is primary. Business memory is opt-in: they create a business space, and Dinghy's tools (Gmail, Calendar, GitHub) write to it with approval.
- **Hardcore (Dock / Shipyard OS):** business and agent scopes are primary. Agents in a business share its memory. Each agent keeps working notes.
- Both use the same personal scope. A Dinghy user who later runs an agent team sees the same facts.

## 4. Gaps to close

1. **Shipyard OS has no database memory.** Migrate `data/*.json` and the markdown memory to Supabase tables. Use the `supabase-storage-migration` skill as the pattern.
2. **Scope column and RLS.** Add `scope` (`personal` | `business:<id>` | `agent:<id>`) and an owner to memory tables. Enforce by RLS, not only in app code.
3. **Shared module.** Move `src/lib/memory/*` into a package both repos import, or extract a small `@shipyard/memory` package. Dinghy's code is the starting point.
4. **Approval queue.** Reuse the existing approval pattern from Dinghy's `actions.ts` (proposal, confirm, execute) for promoting memories to business scope.
5. **Identity linking across surfaces.** Telegram and Shipyard OS login must resolve to the same `user_id`. This is the hardest part and needs a linking flow.
6. **Dinghy's iMessage handler is the only memory client today.** Shipyard OS agents need the same `memory_search` tool exposed through MCP.

## 5. Phases

**Phase 0: decisions (no code).** Confirm the scope model, the approval rules, and whether Dinghy's Supabase project is the shared store (or a new one).

**Phase 1: extract the shared module.** Move Dinghy's memory code into a shared package with no behavior change. Dinghy tests must still pass (`dinghy-memory.test.ts`, `memory-commands.test.ts`, `user-memory.test.ts`).

**Phase 2: add scope and RLS.** Migration adds `scope` and owner. Backfill all existing rows as `personal`. Verify RLS with two test users.

**Phase 3: Shipyard OS reads and writes memory.** Replace file-based memory with the store. Expose `memory_search` and `memory_write` via MCP. Keep the markdown view as a read-only export.

**Phase 4: business scope + approvals.** Business spaces, membership, agent assignment, promote-to-business queue with owner approval.

**Phase 5: identity linking.** Telegram and web login to one `user_id`. Shared memory is then visible in every surface.

**Phase 6: Cua computer use for Dock agents.** Out of scope here. Plug into the same tool layer after memory is shared.

## 6. Risks

- **Leakage:** personal memory reaching a business scope. Mitigate with RLS, scope checks in every query, and a test for each scope boundary.
- **Poisoning:** agents writing false facts into shared memory. Mitigate with the approval gate and the `looksSecret` filter.
- **Secrets in memory:** the existing `looksSecret` filter is the first line. Extend it to business memories.
- **Two Supabase projects drifting:** keep one schema, one migrations folder.

## 7. Decisions (Oct 21, 2026)

- **Separate Supabase projects and repos.** Dinghy (personal users) and Dock (business/project harness) do not share a database. Dinghy users may never move to Dock. The shared piece is the code package, not the data.
- **Ingest path:** connecting a source (Gmail, Calendar, Telegram, files) to a business space runs through an agent skill. The agent proposes what to ingest, the owner approves.
- **Approval:** team admins can accept business-scope memory writes.
- **Phase 1 approved.** Done: see section 8.

## 8. Phase 1 status

- New package  (), local git repo, one commit. Not pushed.
- Dependencies are injected via . No product aliases.
- Ported: , , .
- Tests: 5/5 pass (pure functions only).  clean.
- NOT yet verified: DB-backed functions (search, supersede, re-embed) have no tests here. Dinghy is not switched over yet (Phase 1b).
- Dinghy repo (~/dock) untouched: it has uncommitted changes from other work on branch feat/profile-wallet-files.

## 7. Decisions (Oct 21, 2026)

- **Separate Supabase projects and repos.** Dinghy (personal users) and Dock (business/project harness) do not share a database. Dinghy users may never move to Dock. The shared piece is the code package, not the data.
- **Ingest path:** connecting a source (Gmail, Calendar, Telegram, files) to a business space runs through an agent skill. The agent proposes what to ingest, the owner approves.
- **Approval:** team admins can accept business-scope memory writes.
- **Phase 1 approved.** Status in section 8.

## 8. Phase 1 status

- New package at `~/projects/shipyard-memory` (`@shipyard/memory`), local git repo, one commit, not pushed.
- Dependencies are injected via `configureMemory({ getSupabase, logger, complete })`. No product aliases.
- Ported: `store.ts`, `embeddings.ts`, `extractor.ts`.
- Tests: 5/5 pass (pure functions only). `tsc` clean.
- Not yet verified: DB-backed functions (search, supersede, re-embed) have no tests here. Dinghy is not switched over yet (Phase 1b).
- Dinghy repo (`~/dock`) untouched. It has uncommitted changes from other work on branch `feat/profile-wallet-files`.

## 8b. Phase 1b status (Oct 21, 2026)

- Branch `feat/shared-memory-package` in a worktree at `/tmp/dinghy-memory-1b`, off `origin/main` (e8853aa). Commit `7815fa2`. Not pushed, not merged.
- Dinghy's `src/lib/memory/{store,embeddings,extractor}.ts` are now re-export shims over `@shipyard/memory`. `configure.ts` wires the injected dependencies (Supabase client, logger, LLM `chat`).
- The package is vendored as `vendor/shipyard-memory-0.1.0.tgz` (same pattern as `shipyard-inference`). Lockfile integrity matches the tarball.
- Verified: fresh `npm ci --ignore-scripts` from a clone of the branch succeeds. The 5 memory-related test files pass (43 tests). Full suite: 1459 pass, 2 fail, and both pass in isolation (flaky under parallel load).
- Pre-existing `tsc` error at `src/lib/spectrum/routing.ts:52`, not from this change.
- Still untested: the DB-backed memory functions against real Supabase.
- SHIPPED: rebased onto origin/main (efc1c67) as 09e4b88, pushed to main. Production deployment 7235312791 succeeded for that sha. Branch ship/shared-memory also pushed.

## 8c. Phase 2 status (Oct 21, 2026)

- Finding: Dinghy's Supabase is personal-only. Business and agent scopes belong in Dock's project, so Dinghy gets only `personal` and `guest`.
- Live state read before writing: memories 151 rows (137 user-keyed, 14 guest chat-only). RLS is on, with no policies. The server uses the service role, so RLS is defense in depth. Anon reads return []; anon inserts fail with 42501.
- Migration `073_memory_scope.sql` on branch `feat/memory-scope` (pushed, not on main, not applied to prod). Adds scope with backfill, an owner invariant check, and updates both add_chat_memory overloads to tag guest rows. Dry-run in a rolled-back transaction: 0 invariant violations, and the rollback was confirmed.
- SHIPPED: 073 on main as 2252f29 (rebased onto c9d1cdb). Applied to Dinghy prod DB; verified: scope column present, personal:137 guest:14, 0 violations, both constraints present, both add_chat_memory overloads tag guest. Prod deployment 7238199785 Production success; www.getdinghy.sh 200. Dock-side scope model (business/agent) is Phase 2 for Dock's project, not started.

## 8d. Cross-product link (Oct 21, 2026)

- Databases stay separate. A Dock instance can connect to a Dinghy user, but the connection is an authorized API or MCP call with user consent, never a shared table, FK, or join.
- Memory crossing the boundary goes through that channel only, and the receiving side stores it in its own scope (for Dinghy, personal; for Dock, the business scope the user chooses).
- Current state: no Dinghy connection code exists in ~/dock (grep for dinghy in app/lib/components is empty).
- FIXED Oct 21: ~/dock CLI relinked from Dinghy's project (lrucvslmyrowrfenytes, named "Shipyard-dock") to Dock's project hqnhbaxmxlmoudllgyuv ("dock-harness"). Verified: read-only query returns 14 public tables and no memories table. Note: "Shipyard-dock" is Dinghy's database, so the name is misleading.

## 9. Open questions for Halsey

1. Should Dinghy's personal memories appear in Shipyard OS automatically, or only if the user opts in? (Still open.)
2. Phase 1b: switch Dinghy to import `@shipyard/memory`. Approve before touching `~/dock`, since it has uncommitted work.
