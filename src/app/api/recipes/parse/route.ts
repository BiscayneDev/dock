import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { getLLMProvider } from '@/lib/llm/index'

const ParseBody = z.object({
  description: z.string().min(5),
  integrations: z.array(z.string()).optional(),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = ParseBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Describe what you want the recipe to do' }, { status: 400 })
  }

  const llm = getLLMProvider()

  const integrationContext = parsed.data.integrations?.length
    ? `\nAvailable integrations: ${parsed.data.integrations.join(', ')}`
    : ''

  const response = await llm.chat({
    system: `You parse natural language recipe descriptions into structured recipe configurations for an AI assistant called Dock.

Given a user's description, extract:
1. name - short descriptive name (2-5 words)
2. trigger_type - one of: schedule, email_event, github_event, notion_event, keyword, manual
3. trigger_config - the configuration object for that trigger type
4. instructions - clear instructions for the AI agent to execute
5. category - one of: Email, Calendar, Developer, Productivity, Finance, Health, Crypto

Trigger config formats:
- schedule: { "time": "HH:MM", "days": [1-7] } (1=Mon, 7=Sun)
- email_event: { "from": "", "subject_contains": "", "has_attachment": false }
- github_event: { "event_type": "issue_assigned|pr_review_requested|new_notification|issue_opened" }
- notion_event: { "event": "new_page|page_updated" }
- keyword: { "phrase": "...", "match_type": "contains", "case_sensitive": false }
- manual: {}

If the description mentions a time/schedule, use schedule trigger.
If it mentions email/inbox, use email_event trigger.
If it mentions GitHub/PR/issue, use github_event trigger.
If it mentions a keyword/phrase, use keyword trigger.
If unclear, default to manual.

Respond with ONLY a JSON object, no markdown, no explanation.`,
    messages: [
      {
        role: 'user',
        content: `Description: ${parsed.data.description}${integrationContext}`,
      },
    ],
    tools: [],
    maxTokens: 500,
  })

  try {
    const text = (response.content ?? '').trim()
    // Strip markdown code fences if present
    const jsonStr = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    const recipe = JSON.parse(jsonStr)

    return NextResponse.json({
      name: recipe.name ?? '',
      trigger_type: recipe.trigger_type ?? 'manual',
      trigger_config: recipe.trigger_config ?? {},
      instructions: recipe.instructions ?? parsed.data.description,
      category: recipe.category ?? 'Productivity',
    })
  } catch {
    // Fallback: use description as instructions, manual trigger
    return NextResponse.json({
      name: '',
      trigger_type: 'manual',
      trigger_config: {},
      instructions: parsed.data.description,
      category: 'Productivity',
    })
  }
}
