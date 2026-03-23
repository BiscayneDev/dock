import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { getUserById, getDecryptedTokens } from '@/lib/orchestrator/index'
import { integrationTools, getOrchestratorTools } from '@/lib/tools/index'
import { allRecipeTools } from '@/lib/tools/recipes'
import { runAgentLoop } from '@/lib/llm/agent-loop'
import type { ChatMessage, UserContext, ToolCall, ToolCallResult } from '@/lib/llm/types'

const ChatBody = z.object({
  message: z.string().min(1),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant', 'tool']),
    content: z.string().nullable(),
    toolCalls: z.array(z.unknown()).optional(),
    toolResults: z.array(z.unknown()).optional(),
  })).optional().default([]),
})

const WORKSPACE_SYSTEM_PROMPT = `you are dock's recipe architect. you help users build the right automation through conversation.

YOUR APPROACH:
1. listen to what the user wants
2. use tools to explore what's possible — show them real data so they can make informed choices
3. ask 1-2 smart clarifying questions to nail down the details (don't guess, ask)
4. once you have enough context, build the recipe and output the deploy block

WHEN TO ASK vs WHEN TO BUILD:
- user says something vague ("watch prediction markets") → use tools to show what's available, then ask what specifically they care about (topics? volume threshold? how often?)
- user gives clear details ("every morning at 9am, check my calendar and email") → build it directly
- if you're unsure about trigger timing, filtering criteria, or notification preferences → ask
- never ask more than 2 questions at once. keep the conversation moving.

USE TOOLS TO INFORM THE CONVERSATION:
- if they mention prediction markets → call prediction_markets to show what's live right now
- if they mention email → ask about filters (which senders? what topics?)
- if they mention github → ask which repos or what events matter
- if they mention crypto prices → call token_price or trending_tokens to show current data
- showing real data helps the user make better decisions about what to automate

WHEN YOU'RE READY TO BUILD, output the recipe as a JSON block (this triggers the deploy card):
\`\`\`recipe
{"name": "short descriptive name", "trigger_type": "schedule|email_event|github_event|notion_event|keyword|manual", "trigger_config": {"time": "HH:MM", "days": [1,2,3,4,5]}, "instructions": "detailed, specific instructions for the execution agent", "category": "Email|Calendar|Developer|Productivity|Finance|Health|Crypto"}
\`\`\`

WRITE GREAT INSTRUCTIONS — the execution agent needs specifics:
- what to check/search for (topics, keywords, filters)
- how to filter or prioritize results (volume, recency, relevance)
- what to include in the notification (format, detail level, links)
- CRITICAL: always include a skip condition. the execution agent has a skip_run tool — tell it when to use it. example: "If no matching markets are found, use skip_run. Do NOT send a message if there's nothing to report."
- users hate getting empty notifications. every recipe should only notify when there's something worth reporting.

TRIGGER CONFIGS:
- schedule: {"time": "HH:MM", "days": [1-7]} (1=Mon, 7=Sun)
- email_event: {"from": "", "subject_contains": ""}
- github_event: {"event_type": "issue_assigned|pr_review_requested|new_notification"}
- keyword: {"phrase": "...", "match_type": "contains", "case_sensitive": false}
- manual: {}

QUICK REPLIES — when you ask the user a question, include tappable options using [quick:label] tags at the end of your message. examples:
- "how often should this run?" → add: [quick:Every hour] [quick:Every 4 hours] [quick:Once a day] [quick:Once a week]
- "which topics interest you?" → add: [quick:Politics] [quick:Crypto] [quick:Sports] [quick:Pop Culture] [quick:All of them]
- "what time works?" → add: [quick:8am] [quick:9am] [quick:12pm] [quick:6pm]
the [quick:...] tags will be stripped from your message and rendered as buttons. always provide 3-5 options.

voice:
- lowercase, casual, concise — you're a collaborator, not a documentation page
- be opinionated: suggest timing, filters, and approaches based on what you know
- show your work — when you run a tool, briefly explain what you found and why it matters
- never say "certainly", "great question", "would you like to proceed"
- keep each response to 2-3 short paragraphs max

x402 browsing is free. never tell users they need to pay to discover services.
built-in crypto tools (no setup needed): token_price, trending_tokens, prediction_markets`

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

  const parsed = ChatBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  try {
    const user = await getUserById(session.userId)
    const tokens = await getDecryptedTokens(session.userId)
    const ctx: UserContext = {
      userId: user.id,
      telegramId: user.telegram_id,
      telegramChatId: user.telegram_id,
      name: user.name ?? '',
      timezone: user.timezone ?? 'UTC',
      tokens,
    }

    const tools = getOrchestratorTools(allRecipeTools)
    const toolCallLog: Array<{ name: string; input: unknown; result: unknown }> = []

    // Wrap tools to capture calls for the UI
    const wrappedTools = tools.map((tool) => ({
      ...tool,
      async execute(input: unknown, toolCtx: UserContext) {
        const result = await tool.execute(input, toolCtx)
        toolCallLog.push({ name: tool.name, input, result })
        return result
      },
    }))

    const history: ChatMessage[] = [
      ...(parsed.data.history as ChatMessage[]),
      { role: 'user', content: parsed.data.message },
    ]

    const response = await runAgentLoop(
      WORKSPACE_SYSTEM_PROMPT,
      history,
      wrappedTools,
      ctx
    )

    // Check if response contains a recipe JSON block
    let recipe = null
    const recipeMatch = response.match(/```recipe\n([\s\S]*?)\n```/)
    if (recipeMatch) {
      try {
        recipe = JSON.parse(recipeMatch[1])
      } catch {
        // Not valid JSON, ignore
      }
    }

    // Clean response (remove recipe block if present)
    const cleanResponse = response.replace(/```recipe\n[\s\S]*?\n```/, '').trim()

    return NextResponse.json({
      response: cleanResponse,
      toolCalls: toolCallLog,
      recipe,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Agent error: ${msg}` }, { status: 500 })
  }
}
