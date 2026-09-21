# Dinghy — iMessage Front Door via Spectrum

Dinghy's iMessage front door is powered by [Spectrum](https://photon.codes/docs/spectrum-ts) (Photon). iMessage is the primary channel; Telegram remains channel #2.

The entry point (`src/spectrum/index.ts`) is a **standalone process** — no Next.js, no `@/` aliases. It calls Shipyard Inference's OpenAI-compatible HTTP gateway directly via `fetch`.

## Setup

1. Fill in `.env`:

```
SPECTRUM_PROJECT_ID=958b9de0-be41-4251-97ba-aa83894db907
SPECTRUM_PROJECT_SECRET=<from Photon dashboard>
SHIPYARD_GATEWAY_URL=https://shipyard-inference.vercel.app
SHIPYARD_API_KEY=<from the gateway>
```

2. Get a Shipyard API key:

```bash
curl -X POST https://shipyard-inference.vercel.app/api/keys -H 'Content-Type: application/json' -d '{}'
```

3. Run:

```bash
npx tsx src/spectrum/index.ts
```

## Architecture

```
iMessage (+1 628 264-7754)
  → Spectrum (Photon) bridge
    → fetch POST /v1/chat/completions
      → Shipyard Inference Gateway
        → Router: cheapest capable model (Anthropic / OpenAI / UsePod)
        → Per-call USDC settlement (x402 on Solana)
        → Savings telemetry
```

No Next.js bundler, no vendored tgz, no `@/` aliases. Just `spectrum-ts` + `@spectrum-ts/imessage` + `fetch`. The gateway is Shipyard — that's the architecture.

## Spectrum Cloud project

- **Project:** Dinghy (free tier, 10 users)
- **Project ID:** `958b9de0-be41-4251-97ba-aa83894db907`
- **Managed iMessage line:** +1 (628) 264-7754 (shared free line; replies only to numbers added to the project)
- **Photon dashboard:** https://app.photon.codes

## Adding iMessage contacts

Only numbers added to the Spectrum Cloud project can receive replies. Add contacts from the Photon dashboard or via the `photon` CLI.

## Next steps

- [ ] Persist conversation history to Supabase (currently in-memory)
- [ ] Add tool access (email, calendar, GitHub, Notion) from iMessage
- [ ] Per-user Shipyard API keys (so each user's calls settle from their own wallet)
