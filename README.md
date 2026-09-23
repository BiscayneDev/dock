This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Memory

Dock has a persistent memory layer on top of the raw message history:

- **Raw messages** live in Supabase and are the source of truth — rows are never deleted. Older messages are marked `compacted` during summarization but stay searchable.
- **Background fact extractor**: every ~10 messages, a lightweight extractor pulls durable facts out of the conversation and writes them to the `memories` table (new facts supersede outdated ones).
- **Prompt injection**: relevant memories plus the user profile are injected into each system prompt, so the agent remembers across sessions.
- **Agent tools**: the agent can call `memory_search` and `memory_forget` on its own.
- **Embeddings** default to OpenAI `text-embedding-3-small` but point at any OpenAI-compatible endpoint via env vars: `EMBEDDINGS_BASE_URL` (e.g. a Shipyard Inference gateway `/v1`), `EMBEDDINGS_API_KEY`, `EMBEDDINGS_MODEL` (tagged per row with its model; if the embedding model changes, search falls back to keyword results and stale vectors are re-embedded automatically (migration 006)). Falls back to `OPENAI_API_KEY` when the dedicated vars are unset; without any key, memory degrades to keyword-only search.

### Dinghy (iMessage) memory

Dinghy uses the same `memories` table and embeddings, keyed by `chat_guid` so every chat gets memory whether or not it has connected Google/PayBox (migration 024, code in `src/lib/spectrum/memory.ts`). Three layers:

| Layer | Table | In the prompt |
| --- | --- | --- |
| Profile | `dinghy_profiles` - one short document per chat, rewritten as things change | always (capped at 1,200 chars) |
| Episodes | `conversation_summaries` - 2-4 sentence summaries of stretches that scrolled out of the 20-message history window | latest 2 |
| Facts | `memories` rows with `chat_guid` - atomic facts | top 5 by relevance to the current message (pgvector; newest-first without an embeddings key) |

- **Reads** happen before the reply in parallel with history: one RPC plus one embedding call.
- **Writes** happen after the reply is sent, at most once every 10 messages (atomic `claim_memory_update`), so memory never slows a reply. One LLM call rewrites the profile and extracts up to 5 new facts; a second writes a summary when 20+ messages have left the window.
- **Safety**: anything that looks like a credential, card/account number, SSN, or seed phrase is dropped before storage; facts dedupe at >0.92 similarity; `forget_chat_memories` soft-deletes (reversible). Raw `spectrum_messages` stay the source of truth, so all three layers can be rebuilt.
- **Where it lives**: all in this Supabase project. The only outside calls are the embeddings endpoint and the Shipyard gateway for extraction/summaries.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
