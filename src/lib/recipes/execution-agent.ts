import { createServerClient } from '@/lib/supabase/server'
import { runAgentLoop } from '@/lib/llm/agent-loop'
import { executionAgentTools } from '@/lib/tools/index'
import { sendMessage } from '@/lib/telegram/client'
import { getUserById, getDecryptedTokens } from '@/lib/orchestrator/index'
import { logger } from '@/lib/logger'
import type { UserContext, Tool, ToolResult, ChatMessage } from '@/lib/llm/types'

const EXECUTION_TIMEOUT_MS = 90_000
const MAX_RUNS_PER_HOUR = 10
const MAX_AGENT_HISTORY = 20 // Keep last N exchanges in persistent history

// Sanitize instructions to prevent prompt injection
const INJECTION_PATTERNS = [
  /ignore previous instructions/gi,
  /you are now/gi,
  /^system:/gmi,
  /^admin:/gmi,
  /^override:/gmi,
  /disregard all/gi,
  /forget your instructions/gi,
]

function sanitizeInstructions(instructions: string): string {
  let sanitized = instructions
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[filtered]')
  }
  return sanitized
}

interface Recipe {
  id: string
  user_id: string
  name: string
  instructions: string
  trigger_type: string
  notify_on_run: boolean
  run_count: number
}

function buildExecutionAgentPrompt(
  recipe: Recipe,
  triggerContext: unknown,
  user: { name: string | null; timezone: string },
  integrations: string[],
  hasHistory: boolean
): string {
  const historyNote = hasHistory
    ? '\n\nYou have operational memory from previous runs of this recipe. Use it for context but focus on the current trigger.'
    : ''

  return `You are Dock's automation engine. You execute recipes autonomously on behalf of the user.

Current datetime: ${new Date().toISOString()}
User timezone: ${user.timezone}
User name: ${user.name ?? 'User'}
Connected integrations: ${integrations.join(', ')}

RECIPE: "${recipe.name}"
INSTRUCTIONS: ${sanitizeInstructions(recipe.instructions)}

TRIGGER: This recipe was triggered by: ${recipe.trigger_type}
TRIGGER CONTEXT:
${JSON.stringify(triggerContext, null, 2)}${historyNote}

RULES:
- Execute the instructions completely and autonomously.
- Do not ask the user questions. Make reasonable best-effort decisions.
- After completing, write a concise 2-3 sentence summary of what you did.
- If you cannot complete the task (missing integration, API error), explain why clearly.
- Keep your summary concise — it will be sent as a Telegram message.
- If the instructions say not to notify the user, end your response with exactly: [NO_NOTIFY]`
}

// Additional tools exclusive to execution agent
const sendProgressUpdate: Tool = {
  name: 'send_progress_update',
  description: 'Send a brief status message to the user during a long-running recipe. Use sparingly.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Progress message' },
    },
    required: ['message'],
  },
  async execute(): Promise<ToolResult> {
    return { success: false, error: 'Not configured' }
  },
}

const skipRun: Tool = {
  name: 'skip_run',
  description: "Skip this run with a reason. Use when trigger fired but instructions don't apply.",
  inputSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Reason for skipping' },
    },
    required: ['reason'],
  },
  async execute(): Promise<ToolResult> {
    return { success: true, data: { skipped: true } }
  },
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Recipe execution timed out')), ms)
  )
}

// --- Persistent Agent State ---

interface AgentState {
  id: string
  history: ChatMessage[]
  runCount: number
}

async function getOrCreateAgent(
  userId: string,
  recipeId: string,
  recipeName: string
): Promise<AgentState> {
  const supabase = createServerClient()

  const { data: existing } = await supabase
    .from('execution_agents')
    .select('id, history, run_count')
    .eq('user_id', userId)
    .eq('recipe_id', recipeId)
    .single()

  if (existing) {
    const history = Array.isArray(existing.history)
      ? (existing.history as ChatMessage[])
      : []
    return {
      id: existing.id as string,
      history,
      runCount: (existing.run_count as number) ?? 0,
    }
  }

  const { data: created } = await supabase
    .from('execution_agents')
    .insert({
      user_id: userId,
      recipe_id: recipeId,
      name: recipeName,
      history: [],
      run_count: 0,
    })
    .select('id')
    .single()

  return {
    id: (created?.id as string) ?? '',
    history: [],
    runCount: 0,
  }
}

async function updateAgentState(
  agentId: string,
  newMessages: ChatMessage[],
  toolCallLog: unknown[]
): Promise<void> {
  const supabase = createServerClient()

  // Fetch current state
  const { data } = await supabase
    .from('execution_agents')
    .select('history, tool_call_log, run_count')
    .eq('id', agentId)
    .single()

  const existingHistory = Array.isArray(data?.history)
    ? (data.history as ChatMessage[])
    : []
  const existingLog = Array.isArray(data?.tool_call_log)
    ? (data.tool_call_log as unknown[])
    : []

  // Append new messages, trim to max
  const combinedHistory = [...existingHistory, ...newMessages]
  const trimmedHistory = combinedHistory.slice(-MAX_AGENT_HISTORY)

  // Append tool calls (keep last 100)
  const combinedLog = [...existingLog, ...toolCallLog]
  const trimmedLog = combinedLog.slice(-100)

  await supabase
    .from('execution_agents')
    .update({
      history: trimmedHistory,
      tool_call_log: trimmedLog,
      run_count: ((data?.run_count as number) ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', agentId)
}

// --- Main execution ---

export async function executeRecipe(
  recipe: Recipe,
  triggerContext: unknown,
  statusOverride?: string
): Promise<void> {
  const supabase = createServerClient()

  // Rate limit check
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count: recentRuns } = await supabase
    .from('recipe_runs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', recipe.user_id)
    .gte('triggered_at', oneHourAgo)

  if ((recentRuns ?? 0) >= MAX_RUNS_PER_HOUR) {
    logger.warn('Recipe rate limit exceeded', { recipeId: recipe.id, userId: recipe.user_id })
    return
  }

  // Create run record
  const { data: run, error: runError } = await supabase
    .from('recipe_runs')
    .insert({
      recipe_id: recipe.id,
      user_id: recipe.user_id,
      trigger_context: triggerContext,
      status: statusOverride ?? 'running',
    })
    .select('id')
    .single()

  if (runError || !run) {
    return
  }

  const startTime = Date.now()

  try {
    const user = await getUserById(recipe.user_id)
    const tokens = await getDecryptedTokens(recipe.user_id)
    const ctx: UserContext = {
      userId: user.id,
      telegramId: user.telegram_id,
      telegramChatId: user.telegram_id,
      name: user.name ?? '',
      timezone: user.timezone ?? 'UTC',
      tokens,
    }

    // Load persistent agent state
    const agent = await getOrCreateAgent(recipe.user_id, recipe.id, recipe.name)

    const connectedIntegrations = Object.keys(tokens)
    const systemPrompt = buildExecutionAgentPrompt(
      recipe,
      triggerContext,
      user,
      connectedIntegrations,
      agent.history.length > 0
    )

    // Build tool list with execution-only tools
    const progressTool: Tool = {
      ...sendProgressUpdate,
      async execute(input: unknown): Promise<ToolResult> {
        const { message } = input as { message: string }
        try {
          await sendMessage({ chatId: ctx.telegramChatId, text: `⏳ ${message}` })
          return { success: true }
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    }

    const tools: Tool[] = [...executionAgentTools, progressTool, skipRun]
    const toolCallLog: unknown[] = []

    const wrappedTools: Tool[] = tools.map((tool) => ({
      ...tool,
      async execute(input: unknown, toolCtx: UserContext): Promise<ToolResult> {
        const result = await tool.execute(input, toolCtx)
        toolCallLog.push({ name: tool.name, input, result })
        return result
      },
    }))

    // Build messages: prior agent history + current trigger context
    const messages: ChatMessage[] = [
      ...agent.history,
      {
        role: 'user' as const,
        content: `[Run #${agent.runCount + 1}] Trigger: ${recipe.trigger_type}\nContext: ${JSON.stringify(triggerContext)}`,
      },
    ]

    const result = await Promise.race([
      runAgentLoop(systemPrompt, messages, wrappedTools, ctx),
      timeout(EXECUTION_TIMEOUT_MS),
    ])

    // Check if run was skipped
    const wasSkipped = toolCallLog.some(
      (log) => (log as { name: string }).name === 'skip_run'
    )

    if (wasSkipped) {
      await supabase
        .from('recipe_runs')
        .update({
          status: 'skipped',
          output: result,
          tool_calls: toolCallLog,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
        })
        .eq('id', run.id)

      // Still persist to agent history
      await updateAgentState(agent.id, [
        { role: 'user', content: `[Skipped run] ${JSON.stringify(triggerContext)}` },
        { role: 'assistant', content: result },
      ], toolCallLog)
      return
    }

    const noNotify = result.includes('[NO_NOTIFY]')
    const output = result.replace('[NO_NOTIFY]', '').trim()

    const isTest = statusOverride === 'test'
    if (recipe.notify_on_run && !noNotify && !isTest) {
      await sendMessage({
        chatId: ctx.telegramChatId,
        text: `⚡ *${recipe.name}*\n\n${output}`,
      })
    }

    await supabase
      .from('recipe_runs')
      .update({
        status: statusOverride ?? 'success',
        output,
        tool_calls: toolCallLog,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      })
      .eq('id', run.id)

    await supabase
      .from('recipes')
      .update({
        last_run_at: new Date().toISOString(),
        run_count: recipe.run_count + 1,
      })
      .eq('id', recipe.id)

    // Persist to agent memory
    await updateAgentState(agent.id, [
      { role: 'user', content: `[Run #${agent.runCount + 1}] ${JSON.stringify(triggerContext)}` },
      { role: 'assistant', content: output },
    ], toolCallLog)

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)

    await supabase
      .from('recipe_runs')
      .update({
        status: 'failed',
        error,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      })
      .eq('id', run.id)

    if (recipe.notify_on_run) {
      try {
        const user = await getUserById(recipe.user_id)
        await sendMessage({
          chatId: user.telegram_id,
          text: `⚠️ Recipe "${recipe.name}" failed\n\n${error}\n\nCheck The Harbor if this keeps happening.`,
        })
      } catch {
        // Failed to notify — silently continue
      }
    }
  }
}
