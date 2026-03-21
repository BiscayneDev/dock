import { z } from 'zod'
import { integrationTools } from '@/lib/tools/index'
import type { UserContext } from '@/lib/llm/types'

export interface TriggerMatch {
  externalId: string
  context: Record<string, unknown>
}

const EmailTriggerConfig = z.object({
  from: z.string().optional(),
  subject_contains: z.string().optional(),
  label: z.string().optional(),
  has_attachment: z.boolean().optional(),
})

const GithubTriggerConfig = z.object({
  event_type: z.enum(['issue_assigned', 'pr_review_requested', 'new_notification', 'issue_opened']),
  repo: z.string().optional(),
  label: z.string().optional(),
})

const NotionTriggerConfig = z.object({
  database_id: z.string(),
  event: z.enum(['new_page', 'page_updated']),
  property_filter: z.object({
    property: z.string(),
    value: z.string(),
  }).optional(),
})

interface RecipeForTrigger {
  id: string
  user_id: string
  trigger_type: string
  trigger_config: unknown
  last_checked_at: string | null
}

export async function checkTrigger(
  recipe: RecipeForTrigger,
  ctx: UserContext
): Promise<TriggerMatch[]> {
  switch (recipe.trigger_type) {
    case 'email_event':
      return checkEmailTrigger(recipe, ctx)
    case 'github_event':
      return checkGithubTrigger(recipe, ctx)
    case 'notion_event':
      return checkNotionTrigger(recipe, ctx)
    default:
      return []
  }
}

async function checkEmailTrigger(
  recipe: RecipeForTrigger,
  ctx: UserContext
): Promise<TriggerMatch[]> {
  const config = EmailTriggerConfig.parse(recipe.trigger_config)
  const gmailSearch = integrationTools.find((t) => t.name === 'gmail_search')
  if (!gmailSearch) return []

  // Build search query
  const queryParts: string[] = []
  if (config.from) queryParts.push(`from:${config.from}`)
  if (config.subject_contains) queryParts.push(`subject:${config.subject_contains}`)
  if (config.label) queryParts.push(`label:${config.label}`)
  if (config.has_attachment) queryParts.push('has:attachment')

  // Only check since last checked
  if (recipe.last_checked_at) {
    const epoch = Math.floor(new Date(recipe.last_checked_at).getTime() / 1000)
    queryParts.push(`after:${epoch}`)
  }

  const result = await gmailSearch.execute(
    { query: queryParts.join(' '), maxResults: 10 },
    ctx
  )

  if (!result.success || !result.data) return []

  const data = result.data as { messages?: Array<{ id: string; from: string; subject: string; snippet: string; date: string }> }
  const messages = data.messages ?? []

  return messages.map((email) => ({
    externalId: email.id,
    context: {
      email: {
        id: email.id,
        from: email.from,
        subject: email.subject,
        body: email.snippet?.slice(0, 2000) ?? '',
        received_at: email.date,
      },
    },
  }))
}

async function checkGithubTrigger(
  recipe: RecipeForTrigger,
  ctx: UserContext
): Promise<TriggerMatch[]> {
  const config = GithubTriggerConfig.parse(recipe.trigger_config)
  const listNotifications = integrationTools.find((t) => t.name === 'github_list_notifications')
  if (!listNotifications) return []

  const since = recipe.last_checked_at ?? new Date(Date.now() - 5 * 60 * 1000).toISOString()

  const result = await listNotifications.execute({ since, all: false }, ctx)
  if (!result.success || !result.data) return []

  const data = result.data as { notifications?: Array<{
    id: string; repo: string; type: string; title: string;
    reason: string; url: string; updatedAt: string
  }> }
  const notifications = data.notifications ?? []

  const reasonMap: Record<string, string> = {
    'issue_assigned': 'assign',
    'pr_review_requested': 'review_requested',
    'new_notification': '',
    'issue_opened': '',
  }

  const typeMap: Record<string, string> = {
    'issue_assigned': 'Issue',
    'pr_review_requested': 'PullRequest',
    'issue_opened': 'Issue',
  }

  return notifications
    .filter((n) => {
      const expectedReason = reasonMap[config.event_type]
      const expectedType = typeMap[config.event_type]

      if (expectedReason && n.reason !== expectedReason) return false
      if (expectedType && n.type !== expectedType) return false
      if (config.repo && n.repo !== config.repo) return false

      return true
    })
    .map((n) => ({
      externalId: n.id,
      context: {
        notification: {
          id: n.id,
          repo: n.repo,
          type: n.type,
          title: n.title,
          reason: n.reason,
          url: n.url,
          updated_at: n.updatedAt,
        },
      },
    }))
}

async function checkNotionTrigger(
  recipe: RecipeForTrigger,
  ctx: UserContext
): Promise<TriggerMatch[]> {
  const config = NotionTriggerConfig.parse(recipe.trigger_config)
  const queryDb = integrationTools.find((t) => t.name === 'notion_query_database')
  if (!queryDb) return []

  const since = recipe.last_checked_at ?? new Date(Date.now() - 5 * 60 * 1000).toISOString()

  const timestampField = config.event === 'new_page' ? 'created_time' : 'last_edited_time'

  const filter = {
    timestamp: timestampField,
    [timestampField]: { after: since },
  }

  const result = await queryDb.execute(
    { databaseId: config.database_id, filter, pageSize: 10 },
    ctx
  )

  if (!result.success || !result.data) return []

  const data = result.data as { results?: Array<{ id: string; title: string; url: string; lastEdited: string }> }
  const pages = data.results ?? []

  return pages.map((page) => ({
    externalId: page.id,
    context: {
      page: {
        id: page.id,
        title: page.title,
        url: page.url,
        timestamp: page.lastEdited,
      },
    },
  }))
}

// --- Keyword trigger check (synchronous in webhook) ---

export interface KeywordTriggerConfig {
  phrase: string
  match_type: 'exact' | 'contains' | 'starts_with'
  case_sensitive: boolean
}

export function matchesKeywordTrigger(
  message: string,
  config: KeywordTriggerConfig
): boolean {
  const msg = config.case_sensitive ? message : message.toLowerCase()
  const phrase = config.case_sensitive ? config.phrase : config.phrase.toLowerCase()

  switch (config.match_type) {
    case 'exact':
      return msg === phrase
    case 'contains':
      return msg.includes(phrase)
    case 'starts_with':
      return msg.startsWith(phrase)
    default:
      return false
  }
}
