import { getLLMProvider } from './index'
import { logger } from '@/lib/logger'
import type {
  ChatMessage,
  Tool,
  ToolCall,
  ToolCallResult,
  ToolResult,
  UserContext,
} from './types'

const MAX_ITERATIONS = 10
const TOOL_TIMEOUT_MS = 30_000

// Categorize tool errors into actionable messages for the LLM
function categorizeError(toolName: string, error: string): string {
  const lower = error.toLowerCase()

  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden')) {
    // Web fetch/search hitting paywalled sites is not an integration auth issue
    if (toolName === 'web_fetch' || toolName === 'web_search') {
      return `${toolName} failed: the site returned a ${lower.includes('401') ? '401' : '403'} error. The page may be paywalled or require login. Try a different source or search query.`
    }
    return `${toolName} failed: authentication expired. Tell the user to reconnect this integration in The Harbor settings or at /onboarding.`
  }

  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return `${toolName} failed: rate limited. Tell the user to try again in a few minutes.`
  }

  if (lower.includes('not connected') || lower.includes('no wallet') || lower.includes('no health device')) {
    return `${toolName} failed: integration not connected. Suggest the user connect it at /onboarding or in The Harbor settings.`
  }

  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('aborted')) {
    return `${toolName} timed out. The service may be slow — suggest trying again.`
  }

  if (lower.includes('network') || lower.includes('fetch failed') || lower.includes('econnrefused')) {
    return `${toolName} failed: network error. The service might be temporarily unavailable.`
  }

  return `${toolName} failed: ${error}`
}

// Execute a tool with a timeout
async function executeWithTimeout(
  tool: Tool,
  input: unknown,
  ctx: UserContext
): Promise<ToolResult> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Tool timed out after ${TOOL_TIMEOUT_MS / 1000}s`)), TOOL_TIMEOUT_MS)
  })

  return Promise.race([
    tool.execute(input, ctx),
    timeoutPromise,
  ])
}

export async function runAgentLoop(
  systemPrompt: string,
  messages: ChatMessage[],
  tools: Tool[],
  ctx: UserContext,
  onIntermediateMessage?: (msg: string) => Promise<void>,
  onConfirmationRequired?: (toolName: string, toolInput: Record<string, unknown>) => Promise<boolean>
): Promise<string> {
  const llm = getLLMProvider()
  const history: ChatMessage[] = [...messages]
  const toolDefinitions = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }))

  let iterations = 0
  const iterationLog: Array<{ iteration: number; tools: string[] }> = []

  while (iterations < MAX_ITERATIONS) {
    iterations++

    const response = await llm.chat({
      system: systemPrompt,
      messages: history,
      tools: toolDefinitions,
    })

    if (response.stopReason === 'end_turn' || response.toolCalls.length === 0) {
      return response.content ?? ''
    }

    // Track which tools were called per iteration
    iterationLog.push({
      iteration: iterations,
      tools: response.toolCalls.map((tc) => tc.name),
    })

    // Send intermediate message if the LLM produced text alongside tool calls
    if (response.content && onIntermediateMessage) {
      await onIntermediateMessage(response.content)
    }

    // Execute all tool calls in parallel with per-tool timeout
    const settledResults = await Promise.allSettled(
      response.toolCalls.map(async (call: ToolCall): Promise<ToolCallResult> => {
        const tool = tools.find((t) => t.name === call.name)
        if (!tool) {
          return { id: call.id, error: `Tool not found: ${call.name}` }
        }

        // Check if this tool requires user confirmation
        if (onConfirmationRequired) {
          const { CONFIRM_TOOLS } = await import('@/lib/orchestrator/confirmation')
          if (CONFIRM_TOOLS.has(call.name)) {
            const confirmed = await onConfirmationRequired(
              call.name,
              call.input
            )
            if (!confirmed) {
              return {
                id: call.id,
                result: {
                  success: false,
                  error: 'User cancelled this action.',
                },
              }
            }
          }
        }

        try {
          const result = await executeWithTimeout(tool, call.input, ctx) as ToolResult
          return { id: call.id, result }
        } catch (err) {
          const rawError = err instanceof Error ? err.message : String(err)
          const categorized = categorizeError(call.name, rawError)
          logger.error('Tool execution failed', {
            tool: call.name,
            input: call.input,
            error: rawError,
          })
          return { id: call.id, error: categorized }
        }
      })
    )

    const toolResults: ToolCallResult[] = settledResults.map((r) =>
      r.status === 'fulfilled'
        ? r.value
        : { id: 'unknown', error: String(r.reason) }
    )

    // Append assistant message with tool calls
    history.push({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    })

    // Append tool results
    history.push({
      role: 'tool',
      content: null,
      toolResults,
    })
  }

  // Log detailed info when max iterations hit
  logger.error('Agent loop hit max iterations', {
    userId: ctx.userId,
    iterations: MAX_ITERATIONS,
    iterationLog,
  })

  return 'I ran into an issue completing that task — got stuck in a loop. try rephrasing or breaking it into smaller steps.'
}
