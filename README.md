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
- **Embeddings** use OpenAI `text-embedding-3-small`, which requires `OPENAI_API_KEY`.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
