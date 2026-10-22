/**
 * Agent team templates — preset configurations for common use cases.
 * Users pick a template during setup, then customize as needed.
 */

export interface AgentTemplate {
  id: string
  name: string
  emoji: string
  role: string
  accent: string
  description: string
  tags: string[]
  budget: number
  isChief?: boolean
}

export interface TeamTemplate {
  id: string
  name: string
  description: string
  icon: string
  agents: AgentTemplate[]
}

export const TEAM_TEMPLATES: TeamTemplate[] = [
  {
    id: "startup",
    name: "Startup Team",
    description: "Research, build, sell, manage money — the full founding team",
    icon: "🚀",
    agents: [
      { id: "chief", name: "Chief", emoji: "🤖", role: "Chief of Staff", accent: "#7c3aed", description: "Coordinates everything. Delegates tasks, keeps memory sharp, makes sure nothing falls through.", tags: ["Orchestration", "Memory", "Execution"], budget: 50, isChief: true },
      { id: "researcher", name: "Scout", emoji: "🔭", role: "Researcher", accent: "#06b6d4", description: "Monitors the web for market signals, competitor moves, and emerging trends.", tags: ["Research", "Analysis", "Signals"], budget: 30 },
      { id: "engineer", name: "Builder", emoji: "⚡", role: "Engineer", accent: "#10b981", description: "Ships code. Builds and maintains projects, automates workflows.", tags: ["Code", "Automation", "DevOps"], budget: 100 },
      { id: "deal-flow", name: "Deal Flow", emoji: "🤝", role: "Business Dev", accent: "#f59e0b", description: "Tracks partnerships, opportunities, and strategic moves.", tags: ["Partnerships", "Outreach", "Strategy"], budget: 20 },
      { id: "treasurer", name: "Treasurer", emoji: "🏦", role: "Finance", accent: "#ec4899", description: "Manages budgets, tracks spending, and handles financial operations.", tags: ["Finance", "Budgets", "Reporting"], budget: 20 },
    ],
  },
  {
    id: "dev-team",
    name: "Dev Team",
    description: "Ship code faster — engineering, QA, DevOps, and docs",
    icon: "💻",
    agents: [
      { id: "chief", name: "Lead", emoji: "🎯", role: "Tech Lead", accent: "#7c3aed", description: "Prioritizes work, reviews PRs, keeps the team on track.", tags: ["Planning", "Code Review", "Architecture"], budget: 50, isChief: true },
      { id: "frontend", name: "Frontend", emoji: "🎨", role: "Frontend Dev", accent: "#06b6d4", description: "Builds user interfaces, components, and design systems.", tags: ["React", "CSS", "UI/UX"], budget: 80 },
      { id: "backend", name: "Backend", emoji: "⚙️", role: "Backend Dev", accent: "#10b981", description: "APIs, databases, infrastructure, and server-side logic.", tags: ["APIs", "Database", "Infrastructure"], budget: 80 },
      { id: "qa", name: "QA", emoji: "🧪", role: "QA Engineer", accent: "#f59e0b", description: "Writes tests, catches bugs, ensures quality before deploy.", tags: ["Testing", "Bugs", "Quality"], budget: 30 },
      { id: "devops", name: "DevOps", emoji: "🔧", role: "DevOps", accent: "#ec4899", description: "CI/CD pipelines, deployments, monitoring, and infrastructure.", tags: ["CI/CD", "Docker", "Monitoring"], budget: 30 },
    ],
  },
  {
    id: "research",
    name: "Research Lab",
    description: "Deep research, analysis, and knowledge synthesis",
    icon: "🔬",
    agents: [
      { id: "chief", name: "Director", emoji: "🧠", role: "Research Director", accent: "#7c3aed", description: "Guides research direction, synthesizes findings, identifies gaps.", tags: ["Strategy", "Synthesis", "Planning"], budget: 50, isChief: true },
      { id: "analyst", name: "Analyst", emoji: "📊", role: "Data Analyst", accent: "#06b6d4", description: "Collects data, runs analyses, creates visualizations and reports.", tags: ["Data", "Analysis", "Charts"], budget: 40 },
      { id: "scout", name: "Scout", emoji: "🔭", role: "Field Researcher", accent: "#10b981", description: "Monitors sources, tracks trends, surfaces emerging signals.", tags: ["Monitoring", "Trends", "Signals"], budget: 40 },
      { id: "writer", name: "Writer", emoji: "✍️", role: "Technical Writer", accent: "#f59e0b", description: "Writes reports, documentation, and research summaries.", tags: ["Writing", "Docs", "Reports"], budget: 30 },
    ],
  },
  {
    id: "content",
    name: "Content Studio",
    description: "Create, edit, publish, and promote content",
    icon: "📝",
    agents: [
      { id: "chief", name: "Editor", emoji: "📋", role: "Editor in Chief", accent: "#7c3aed", description: "Plans content calendar, assigns topics, maintains quality standards.", tags: ["Planning", "Editorial", "Quality"], budget: 40, isChief: true },
      { id: "writer", name: "Writer", emoji: "✍️", role: "Content Writer", accent: "#06b6d4", description: "Writes blog posts, articles, social copy, and newsletters.", tags: ["Writing", "Blog", "Social"], budget: 60 },
      { id: "designer", name: "Designer", emoji: "🎨", role: "Creative", accent: "#10b981", description: "Creates visuals, graphics, and design assets for content.", tags: ["Design", "Graphics", "Brand"], budget: 40 },
      { id: "seo", name: "SEO", emoji: "📈", role: "Growth", accent: "#f59e0b", description: "Keyword research, SEO optimization, analytics, and distribution.", tags: ["SEO", "Analytics", "Growth"], budget: 30 },
    ],
  },
  {
    id: "custom",
    name: "Start from Scratch",
    description: "Just a chief of staff — add your own agents later",
    icon: "✨",
    agents: [
      { id: "chief", name: "Chief", emoji: "🤖", role: "Chief of Staff", accent: "#7c3aed", description: "Your AI assistant. Coordinates tasks and helps you get started.", tags: ["Orchestration", "General"], budget: 50, isChief: true },
    ],
  },
]
