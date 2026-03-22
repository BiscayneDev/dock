export type RecipeCategory =
  | 'Email'
  | 'Calendar'
  | 'Developer'
  | 'Productivity'
  | 'Finance'
  | 'Health'
  | 'Crypto'

export interface RecipeTemplate {
  slug: string
  name: string
  description: string
  category: RecipeCategory
  requiredIntegrations: string[]
  triggerType: string
  triggerConfig: Record<string, unknown>
  instructions: string
  previewOutput: string
  icon: string
}

export const CATEGORY_META: Record<RecipeCategory, { icon: string; description: string }> = {
  Email: { icon: '📧', description: 'Manage your inbox smarter' },
  Calendar: { icon: '📅', description: 'Stay on top of your schedule' },
  Developer: { icon: '🐙', description: 'Automate your dev workflow' },
  Productivity: { icon: '⚡', description: 'Get more done, automatically' },
  Finance: { icon: '💰', description: 'Track and manage finances' },
  Health: { icon: '🏃', description: 'Monitor and improve wellbeing' },
  Crypto: { icon: '🔐', description: 'Manage wallets and transactions' },
}

export const RECIPE_TEMPLATES: RecipeTemplate[] = [
  // --- Productivity ---
  {
    slug: 'daily-briefing',
    name: 'Daily Briefing',
    description: 'Morning summary of emails + calendar',
    category: 'Productivity',
    requiredIntegrations: ['google'],
    triggerType: 'schedule',
    triggerConfig: { cron: '0 9 * * 1-5', timezone: 'UTC' },
    instructions: "Summarize my unread emails from the last 12 hours and list today's calendar events. Format as a concise morning briefing with sections for Email and Calendar.",
    previewOutput: "📧 **Email** (3 unread)\n- Meeting notes from Sarah\n- Invoice from Acme Corp\n- Weekly newsletter\n\n📅 **Calendar**\n- 10:00 AM — Team standup\n- 2:00 PM — Client call with Acme\n- 4:30 PM — 1:1 with manager",
    icon: '☀️',
  },
  {
    slug: 'eod-wrapup',
    name: 'End of Day Wrap-up',
    description: 'What happened today + what\'s tomorrow',
    category: 'Productivity',
    requiredIntegrations: ['google'],
    triggerType: 'schedule',
    triggerConfig: { cron: '0 17 * * 1-5', timezone: 'UTC' },
    instructions: "Summarize what happened today: emails sent/received, meetings attended, and any action items. Then preview tomorrow's calendar.",
    previewOutput: "📋 **Today's Wrap-up**\n- Sent 5 emails, received 12\n- Attended: standup, client call, 1:1\n- Action: Follow up with Acme on proposal\n\n📅 **Tomorrow**\n- 9:00 AM — Sprint planning\n- 11:00 AM — Design review",
    icon: '🌅',
  },
  {
    slug: 'overnight-digest',
    name: 'Overnight Digest',
    description: 'Catch-up on emails that arrived overnight',
    category: 'Productivity',
    requiredIntegrations: ['google'],
    triggerType: 'schedule',
    triggerConfig: { cron: '0 8 * * *', timezone: 'UTC' },
    instructions: 'Summarize all emails received in the last 10 hours. Group by sender importance (direct emails to me vs CC/newsletters). Highlight anything that needs immediate action.',
    previewOutput: "🌅 **Overnight Digest** (8 emails)\n\n⚡ **Needs action:**\n- Boss: Q4 budget due today\n- Client: Contract question\n\n📬 **FYI:**\n- Team: Deploy went smooth\n\n📰 **Newsletters:** 4 skipped",
    icon: '🌙',
  },

  // --- Email ---
  {
    slug: 'vip-email-alert',
    name: 'VIP Email Alert',
    description: 'Instant summary when a specific sender emails',
    category: 'Email',
    requiredIntegrations: ['google'],
    triggerType: 'email_event',
    triggerConfig: { from: '' },
    instructions: 'Read the full email and send me a concise summary including: who sent it, subject, key points, and if any action is needed from me.',
    previewOutput: "📧 **VIP Email from boss@company.com**\nSubject: Q4 Planning\n\nKey points:\n- Budget review moved to Friday\n- Need your department estimates by EOD Thursday\n\n⚡ Action needed: Submit estimates",
    icon: '⭐',
  },
  {
    slug: 'email-auto-label',
    name: 'Smart Email Labeler',
    description: 'Auto-categorize incoming emails',
    category: 'Email',
    requiredIntegrations: ['google'],
    triggerType: 'email_event',
    triggerConfig: {},
    instructions: 'Classify this email into one of these categories: urgent, action-required, fyi, newsletter, receipt. Apply the corresponding Gmail label. If urgent or action-required, notify me.',
    previewOutput: "📧 Labeled 3 emails:\n- \"Q4 Budget\" → urgent\n- \"Team Lunch Poll\" → fyi\n- \"AWS Invoice\" → receipt",
    icon: '🏷️',
  },

  // --- Calendar ---
  {
    slug: 'meeting-prep',
    name: 'Meeting Prep',
    description: 'Pull notes + emails before meetings',
    category: 'Calendar',
    requiredIntegrations: ['google', 'notion'],
    triggerType: 'schedule',
    triggerConfig: { cron: '*/15 * * * *', timezone: 'UTC' },
    instructions: "Check if I have a meeting starting in the next 15 minutes. If so, search my email and Notion for anything related to the meeting topic or attendees. Send me a brief prep summary. If no upcoming meeting, skip this run.",
    previewOutput: "📅 **Meeting in 15 min: Client call with Acme**\n\n📧 Recent emails with Acme:\n- Proposal feedback (yesterday)\n- Contract questions (2 days ago)\n\n📝 Notion notes: Acme project page updated 3 days ago",
    icon: '📋',
  },
  {
    slug: 'schedule-conflicts',
    name: 'Conflict Detector',
    description: 'Alert on double-booked meetings',
    category: 'Calendar',
    requiredIntegrations: ['google'],
    triggerType: 'schedule',
    triggerConfig: { cron: '0 7 * * 1-5', timezone: 'UTC' },
    instructions: "Check today's calendar for any overlapping events. If conflicts exist, list them with times and suggest which to reschedule. If no conflicts, skip.",
    previewOutput: "⚠️ **Double-booked at 2 PM:**\n- Client call (2-3 PM)\n- Team retro (2-2:30 PM)\n\nSuggestion: Move retro to 3:30 PM — you're free then.",
    icon: '⚠️',
  },

  // --- Developer ---
  {
    slug: 'pr-review-request',
    name: 'PR Review Request',
    description: 'Notify when you\'re requested for review',
    category: 'Developer',
    requiredIntegrations: ['github'],
    triggerType: 'github_event',
    triggerConfig: { event_type: 'pr_review_requested' },
    instructions: 'Get the PR details and send me a summary: title, author, description, files changed, and a link to the PR.',
    previewOutput: "🔍 **Review requested**\nPR #42: Fix auth redirect loop\nBy: @teammate\n\n3 files changed (+45, -12)\n\nhttps://github.com/org/repo/pull/42",
    icon: '🔍',
  },
  {
    slug: 'issue-assigned',
    name: 'Issue Assigned',
    description: 'Notify + create Notion task when assigned',
    category: 'Developer',
    requiredIntegrations: ['github', 'notion'],
    triggerType: 'github_event',
    triggerConfig: { event_type: 'issue_assigned' },
    instructions: 'When a GitHub issue is assigned to me: 1) Get the issue details. 2) Create a Notion page in my tasks database with the issue title, link, and key details. 3) Notify me with a summary.',
    previewOutput: "📌 **Issue assigned: #87 — API rate limiting**\nRepo: org/backend\nLabels: bug, priority-high\n\n✅ Created Notion task",
    icon: '📌',
  },
  {
    slug: 'weekly-github',
    name: 'Weekly GitHub Digest',
    description: 'Summary of open PRs and issues',
    category: 'Developer',
    requiredIntegrations: ['github'],
    triggerType: 'schedule',
    triggerConfig: { cron: '0 8 * * 1', timezone: 'UTC' },
    instructions: 'List all my open pull requests and any issues assigned to me across all repos. Group by repo. Include PR review status and issue labels.',
    previewOutput: "📊 **Weekly GitHub Digest**\n\n**org/frontend** (2 PRs, 1 issue)\n- PR #34: Dark mode — ✅ Approved\n- PR #38: Nav refactor — 🔄 Changes requested\n- Issue #41: Mobile layout bug\n\n**org/api** (1 PR)\n- PR #22: Rate limiter — awaiting review",
    icon: '📊',
  },
  {
    slug: 'ship-it',
    name: 'Ship It',
    description: 'Review open PRs when you say "ship it"',
    category: 'Developer',
    requiredIntegrations: ['github'],
    triggerType: 'keyword',
    triggerConfig: { phrase: 'ship it', match_type: 'contains', case_sensitive: false },
    instructions: 'Check for any open PRs that need my review or are ready to merge. List them with status and a quick recommendation (merge, needs work, or needs review).',
    previewOutput: "🚢 **Ship status**\n\n✅ PR #34: Dark mode — approved, ready to merge\n⚠️ PR #38: Nav refactor — 1 unresolved comment\n🔍 PR #22: Rate limiter — no reviews yet",
    icon: '🚢',
  },
  {
    slug: 'deploy-watcher',
    name: 'Deploy Watcher',
    description: 'Track deployment status after merges',
    category: 'Developer',
    requiredIntegrations: ['github'],
    triggerType: 'github_event',
    triggerConfig: { event_type: 'new_notification' },
    instructions: 'When I get a notification about a deployment or CI run, summarize the status: what was deployed, which branch, did it pass or fail, and link to the logs.',
    previewOutput: "🚀 **Deploy: org/frontend**\nBranch: main (merged PR #34)\nStatus: ✅ Passed\nEnvironment: Production\n\nAll checks green.",
    icon: '🚀',
  },

  // --- Notion ---
  {
    slug: 'new-notion-page',
    name: 'New Notion Page',
    description: 'Notify when a page is added to a database',
    category: 'Productivity',
    requiredIntegrations: ['notion'],
    triggerType: 'notion_event',
    triggerConfig: { database_id: '', event: 'new_page' },
    instructions: 'Read the new page and send me a brief summary of its title and content.',
    previewOutput: "📝 **New page in Tasks DB**\nTitle: Design system audit\n\nContent preview: Review all components for consistency with new brand guidelines...",
    icon: '📝',
  },

  // --- Crypto ---
  {
    slug: 'balance-check',
    name: 'Daily Balance Check',
    description: 'Morning summary of wallet balances',
    category: 'Crypto',
    requiredIntegrations: ['openwallet'],
    triggerType: 'schedule',
    triggerConfig: { cron: '0 9 * * *', timezone: 'UTC' },
    instructions: 'List all my wallets and their balances across all chains. Flag any significant changes (>5%) from yesterday if possible.',
    previewOutput: "🔐 **Wallet Balances**\n\nMain Wallet:\n- ETH: 2.45 ($4,900)\n- USDC: 1,200\n\nSolana Wallet:\n- SOL: 15.2 ($2,280)",
    icon: '💰',
  },
  {
    slug: 'whale-alert',
    name: 'Large Transaction Alert',
    description: 'Notify on transactions above a threshold',
    category: 'Crypto',
    requiredIntegrations: ['openwallet'],
    triggerType: 'schedule',
    triggerConfig: { cron: '*/30 * * * *', timezone: 'UTC' },
    instructions: 'Check my recent wallet activity. If any transaction exceeds $500 in value, notify me immediately with details: amount, direction (in/out), counterparty address, and chain.',
    previewOutput: "🐋 **Large Transaction Detected**\n\nReceived 1.5 ETH ($3,000)\nFrom: 0x742d...4f2e\nChain: Ethereum Mainnet\nTime: 5 minutes ago",
    icon: '🐋',
  },
  // Health
  {
    slug: 'morning-health-briefing',
    name: 'Morning Health Briefing',
    description: 'Sleep score, recovery, and calendar in one morning message',
    category: 'Health',
    requiredIntegrations: ['oura'],
    triggerType: 'schedule',
    triggerConfig: { cron: '0 7 * * *', timezone: 'UTC' },
    instructions: "Get my health summary for today (sleep from last night, readiness score, activity). Then check my calendar for today. Combine it all into a concise morning briefing. If my readiness is below 60, suggest taking it easy. If I have early meetings and slept poorly, flag that.",
    previewOutput: "☀️ **Morning Health Briefing**\n\n😴 Sleep: 7h 12m (score: 82)\n- Deep: 1h 45m · REM: 2h 10m\n- HRV: 45ms · Efficiency: 91%\n\n💪 Readiness: 74 (good)\n\n📅 Today: 3 meetings\n- 9:00 AM: Team standup\n- 11:00 AM: Design review\n- 2:00 PM: 1:1 with Sarah",
    icon: '☀️',
  },
  {
    slug: 'low-recovery-alert',
    name: 'Low Recovery Alert',
    description: 'Get notified when your body needs rest',
    category: 'Health',
    requiredIntegrations: ['oura'],
    triggerType: 'schedule',
    triggerConfig: { cron: '0 7 * * *', timezone: 'UTC' },
    instructions: "Check my readiness/recovery score. If it's below 60, send me a message with the score and the contributing factors (poor sleep, high strain, etc). Suggest what to do: lighter workout, earlier bedtime, etc. If the score is above 60, don't send anything.",
    previewOutput: "⚠️ **Low Recovery Alert**\n\nReadiness: 42 (take it easy)\n\n📉 Contributing factors:\n- Sleep: 5h 20m (below average)\n- HRV: 28ms (low)\n- Temperature: +0.8°C above baseline\n\n💡 Suggestion: Skip the intense workout today. Light walk or stretching instead. Aim for bed by 10 PM.",
    icon: '⚠️',
  },
  {
    slug: 'weekly-sleep-report',
    name: 'Weekly Sleep Report',
    description: 'Weekly summary of sleep quality and trends',
    category: 'Health',
    requiredIntegrations: ['oura'],
    triggerType: 'schedule',
    triggerConfig: { cron: '0 9 * * 0', timezone: 'UTC' },
    instructions: "Get my sleep data for the last 7 days. Calculate averages for: total sleep time, sleep score, deep sleep, REM sleep, HRV, and efficiency. Note the best and worst nights. Identify any trends (improving or declining). Keep it concise and actionable.",
    previewOutput: "📊 **Weekly Sleep Report**\n\n7-day averages:\n- Duration: 7h 05m · Score: 78\n- Deep: 1h 32m · REM: 1h 55m\n- HRV: 42ms · Efficiency: 88%\n\n🏆 Best night: Tuesday (score: 91)\n😴 Worst night: Friday (score: 58)\n\n📈 Trend: HRV improving (+5ms vs last week)",
    icon: '📊',
  },
]
