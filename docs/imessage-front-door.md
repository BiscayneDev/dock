# Dock — iMessage Front Door via Spectrum

Dock's iMessage front door is powered by [Spectrum](https://photon.codes/docs/spectrum-ts) (Photon). iMessage is the primary channel; Telegram remains channel #2.

## Setup

1. Fill in `.env` with `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET` from the [Photon dashboard](https://app.photon.codes).

2. Install dependencies and run:

```bash
npm install
npx tsx src/spectrum/index.ts
```

Or with bun:

```bash
bun install
bun run start
```

## Architecture

```
iMessage (+1 628 264-7754)
  → Spectrum (Photon) bridge
    → Dock LLM layer (src/lib/llm)
      → Shipyard Inference Router
        → Anthropic / OpenAI / UsePod (cheapest capable)
        → Per-call USDC settlement (x402)
        → Savings telemetry → Supabase
```

All model calls route through Shipyard Inference — cost-aware routing, prompt caching, and per-call USDC settlement. The iMessage user never picks a model; the router picks the cheapest one that can handle the request.

## Spectrum Cloud project

- **Project:** "Dock" on Spectrum Cloud (free tier, 10 users)
- **Project ID:** `958b9de0-be41-4251-97ba-aa83894db907`
- **Managed iMessage line:** +1 (628) 264-7754 (shared free line; only replies to numbers added to the project)
- **Photon dashboard:** https://app.photon.codes

## Adding iMessage contacts

Only numbers added to the Spectrum Cloud project can receive replies. Add contacts from the Photon dashboard or via the `photon` CLI.
