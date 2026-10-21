<div align="center">

<img src="https://img.shields.io/npm/v/create-shipyard-app?style=flat-square&color=22c55e&label=npm" alt="npm version" />
<img src="https://img.shields.io/github/stars/BiscayneDev/dock?style=social" alt="GitHub stars" />

# ⚓ Dock

### The open-source operating system for AI agent teams.

Drag a task → your agents execute → the board reflects reality.

[Get Started](#-quickstart) · [Features](#-features) · [Demo](https://dock.vercel.app) · [Roadmap](#-roadmap)

<br />

<img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=nextdotjs" />
<img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white" />
<img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=white" />
<img src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" />

</div>

<br />

## The Problem

You're running a company with AI agents — research, engineering, deals, treasury. But right now you're juggling:

| Without Dock | With Dock |
|:---|:---|
| Scattered agent outputs across Telegram, Slack, email | One dashboard, all agents, all activity |
| No idea what your agents are working on | Kanban board that updates in real time |
| Manually kicking off agent tasks | Drag to "In Progress" → agent activates |
| No cost visibility until the bill arrives | Per-agent budgets with approval gates |
| Copy-pasting context between tools | Agents share memory, goals, and workspace |

<br />

## ✨ Features

### 🗂 Kanban Task Board
Drag a task to "In Progress" and your agent picks it up. When it's done, the task moves to "Done" automatically. Budget checks and approval gates built in.

### 🤖 Agent Team Management
Five specialized agents out of the box — Chief of Staff, Scout (research), Builder (engineering), Deal Flow (partnerships), Baron (treasury). Add your own with custom roles, skills, and accent colors.

### 📊 Dashboard Command Center
Morning briefing in one glance: agent status (live pulsing dots), task summary, project health, recent intel, inbox, and goals — all on one screen.

### 💰 Budget Enforcement
Set monthly spend limits per agent. Dock checks budgets before activation and warns you when agents approach their limits. No surprise bills.

### 📂 GitHub Projects
CI status, open PRs, and deploy health for your pinned repos. Color-coded badges update automatically.

### 🔭 Intel Feed
Market intelligence reports from your Scout agent. Deploy research runs from the dashboard.

### 📅 Calendar & Inbox
Google Calendar events and important emails surfaced automatically. No more tab-switching.

### 🧠 Agent Memory
Browse your agents' memory files, daily notes, and long-term context. Everything is transparent.

### 💬 Agent Chat
Talk directly to your agents from the dashboard. Ask questions, give instructions, get status updates.

### 📱 Mobile Ready
Responsive design with bottom navigation. Manage your agent team from your phone.

<br />

## 🚀 Quickstart

### One command:

```bash
npx create-shipyard-app
```

This will:
1. Clone the repo
2. Install dependencies
3. Launch the setup wizard
4. Open your browser

### Or manually:

```bash
git clone https://github.com/BiscayneDev/dock.git
cd dock
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000) — the setup wizard walks you through connecting your agents.

### With Ollama (local models):

```bash
git clone https://github.com/BiscayneDev/dock.git
cd dock
npm install
npm run dev
```

In the setup wizard, choose **"Ollama / Local Models"** and point it at your running Ollama instance. Works with LM Studio and llama.cpp too — anything that speaks the Ollama API.

### Demo mode

Don't have agents set up yet? No problem. Click **"Skip — explore without agents"** in the setup wizard to get a feel for the dashboard with sample data.

### Deploying

This repo deploys itself: **push to `main` → Vercel builds and ships to production automatically** (CI runs typecheck + build on every PR first). No deploy commands, no manual steps — if the build passes, it's live.

To deploy your own instance: import the repo into Vercel, add the env vars from [`.env.example`](./.env.example), and connect a Vercel KV store for durable tasks/conversations in production. Serverless-safe routes gracefully degrade when local CLIs (OpenClaw, gh, gog) aren't available.

<br />

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
4. **Agent activates** via OpenClaw gateway
5. **Task auto-moves** to "Done" when the agent finishes
6. **Toast notification** fires — activity logged to the feed

No polling. No manual follow-up. The board is the source of truth.

<br />

## 🧱 Stack

| Layer | Technology |
|:------|:-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS 4 |
| Drag & Drop | @hello-pangea/dnd |
| Agent Runtime | OpenClaw, Ollama, or custom |
| Storage | Vercel KV (prod) / local JSON (dev) |
| AI SDK | Vercel AI SDK + Anthropic |
| Icons | Lucide React |
| Deploy | Vercel |

<br />

## 🤖 Default Agent Team

| Agent | Role | Color |
|:------|:-----|:------|
| 🦞 **Vic** (Chief of Staff) | Orchestrates the team, delegates tasks | Purple |
| 🔭 **Scout** | Market intelligence, research, signals | Cyan |
| ⚡ **Builder** | Engineering, shipping code, CI/CD | Emerald |
| 🤝 **Deal Flow** | Partnerships, opportunities, outreach | Amber |
| 🏦 **Baron** | Treasury, wallet ops, financial tracking | Pink |

Agents are fully customizable — change names, roles, skills, and colors from the Agents page.

<br />

## 📁 Project Structure

```
dock/
├── app/
│   ├── dashboard/      # Command center overview
│   ├── tasks/          # Kanban board with drag-to-activate
│   ├── agents/         # Agent team management
│   ├── projects/       # GitHub repos + CI status
│   ├── intel/          # Scout research reports
│   ├── calendar/       # Google Calendar integration
│   ├── chat/           # Direct agent chat
│   ├── settings/       # Config + reset wizard
│   ├── setup/          # First-run onboarding wizard
│   └── api/            # 15+ API routes
├── components/
│   └── Sidebar.tsx     # Desktop sidebar + mobile bottom nav
├── lib/
│   └── config.ts       # Runtime configuration
├── data/
│   ├── tasks.json      # Local task store
│   ├── agents.json     # Agent definitions
│   └── goals.json      # Goal tracker
└── public/
```

<br />

## 🗺 Roadmap

- [x] Kanban drag-to-activate with budget gates
- [x] Agent team management (CRUD)
- [x] Setup wizard with demo mode
- [x] Post-setup health checks
- [x] Budget enforcement + approval modals
- [x] Gmail inbox integration
- [x] Google Calendar integration
- [x] **Agent runtime abstraction** — plug in OpenClaw, Ollama, or custom runtimes
- [ ] **Agent marketplace** — share and install agent identities
- [ ] **`Cmd+K` command palette** — quick actions from anywhere
- [ ] **Webhooks** — real-time updates instead of polling
- [ ] **Docker image** — `docker run -p 3000:3000 dock`
- [ ] **Multi-workspace** — manage multiple agent teams
- [ ] **Mobile app** — native iOS/Android companion

<br />

## 🤝 Contributing

We'd love your help making Dock better. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Fork the repo, then:
git clone https://github.com/YOUR_USERNAME/dock.git
cd dock
npm install
npm run dev
```

<br />

## ❓ FAQ

<details>
<summary><strong>Do I need OpenClaw to use this?</strong></summary>
<br />
No! Dock supports multiple runtimes: OpenClaw for full agent orchestration, Ollama/LM Studio/llama.cpp for local models, or demo mode to explore without any runtime.
</details>

<details>
<summary><strong>Is this just a dashboard?</strong></summary>
<br />
No — it's an operating system. When you drag a task to "In Progress", it actually fires an agent. Budget gates prevent runaway costs. The board reflects what your agents are doing in real time.
</details>

<details>
<summary><strong>Can I use my own agents instead of the defaults?</strong></summary>
<br />
Yes. Add, edit, or delete agents from the Agents page. Each agent is a markdown identity file in your workspace — fully customizable roles, skills, and personalities.
</details>

<details>
<summary><strong>What about costs?</strong></summary>
<br />
Dock tracks per-agent token usage via the Anthropic Admin API. Set monthly budgets per agent, and the system will block activation when limits are reached. No surprise bills.
</details>

<details>
<summary><strong>Can I self-host this?</strong></summary>
<br />
Yes. It's a standard Next.js app. Run it locally, deploy to Vercel, or host anywhere that supports Node.js. Task storage uses local JSON in dev and Vercel KV in production.
</details>

<br />

## 📄 License

[MIT](LICENSE) — use it, fork it, ship it.

<br />

## Built by

[Halsey Huth](https://twitter.com/halseyh) — building in public.

Powered by [OpenClaw](https://openclaw.ai).

<br />

<div align="center">

**If Dock helps you run your agent team, [give it a ⭐](https://github.com/BiscayneDev/dock)**

</div>
