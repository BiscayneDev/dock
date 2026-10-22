# Mission Control — CLAUDE.md

## What This Is
Halsey Huth's personal AI mission control dashboard. A Next.js web app that surfaces agent status, tasks, projects, intel, and skills in one place.

## Stack
- **Framework:** Next.js 16 (App Router), TypeScript strict
- **Styling:** Tailwind CSS
- **Design system:** Dark theme — bg #0a0a0f, cards #111118, glow borders per accent color
- **Deploy:** Vercel (auto-deploy from BiscayneDev/mission-control main branch)
- **URL:** https://mission-control-two-ebon.vercel.app

## Key Commands
```bash
npm run dev          # Dev server → localhost:3000 (or 3001 if taken)
npm run build        # Production build (always run before push)
vercel --prod        # Deploy to production
git add -A && git commit -m "feat: ..."
```

## Project Structure
```
app/
  dashboard/     # NEW: Command center overview (default landing page)
  agents/        # Team page — Vic + 4 agents with live sessions + activity feed
  tasks/         # Kanban board (Backlog/In Progress/In Review/Done)
  projects/      # GitHub repos (BiscayneDev) with PR/CI status + pinned projects
  intel/         # Scout's market intelligence feed
  skills/        # OpenClaw skills list
  calendar/      # NEW: Google Calendar via gog CLI
  memory/        # Stub
  docs/          # Stub
  settings/      # Stub
  api/
    tasks/         # CRUD — reads/writes data/tasks.json locally
    projects/      # GitHub REST API + gh CLI for PRs/CI status
    skills/        # openclaw skills list --json (local only)
    sessions/      # OpenClaw gateway sessions via HTTP
    activity/      # Activity feed from OpenClaw gateway
    memory/        # Reads ~/clawd/memory files
    costs/         # CodexBar usage/cost data
    standup/       # Daily standup generation
    calendar/      # NEW: Google Calendar events via gog CLI
    intel/
      report/      # Reads ~/clawd/agents/scout/reports/latest.json
      deploy/      # Spawns Scout research script in background
components/
  Sidebar.tsx    # Desktop sidebar + mobile bottom nav (5 items)
lib/
  tasks.ts       # Task types + constants
data/
  tasks.json     # Local task store (not persisted on Vercel)
```

## Pages

### `/dashboard` (default landing page)
Command center morning briefing overview:
- **Agent status row** — 5 agents (Vic/Scout/Deal Flow/Builder/Baron) with live pulsing dot if session active
- **Task summary** — counts by column (Backlog / In Progress / In Review / Done)
- **Projects health** — 4 pinned repos with CI color dot + PR count + last updated
- **Recent intel** — last Scout report timestamp + 1-sentence summary
- **Quick actions** — Deploy Scout, New Task, GitHub link, Vercel link

### `/agents`
Full team page with Vic hero card, 2x2 agent grid, live sessions panel, activity feed.

### `/tasks`
Kanban board with drag-and-drop ([@hello-pangea/dnd](https://github.com/hello-pangea/dnd)).

### `/projects`
GitHub repos with:
- **Pinned projects** section at top (shipyard, mission-control, superteam-miami, arken)
- PR count badge (amber) for repos with open PRs
- CI status indicator (green/red/amber pulsing) via gh CLI
- Custom fallback descriptions for known projects

### `/calendar`
Google Calendar upcoming events:
- Fetched via `gog` CLI (`/opt/homebrew/bin/gog`)
- Grouped by day with cyan accent
- Shows time, title, location
- Empty state if no events or CLI unavailable

### `/intel`
Scout's market intelligence reports with deploy button.

### `/company`
Company overview page with 4 sections:
- **Mission statement** — Biscayne Ventures mission card with purple accent
- **Org chart** — Visual tree: Halsey → Vic → 4 agents
- **Agent budgets** — Monthly spend vs hardcoded budgets (via `/api/company/budgets`)
- **Goals** — Editable goal tracker stored in `data/goals.json`

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/tasks` | GET/POST | Task CRUD |
| `/api/tasks/[id]` | PATCH/DELETE | Individual task ops |
| `/api/projects` | GET | GitHub repos + PR/CI data for pinned repos |
| `/api/sessions` | GET | Active OpenClaw sessions via gateway |
| `/api/activity` | GET | Recent agent activity feed |
| `/api/memory` | GET | Agent memory files |
| `/api/costs` | GET | CodexBar usage/cost data |
| `/api/standup` | GET | Daily standup |
| `/api/calendar` | GET | Google Calendar events via gog CLI |
| `/api/skills` | GET | Installed OpenClaw skills |
| `/api/intel/report` | GET | Latest Scout report |
| `/api/company/budgets` | GET | Per-agent spend vs budgets |
| `/api/company/goals` | GET/POST | Goal CRUD (data/goals.json) |
| `/api/company/goals/[id]` | PATCH/DELETE | Update/delete individual goal |
| `/api/intel/deploy` | POST | Deploy Scout research run |

## Architecture Notes
- **API routes with CLIs** must use full binary paths: `/opt/homebrew/bin/openclaw`, `/opt/homebrew/bin/gh`, `/opt/homebrew/bin/gog` — Next.js doesn't inherit shell PATH
- **Vercel detection:** `process.env.VERCEL` — skills, calendar, and deploy routes gracefully degrade on Vercel
- **Tasks persistence:** Local JSON (not persisted on Vercel). If adding DB: use Vercel KV
- **Mobile:** Bottom nav bar (5 items: Dashboard, Tasks, Projects, Intel, Costs), sidebar hidden on mobile (`md:hidden`)
- **Kanban:** Uses `@hello-pangea/dnd` for drag-and-drop
- **PR/CI:** Only fetched for pinned repos (to avoid gh rate limits). Uses `execFile` with 8s timeout

## Agents in the App
| Agent | Emoji | Color |
|-------|-------|-------|
| Vic | 🦞 | #7c3aed (purple) |
| Scout | 🔭 | #06b6d4 (cyan) |
| Deal Flow | 🤝 | #f59e0b (amber) |
| Builder | ⚡ | #10b981 (emerald) |
| Baron | 🏦 | #ec4899 (pink) |

## Pinned Projects
These always appear at the top of `/projects`, in this order:
1. **shipyard** — "API marketplace for autonomous AI agents"
2. **mission-control** — "Personal AI command center"
3. **superteam-miami** — "Solana community hub for Miami"
4. **arken** — "Real-time financial news terminal + prediction markets"

## Env Vars (Vercel)
- `GITHUB_TOKEN` — GitHub PAT for private repo access in Projects page

## DO NOT
- Break the dark theme (bg #0a0a0f)
- Add pagination/routing complexity — keep pages self-contained
- Use `any` in TypeScript
- Push without running `npm run build` first
- Work in ~/clawd — that's Vic's workspace

## Task Storage (Updated)

Tasks are now persisted in **Vercel KV** in production, with local JSON fallback for dev.

- **KV key:** `"tasks"` (JSON array of Task[])
- **Detection:** `process.env.KV_REST_API_URL` → KV; otherwise → `data/tasks.json`
- **Fallback:** if KV throws, silently falls back to local file
- **Env var needed on Vercel:** `KV_REST_API_URL` + `KV_REST_API_TOKEN` (set in Vercel dashboard under Storage → KV)

### Agent Task Lifecycle API

Vic calls these to auto-update the Kanban when spawning/completing agents:

| Route | Method | Body | Returns |
|-------|--------|------|---------|
| `/api/tasks/agent-spawn` | POST | `{ agent, title, description?, priority?, tags? }` | `{ id, title, column }` |
| `/api/tasks/agent-done` | POST | `{ id, summary? }` | `{ id, column }` |

- All three agent POST callbacks (`agent-spawn`, `agent-done`, `/api/notify`) require `DOCK_AGENT_TOKEN` as `Authorization: Bearer` or `x-dock-agent-token`. See `docs/agent-callbacks.md`.
- `agent-spawn` creates task in `"in-progress"` immediately
- `agent-done` moves task to `"in-review"` + appends summary to description
- `PATCH /api/tasks/[id]` supports `{ column }` to move to any column

### Agent Type
- `wallet` renamed → **`baron`** everywhere (type, emoji, label maps, data/tasks.json)
