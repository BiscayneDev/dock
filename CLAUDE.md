# Dock — CLAUDE.md

## What This Is
Dock is an open-source agent operating system: a Next.js app where humans assign work, agents execute it, and the record (brief → task → run) is the unit of coordination. Five surfaces replace what used to be ~24 top-level pages.

## Stack
- **Framework:** Next.js (App Router), TypeScript strict
- **Styling:** Tailwind CSS 4; dark theme tokens (`--surface-0..3`, `--ink`, `--ink-2`, `--ink-3`, `--line`, `--line-strong`, `--gold`) in `app/globals.css`. Do not restyle.
- **Data:** Postgres via Supabase with row-level security (`db/migrations/`); local JSON under `data/` for dev. Vercel KV optional for some stores.
- **Agent runtime:** OpenClaw, Ollama, Shipyard Inference, or demo mode.
- **Deploy:** push to `main` auto-deploys on Vercel; `.github/workflows/ci.yml` runs `npm run build` first.

## Key Commands
```bash
npm run dev          # Dev server → localhost:3000
npm run build        # Production build (always run before push; Node 25 on PATH)
npx tsc -p tsconfig.json --noEmit   # Typecheck
git add <paths> && git commit -m "feat: ..."
```

## Surfaces (the IA)

| Surface | Route | Holds |
|---|---|---|
| Inbox | `/inbox` | Approvals, questions, blockers, alerts |
| Work | `/work` | Today's brief, Missions board, runs/activity, projects health, intel, calendar, company goals |
| Agents | `/agents` | Roster, skills, per-agent budgets and knowledge |
| Knowledge | `/knowledge` | Memory, skills library, research docs |
| Settings | `/settings` | Devices, connectors, billing, schedules, notifications |

Mobile bottom nav has four items: Inbox, Work, Agents, Settings. The "Launch a venture" button stays in the rail.

Legacy routes are never deleted. `/dashboard` redirects to `/work`; `/tasks`, `/treasury`, `/projects`, `/intel`, `/calendar`, `/company`, `/costs`, `/alerts`, `/activity`, `/conversations`, `/messages`, `/memory`, `/schedules`, `/skills`, `/docs`, `/shipwright`, `/setup`, `/onboarding` all still serve their own page as deep links. Nothing may 404 for an existing bookmark.

`components/Sidebar.tsx` owns the nav map; `components/CommandPalette.tsx` must reach every surface and legacy page.

## Project Structure
```
app/
  work/            # WorkClient.tsx: brief, rails, feeds; embeds TasksBoard
  tasks/
    TasksBoard.tsx # the kanban board (also embedded in /work)
    page.tsx       # thin wrapper -> TasksBoard
  dashboard/page.tsx  # redirect("/work")
  inbox/, knowledge/  # built by sibling workstreams
  agents/, settings/, setup/, onboarding/, shipwright/
  treasury/, projects/, intel/, calendar/, company/, costs/
  conversations/, messages/, activity/, alerts/, memory/, schedules/, skills/, docs/
  api/             # route handlers (never edit shapes without the controller)
components/
  Sidebar.tsx      # five-surface rail + mobile bottom nav
  CommandPalette.tsx
  assistant/, tasks/, settings/, runs/, onboarding/
lib/               # pure modules + data access
db/migrations/     # numbered SQL; take the next number from the union of origin/main + working tree
data/              # local JSON stores (dev only)
```

## Architecture Notes
- **Chief of Staff identity.** Never hardcode a chief's name. Resolve it from the roster: `kind='chief_of_staff'` in `agents` (see `lib/briefs.ts pickChief`, `lib/tenancy.ts`), display name from `display_name`. Use the generic phrase "the Chief of Staff" in copy. `lib/chief-key.ts` holds only the runtime key and role label.
- **API routes that shell out** use full binary paths (`/opt/homebrew/bin/openclaw`, `gh`, `gog`) because Next.js does not inherit shell PATH.
- **Vercel detection:** `process.env.VERCEL` — skills, calendar, and deploy routes degrade gracefully.
- **Tasks persistence:** Postgres/KV in production, local JSON in dev.
- **Kanban:** `@hello-pangea/dnd`.
- **Agent callbacks** (`/api/tasks/agent-spawn`, `agent-done`, `/api/notify`) require `DOCK_AGENT_TOKEN`; see `docs/agent-callbacks.md`. Do not weaken those rules.
- **No Stripe.** Payments stay on MoonPay Commerce + x402; never touch confirm rules.
- **Brief invariant:** only an approved brief creates a run; the ledger is append-only. Do not weaken this.

## DO NOT
- Break the dark theme or add a new design language.
- Delete a route or let an old bookmark 404.
- Change data shapes or API contracts.
- Add a literal default chief name; resolve it from the roster.
- Touch payments/confirm rules.
- Edit another worktree (`/tmp/dock-inbox`, `/tmp/dock-knowledge`, `~/dock`).
- Push without a green `npm run build`.

## Env Vars
See `.env.example`. Highlights: `AGENT_RUNTIME`, per-agent `AGENT_MODEL_<KEY>`, `SHIPYARD_INFERENCE_URL`, `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`, `KV_REST_API_URL`/`KV_REST_API_TOKEN`, `GITHUB_TOKEN`.
