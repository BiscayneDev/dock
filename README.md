<div align="center">

<img src="https://img.shields.io/npm/v/create-shipyard-app?style=flat-square&color=22c55e&label=npm" alt="npm version" />
<img src="https://img.shields.io/github/stars/BiscayneDev/dock?style=social" alt="GitHub stars" />

# ⚓ Dock

### The open-source operating system for AI agent teams.

Five surfaces, one brief: decisions land in the **Inbox**, the work lives in **Work**, the crew is managed in **Agents**, memory and skills live in **Knowledge**, and plumbing sits in **Settings**.

[Get Started](#-quickstart) · [Surfaces](#-surfaces) · [Features](#-features) · [Roadmap](#-roadmap)

<br>

<img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=nextdotjs" />
<img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white" />
<img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square" />
<img src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" />

</div>

<br>

## The Problem

You're running a company with AI agents — research, engineering, deals, treasury. But right now you're juggling:

| Without Dock | With Dock |
|:---|:---|
| Scattered agent outputs across Telegram, Slack, email | One inbox queue, all decisions, all activity |
| No idea what your agents are working on | Kanban board that updates in real time |
| Manually kicking off agent tasks | Drag to "In Progress" → agent activates |
| No cost visibility until the bill arrives | Per-agent budgets with approval gates |
| Copy-pasting context between tools | Agents share memory, goals, and workspace |

<br>

## 🗺 Surfaces

The IA collapsed ~24 top-level pages into five. Routes never got deleted — bookmarks and deep links keep working; only navigation changed.

| Surface | Route | What it holds |
|:---|:---|:---|
| **Inbox** | `/inbox` | Everything waiting on a human: approvals, questions, blockers, alerts |
| **Work** | `/work` | Today's brief, Missions board, runs, projects health, intel, calendar, company goals |
| **Agents** | `/agents` | Roster, skills, per-agent knowledge and budgets |
| **Knowledge** | `/knowledge` | Memory, skills library, research docs |
| **Settings** | `/settings` | Devices, connectors, billing, schedules, notifications |

Mobile bottom nav carries four: Inbox, Work, Agents, Settings. The "Launch a venture" button stays in the rail.

Out of the nav but not deleted: `/conversations`, `/messages`, `/alerts`, `/activity`, `/costs`, `/treasury`, `/projects`, `/intel`, `/calendar`, `/docs`, `/memory`, `/schedules`, `/shipwright`, `/setup`, `/onboarding`. Every one is reachable in at most two clicks from Work or Settings, from the ⌘P command palette, or by its old URL.

<br>

## ✨ Features

### 🗂 Missions Board
Drag a task to "In Progress" and your agent picks it up. When it's done, the task moves to "Done" automatically. Budget checks and approval gates built in.

### 🤖 Agent Team Management
A named Chief of Staff plus specialist agents (research, engineering, partnerships, treasury). Add your own with custom roles, skills, and accent colors. The Chief of Staff's display name is resolved from the workspace roster — no name is assumed in code.

### 📊 Work Brief
One glance: agent status, task summary, project health, intel, calendar, and the decisions waiting on you.

### 💰 Budget Enforcement
Set monthly spend limits per agent. Dock checks budgets before activation and warns you when agents approach their limits. No surprise bills.

### 🏦 Treasury & Billing
Wallets across Solana, Ethereum, Base, and Polygon, with Paybox x402 connect for non-custodial signing. Token usage and spend live under Costs.

### ◈ GitHub Projects
CI status, open PRs, and deploy health for your pinned repos. Color-coded badges update automatically.

### 🔭 Intel Feed
Market intelligence reports from your Scout agent. Deploy research runs from the command palette.

### 📅 Calendar
Google Calendar events surfaced on the Work brief and on their own feed.

### 🧠 Knowledge
Memory files, daily notes, installed Agent Skills, and research docs — one surface, transparent.

### 💬 Conversations
Persistent threads per task, with run traces underneath. Sessions swap; conversations do not.

### 📱 Mobile Ready
Responsive design with a four-item bottom nav. Manage your agent team from your phone.

<br>

## 🚀 Quickstart

```bash
git clone https://github.com/BiscayneDev/dock.git
cd dock
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000) — the setup wizard walks you through connecting your agents.

A scaffolder CLI (`create-shipyard-app`) is also shipped in [`cli/`](./cli) for spawning a project directory from a template; `npx create-shipyard-app` only works once that package is published to npm.

### With Ollama (local models):

```bash
git clone https://github.com/BiscayneDev/dock.git
cd dock
npm install
npm run dev
```

In the setup wizard, choose **"Ollama / Local Models"** and point it at your running Ollama instance. Works with LM Studio and llama.cpp too — anything that speaks the Ollama API.

### Demo mode

Don't have agents set up yet? Click **"Skip — explore without agents"** in the setup wizard to get a feel for the surfaces with sample data.

### Deploying

This repo deploys itself: **push to `main` → Vercel builds and ships to production automatically** (CI runs `npm run build` on every push and PR first). No deploy commands, no manual steps — if the build passes, it's live.

To deploy your own instance: import the repo into Vercel, add the env vars from [`.env.example`](./.env.example), and connect a Vercel KV store for durable tasks/conversations in production. Serverless-safe routes gracefully degrade when local CLIs (OpenClaw, gh, gog) aren't available.

<br>

## 🏗 How It Works

```
┌─────────────────────────────────────────────────────────┐
│                       DOCK                             │
│                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │ Backlog  │───▶│In Progress│───▶│   Done   │          │
│  │          │    │          │    │          │          │
│  │ • Research│    │ 🔭 Scout │    │ ✅ Report │          │
│  │ • Build  │    │  running  │    │  ready   │          │
│  │ • Deploy │    │          │    │          │          │
│  └──────────┘    └────┬─────┘    └──────────┘          │
│                       │                                  │
│              ┌────────▼────────┐                        │
│              │  Budget Check   │                        │
│              │  Approval Gate  │                        │
│              └────────┬────────┘                        │
│                       │                                  │
│              ┌────────▼────────┐                        │
│              │  Agent Runtime  │                        │
│              │ OpenClaw/Ollama │                        │
│              └─────────────────┘                        │
└─────────────────────────────────────────────────────────┘
```

1. **You drag a task** to "In Progress"
2. **Budget check** runs — does this agent have spend remaining?
3. **Approval gate** shows you the cost estimate — confirm or cancel
4. **Agent activates** via the runtime
5. **Task auto-moves** to "Done" when the agent finishes
6. **Toast notification** fires — activity logged to the feed

No polling. No manual follow-up. The board is the source of truth.

<br>

## 🧱 Stack

| Layer | Technology |
|:------|:-----------|
| Framework | Next.js (App Router) |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS 4 |
| Drag & Drop | @hello-pangea/dnd |
| Agent Runtime | OpenClaw, Ollama, Shipyard Inference, or custom |
| Storage | Postgres/Supabase + RLS (prod), local JSON (dev) |
| AI SDK | Vercel AI SDK + Anthropic |
| Icons | Lucide React |
| Deploy | Vercel |

<br>

## 🤖 Agents

Agents come from team templates chosen at setup (`lib/agent-templates.ts`), then live in the workspace roster. Each has an emoji, role, accent color, budget, and optional skill set.

| Role | Typical agent |
|:------|:-----|
| Chief of Staff | Orchestrates the team, delegates tasks; the display name is whatever the user chose at setup |
| Research | Market intelligence, signals, web research |
| Engineering | Shipping code, CI/CD, automation |
| Business Development | Partnerships, opportunities, outreach |
| Finance | Treasury, wallet ops, financial tracking |

Agents are fully customizable — change names, roles, skills, and colors from the Agents page. Nothing in the codebase hardcodes a default chief's name.

<br>

## 📁 Project Structure

```
dock/
├── app/
│   ├── work/            # Work surface — brief, board, rails, feeds
│   ├── inbox/           # Inbox surface (approvals, decisions)
│   ├── knowledge/       # Knowledge surface (memory, skills, docs)
│   ├── tasks/           # Missions board (also embedded in Work)
│   ├── dashboard/       # → redirects to /work
│   ├── treasury/        # Wallets, balances, Paybox
│   ├── projects/        # GitHub repos + CI status
│   ├── intel/           # Scout research reports
│   ├── calendar/        # Google Calendar integration
│   ├── agents/          # Agent team management
│   ├── settings/        # Config, billing, connections
│   ├── setup/           # First-run onboarding wizard
│   └── api/             # Route handlers
├── components/
│   ├── Sidebar.tsx      # Five-surface desktop rail + mobile bottom nav
│   └── CommandPalette.tsx
├── lib/                 # Pure modules + data access
├── db/migrations/       # Supabase schema
└── data/                # Local JSON stores (dev)
```

<br>

## 🗺 Roadmap

- [x] Kanban drag-to-activate with budget gates
- [x] Agent team management (CRUD)
- [x] Setup wizard with demo mode
- [x] Post-setup health checks
- [x] Budget enforcement + approval modals
- [x] Gmail inbox integration
- [x] Google Calendar integration
- [x] **Agent runtime abstraction** — plug in OpenClaw, Ollama, or custom runtimes
- [x] **Five-surface IA** — Inbox, Work, Agents, Knowledge, Settings
- [ ] **Knowledge loop** — flag → curator → approved, portable markdown
- [ ] **Event listeners** — condition triggers instead of cron-only wakes
- [ ] **Per-run scoped credentials** — deny-by-default, task-scoped tokens
- [ ] **Run economics** — cache-hit rate, coordination tax, liveness expiry
- [ ] **Agent marketplace** — share and install agent identities
- [ ] **Docker image** — `docker run -p 3000:3000 dock`
- [ ] **Native mobile app**

See [docs/plans/2026-11-24-dock-agent-platform-transformation.md](./docs/plans/2026-11-24-dock-agent-platform-transformation.md) for the full plan.

<br>

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
git clone https://github.com/BiscayneDev/dock.git
cd dock
npm install
npm run dev
```

<br>

## ❓ FAQ

<details>
<summary><strong>Do I need OpenClaw to use this?</strong></summary>
<br>
No! Dock supports multiple runtimes: OpenClaw for full agent orchestration, Ollama/LM Studio/llama.cpp for local models, Shipyard Inference for cost-routed provider failover, or demo mode to explore without any runtime.
</details>

<details>
<summary><strong>Is this just a dashboard?</strong></summary>
<br>
No — it's an operating system. When you drag a task to "In Progress", it actually fires an agent. Budget gates prevent runaway costs. The board reflects what your agents are doing in real time.
</details>

<details>
<summary><strong>Can I use my own agents instead of the defaults?</strong></summary>
<br>
Yes. Pick a team template at setup, then add, edit, or delete agents from the Agents page. Roles, skills, budgets, and personalities are all customizable.
</details>

<details>
<summary><strong>What about costs?</strong></summary>
<br>
Dock tracks token usage and enforces monthly per-agent budgets. Activation is blocked when a limit is reached. No surprise bills.
</details>

<details>
<summary><strong>Can I self-host this?</strong></summary>
<br>
Yes. It's a standard Next.js app. Run it locally, deploy to Vercel, or host anywhere that supports Node.js. The schema is plain Postgres with row-level security.
</details>

<br>

## 📄 License

[MIT](LICENSE) — use it, fork it, ship it.

<br>

## Built by

[Halsey Huth](https://twitter.com/halseyh) — building in public.

<br>

<div align="center">

**If Dock helps you run your agent team, [give it a ⭐](https://github.com/BiscayneDev/dock)**

</div>
