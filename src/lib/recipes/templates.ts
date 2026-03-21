export interface RecipeTemplate {
  slug: string
  name: string
  description: string
  category: 'Email' | 'Calendar' | 'GitHub' | 'Notion' | 'Productivity'
  requiredIntegrations: string[]
  triggerType: string
  triggerConfig: Record<string, unknown>
  instructions: string
  previewOutput: string
}

export const RECIPE_TEMPLATES: RecipeTemplate[] = [
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
  },
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
  },
  {
    slug: 'pr-review-request',
    name: 'PR Review Request',
    description: 'Notify when you\'re requested for review',
    category: 'GitHub',
    requiredIntegrations: ['github'],
    triggerType: 'github_event',
    triggerConfig: { event_type: 'pr_review_requested' },
    instructions: 'Get the PR details and send me a summary: title, author, description, files changed, and a link to the PR.',
    previewOutput: "🔍 **Review requested**\nPR #42: Fix auth redirect loop\nBy: @teammate\n\n3 files changed (+45, -12)\nFiles: auth.ts, middleware.ts, config.ts\n\nhttps://github.com/org/repo/pull/42",
  },
  {
    slug: 'issue-assigned',
    name: 'Issue Assigned',
    description: 'Notify + create Notion task when assigned',
    category: 'GitHub',
    requiredIntegrations: ['github', 'notion'],
    triggerType: 'github_event',
    triggerConfig: { event_type: 'issue_assigned' },
    instructions: 'When a GitHub issue is assigned to me: 1) Get the issue details. 2) Create a Notion page in my tasks database with the issue title, link, and key details. 3) Notify me with a summary.',
    previewOutput: "📌 **Issue assigned: #87 — API rate limiting**\nRepo: org/backend\nLabels: bug, priority-high\n\n✅ Created Notion task\nhttps://notion.so/task-xyz",
  },
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
  },
  {
    slug: 'weekly-github',
    name: 'Weekly GitHub Digest',
    description: 'Summary of open PRs and issues',
    category: 'GitHub',
    requiredIntegrations: ['github'],
    triggerType: 'schedule',
    triggerConfig: { cron: '0 8 * * 1', timezone: 'UTC' },
    instructions: 'List all my open pull requests and any issues assigned to me across all repos. Group by repo. Include PR review status and issue labels.',
    previewOutput: "📊 **Weekly GitHub Digest**\n\n**org/frontend** (2 PRs, 1 issue)\n- PR #34: Dark mode — ✅ Approved\n- PR #38: Nav refactor — 🔄 Changes requested\n- Issue #41: Mobile layout bug\n\n**org/api** (1 PR)\n- PR #22: Rate limiter — awaiting review",
  },
  {
    slug: 'new-notion-page',
    name: 'New Notion Page',
    description: 'Notify when a page is added to a database',
    category: 'Notion',
    requiredIntegrations: ['notion'],
    triggerType: 'notion_event',
    triggerConfig: { database_id: '', event: 'new_page' },
    instructions: 'Read the new page and send me a brief summary of its title and content.',
    previewOutput: "📝 **New page in Tasks DB**\nTitle: Design system audit\n\nContent preview: Review all components for consistency with new brand guidelines...",
  },
  {
    slug: 'ship-it',
    name: 'Ship It',
    description: 'Review open PRs when user types "ship it"',
    category: 'GitHub',
    requiredIntegrations: ['github'],
    triggerType: 'keyword',
    triggerConfig: { phrase: 'ship it', match_type: 'contains', case_sensitive: false },
    instructions: 'Check for any open PRs that need my review or are ready to merge. List them with status and a quick recommendation (merge, needs work, or needs review).',
    previewOutput: "🚢 **Ship status**\n\n✅ PR #34: Dark mode — approved, ready to merge\n⚠️ PR #38: Nav refactor — 1 unresolved comment\n🔍 PR #22: Rate limiter — no reviews yet\n\nRecommendation: Merge #34, address comment on #38",
  },
  {
    slug: 'overnight-digest',
    name: 'Overnight Digest',
    description: 'Catch-up on emails that arrived overnight',
    category: 'Email',
    requiredIntegrations: ['google'],
    triggerType: 'schedule',
    triggerConfig: { cron: '0 8 * * *', timezone: 'UTC' },
    instructions: 'Summarize all emails received in the last 10 hours. Group by sender importance (direct emails to me vs CC/newsletters). Highlight anything that needs immediate action.',
    previewOutput: "🌅 **Overnight Digest** (8 emails)\n\n⚡ **Needs action:**\n- Boss: Q4 budget due today\n- Client: Contract question\n\n📬 **FYI:**\n- Team: Deploy went smooth\n- HR: Benefits enrollment reminder\n\n📰 **Newsletters:** 4 skipped",
  },
]
