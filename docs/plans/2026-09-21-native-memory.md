# Dock Native Memory Layer — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace Dock's lossy 50-message window + flat JSON preferences with an in-house memory layer on Supabase: semantic+keyword recall over full history, durable entity/fact memories with superseding, and a dynamic profile injected into the system prompt — zero recurring vendor cost.

**Architecture:** New `memories` table with pgvector embeddings + a `match_memories` RPC. Facts extracted in the background by a cheap LLM after each turn (replacing the `user_preferences` JSON extractor). A `memory_search` / `memory_forget` tool pair exposes recall to the agent. Prompt build injects top-k relevant memories + a static profile section. Summarization stops deleting raw messages (marks `compacted=true` instead).

**Tech Stack:** Supabase Postgres + pgvector, OpenAI `text-embedding-3-small` (embeddings only — via existing `openai` dep and `OPENAI_API_KEY`), existing LLM provider abstraction for extraction, Next.js 15 `after()` for background work.

**Repo:** `/Users/halseyhuth/dock` (branch: `feat/native-memory`). No test framework exists; add `vitest` for pure-logic units. Verification for integration = `npx tsc --noEmit`, `npm run build`, and applying the migration.

**Constraints:**
- Keep raw `messages` rows as the source of truth; memories are derived/index data.
- Never block the reply path on extraction/embedding — everything background.
- All failures in memory code are non-fatal: log, continue.
- Do NOT touch the `users.preferences` column yet (legacy fallback stays read-only in prompts until Task 9).

---

### Task 1: Branch + vitest setup

**Objective:** Working branch with a test runner so subsequent tasks can be TDD.

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add `"test": "vitest run"` script, `vitest` devDep)

**Steps:**
1. `cd /Users/halseyhuth/dock && git checkout -b feat/native-memory`
2. `npm install -D vitest`
3. Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
```
4. Add to `package.json` scripts: `"test": "vitest run"`
5. Verify: `npm test` → exits 0 with "no test files found" (or add `passWithNoTests: true` to config).
6. Commit: `git commit -am "chore: add vitest for native memory work"`

---

### Task 2: Migration 005 — memories table, RPC, indexes, compacted flag

**Objective:** Database schema for memories, hybrid search RPC, and non-destructive summarization support.

**Files:**
- Create: `supabase/migrations/005_native_memory.sql`

**Content:**
```sql
-- Native memory layer
create extension if not exists vector;

create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null default 'fact'
    check (type in ('fact','person','preference','org','event')),
  content text not null,
  embedding vector(1536),
  source_message_id integer,
  valid_from timestamptz not null default now(),
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists memories_user_active_idx
  on memories (user_id) where superseded_at is null;
create index if not exists memories_embedding_idx
  on memories using hnsw (embedding vector_cosine_ops)
  where superseded_at is null;
create index if not exists messages_user_created_idx
  on messages (user_id, created_at desc);

-- Semantic match RPC (active memories only)
create or replace function match_memories(
  p_user_id uuid,
  p_embedding vector(1536),
  p_limit int default 8
)
returns table (
  id uuid, type text, content text,
  valid_from timestamptz, similarity float
)
language sql stable
as $$
  select m.id, m.type, m.content, m.valid_from,
         1 - (m.embedding <=> p_embedding) as similarity
  from memories m
  where m.user_id = p_user_id
    and m.superseded_at is null
    and m.embedding is not null
  order by m.embedding <=> p_embedding
  limit p_limit;
$$;

-- Keyword recall over full message history
create index if not exists messages_content_trgm_idx
  on messages using gin (content gin_trgm_ops);
create extension if not exists pg_trgm;

-- Non-destructive summarization support
alter table messages add column if not exists compacted boolean not null default false;
```

**Steps:**
1. Write the file exactly as above.
2. Apply it: find the Supabase connection (check `.env.local` `SUPABASE_DB_URL`/`DATABASE_URL` or use `supabase db push` if CLI is linked). If neither is available locally, leave application to deploy time and note it — do NOT fabricate success. Verify with a `\d memories` or equivalent if a connection exists.
3. Commit: `git commit -am "feat: migration 005 — memories table, pgvector RPC, non-destructive summarization"`

---

### Task 3: Embeddings helper

**Objective:** Single function to embed text via OpenAI (embeddings only; independent of LLM_PROVIDER).

**Files:**
- Create: `src/lib/memory/embeddings.ts`

**Content:**
```ts
import OpenAI from 'openai'
import { logger } from '@/lib/logger'

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' })
  return client
}

export async function embedText(text: string): Promise<number[] | null> {
  try {
    const res = await getClient().embeddings.create({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000),
    })
    return res.data[0]?.embedding ?? null
  } catch (err) {
    logger.error('Embedding failed', { error: err instanceof Error ? err.message : String(err) })
    return null // non-fatal: memory stored without embedding, still keyword-searchable
  }
}
```

**Steps:**
1. Write file.
2. Verify: `npx tsc --noEmit` passes.
3. Commit: `git commit -am "feat: embeddings helper for native memory"`

---

### Task 4: Memory store (remember / search / supersede)

**Objective:** Core data operations over `memories`, with TDD on the pure merge/dedupe logic.

**Files:**
- Create: `src/lib/memory/store.ts`
- Test: `src/lib/memory/store.test.ts`

**Design:**
- `rememberMemories(userId, facts: {content, type, sourceMessageId?}[])` — embeds each fact, upserts; if an existing active memory is >0.92 cosine-similar, skip as duplicate.
- `searchMemories(userId, query, limit=8)` — calls `match_memories` RPC; returns rows or `[]` on any failure.
- `supersedeMemory(userId, contentSubstring)` — marks all active memories whose content contains the substring as `superseded_at = now()`; returns count.
- `getActiveMemories(userId, limit=50)` — recent active memories for profile building.
- Pure helpers exported for tests: `isDuplicate(similarity)` and `mergeMemorizableFacts(newFacts, existingContents)` (lowercase-trim dedupe against existing).

**Steps (TDD):**
1. Write failing test for `mergeMemorizableFacts` (dedupes case-insensitively, keeps new unique facts) and `isDuplicate`. Run `npm test` → FAIL.
2. Implement `store.ts` (Supabase client from `@/lib/supabase/server`; RPC call via `.rpc('match_memories', {...})` passing the embedding as a JSON array — Supabase accepts `JSON.stringify(embedding)` for vector params).
3. `npm test` → PASS. `npx tsc --noEmit` → clean.
4. Commit: `git commit -am "feat: memory store — remember, search, supersede"`

---

### Task 5: Background fact extractor (replaces preference-extractor writes)

**Objective:** Extract durable facts from recent conversation and write them to `memories`.

**Files:**
- Create: `src/lib/memory/extractor.ts`
- Modify: `src/lib/orchestrator/index.ts:197-204` — replace the `preference-extractor` import/call with `extractMemories(user.id)`

**Design:** Mirror `preference-extractor.ts`'s structure: fetch last 30 non-compacted messages, require ≥5, single haiku/gpt-4o-mini call (reuse `getSummarizationModel` pattern — read it from `memory.ts` or duplicate the 4-line helper), system prompt:

```
extract durable facts worth remembering about the user from this conversation.
respond with ONLY valid JSON: {"facts": [{"content": "...", "type": "fact|person|preference|org|event"}]}
rules:
- only concrete, reusable facts (decisions, preferences, people, plans, ongoing situations)
- include the date/time when the fact is time-bound (e.g. "flight to NYC on Oct 3")
- no transient chatter, no questions, no filler
- max 5 facts; omit facts already covered by existing memories listed below
existing: <JSON array of getActiveMemories(userId) contents>
```

Then call `rememberMemories`. Every failure: `logger.warn`, return silently.

**Steps:**
1. Write `extractor.ts`.
2. In `orchestrator/index.ts`, swap the background call (keep the every-10-messages cadence).
3. Verify: `npx tsc --noEmit`, `npm test` pass.
4. Commit: `git commit -am "feat: background fact extractor writing to memories table"`

---

### Task 6: memory_search + memory_forget tools

**Objective:** Agent-facing recall tools.

**Files:**
- Create: `src/lib/tools/memory.ts`
- Modify: `src/lib/tools/index.ts` — export and include in `getOrchestratorTools`

**Design (follow the exact `Tool` interface in `src/lib/llm/types.ts:50-55` and style of an existing simple tool like `reminders.ts`):**

```ts
const memorySearch: Tool = {
  name: 'memory_search',
  description: "Search everything you know about the user — past conversations, facts, preferences, people. Use when the user references something from before ('that place I mentioned', 'my flight') or you need older context.",
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  execute: async (input, ctx) => {
    const { searchMemories } = await import('@/lib/memory/store')
    const results = await searchMemories(ctx.userId, String((input as {query: string}).query))
    const { keywordSearchMessages } = await import('@/lib/memory/store')
    const messages = await keywordSearchMessages(ctx.userId, String((input as {query: string}).query))
    return { success: true, data: { memories: results, past_messages: messages } }
  },
}
```

- `memory_forget`: input `{ query }` → `supersedeMemory`, reply "forgot N memories".
- Add `keywordSearchMessages(userId, query)` to `store.ts`: Supabase `.textSearch` or `.ilike` fallback over `messages.content` where `compacted = false OR true` (search everything), limit 10, return `{role, content, created_at}`.
- Add both tools to `getOrchestratorTools` return in `src/lib/tools/index.ts` (read that function first to match its assembly pattern).

**Steps:**
1. Write `store.ts` additions + tests for keyword search query building if pure.
2. Write `tools/memory.ts`, register in index.
3. Verify: `npx tsc --noEmit`, `npm test`, `npm run build` all pass.
4. Commit: `git commit -am "feat: memory_search and memory_forget agent tools"`

---

### Task 7: Prompt injection — relevant memories + profile section

**Objective:** The agent sees relevant memories every turn without a tool call.

**Files:**
- Modify: `src/lib/orchestrator/system-prompt.ts` (add `relevantMemories` + `staticProfile` params, render a "## What you remember" section with dates: `- [2026-09-18] flight to NYC Friday`)
- Modify: `src/lib/orchestrator/index.ts:151-162` — before `buildSystemPrompt`, call `searchMemories(user.id, text, 8)` (non-fatal: `[]` on error) and `getActiveMemories(user.id, 30)`; pass both.
- Modify: `src/lib/orchestrator/system-prompt.ts:93-148` `buildPreferencesSection` — keep as fallback: use memories-derived profile when memories exist, else fall back to the legacy `userPreferences` JSON.

**Steps:**
1. Implement prompt changes; keep total injected memory text ≤ ~800 tokens (truncate list).
2. Verify: `npx tsc --noEmit`, `npm run build`.
3. Commit: `git commit -am "feat: inject relevant memories and profile into system prompt"`

---

### Task 8: Non-destructive summarization

**Objective:** `summarizeOldMessages` stops deleting history.

**Files:**
- Modify: `src/lib/orchestrator/memory.ts:55-112`

**Changes:**
1. Replace the `DELETE ... in idsToDelete` with `UPDATE messages SET compacted = true WHERE id in (...)`.
2. In `fetchConversationHistory` (line 40-45), add `.eq('compacted', false)` to the newest-N query so only active messages are fetched.
3. Keep inserting the synthetic summary message unchanged.
4. Update the comment at line 39 explaining that compacted rows remain recallable via `memory_search`.

**Verify:** `npx tsc --noEmit`, `npm test`, `npm run build`. Commit: `git commit -am "fix: summarization marks messages compacted instead of deleting"`

---

### Task 9: Cleanup + deprecation

**Objective:** Remove dead code; document the system.

**Files:**
- Delete: `src/lib/orchestrator/preference-extractor.ts` (verify no remaining imports first: `grep -rn "preference-extractor" src/`)
- Modify: `README.md` — short "Memory" section describing the layers (raw messages → memories → prompt injection) and the `memory_search`/`memory_forget` tools.

**Steps:**
1. Grep, delete, verify build.
2. Update README.
3. Commit: `git commit -am "refactor: remove legacy preference extractor, document memory layer"`

---

## Verification checklist (final)

- [ ] `npm test` green
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] Migration applied or handoff note recorded for deploy
- [ ] Manual smoke (if dev env available): send "remember that my sister's birthday is March 4" → extractor stores it; new session asks "when is my sister's birthday?" → answered from injected memories without a tool call.

## Deployment notes

- Env: requires `OPENAI_API_KEY` in Vercel (embeddings). Check before deploy.
- Vercel deploys from a separate checkout (`~/projects/shipyard-os` pattern does NOT apply here — dock deploys from this repo per vercel.json; confirm with `git remote -v` before merging).
