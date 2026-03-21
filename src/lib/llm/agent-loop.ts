import { getLLMProvider } from './index'
import type {
  ChatMessage,
  Tool,
  ToolCall,
  ToolCallResult,
  UserContext,
} from './types'

const MAX_ITERATIONS = 10

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

    // Send intermediate message if the LLM produced text alongside tool calls
    if (response.content && onIntermediateMessage) {
      await onIntermediateMessage(response.content)
    }

    // Execute all tool calls in parallel
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
          const result = await tool.execute(call.input, ctx)
          return { id: call.id, result }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          return { id: call.id, error: errorMsg }
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

  return 'I ran into an issue completing that task. Please try again.'
}
