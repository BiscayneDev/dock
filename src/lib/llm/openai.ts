import OpenAI from 'openai'
import { withRetry } from './retry'
import type {
  LLMProvider,
  LLMChatParams,
  LLMResponse,
  ChatMessage,
  ToolCall,
} from './types'
import { logger } from '@/lib/logger'

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI
  readonly defaultModel: string

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
    this.defaultModel = process.env.LLM_MODEL ?? 'gpt-4o'
  }

  async chat(params: LLMChatParams): Promise<LLMResponse> {
    const model = params.model ?? this.defaultModel
    const maxTokens = params.maxTokens ?? 8192

    // Build messages, expanding tool-role messages into one per result
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.system },
      ...this.expandMessages(params.messages),
    ]

    const tools: OpenAI.ChatCompletionTool[] | undefined =
      params.tools.length > 0
        ? params.tools.map((tool) => ({
            type: 'function' as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          }))
        : undefined

    const response = await withRetry(
      () =>
        this.client.chat.completions.create({
          model,
          max_tokens: maxTokens,
          messages,
          tools,
        }),
      `openai.chat:${model}`
    )

    return this.parseResponse(response)
  }

  // Expand ChatMessage[] into OpenAI messages, handling tool results correctly.
  // OpenAI requires ONE message per tool result, each with its own tool_call_id.
  private expandMessages(
    messages: ChatMessage[]
  ): OpenAI.ChatCompletionMessageParam[] {
    const expanded: OpenAI.ChatCompletionMessageParam[] = []

    for (const msg of messages) {
      if (msg.role === 'user') {
        expanded.push({ role: 'user', content: msg.content ?? '' })
        continue
      }

      if (msg.role === 'assistant') {
        const toolCalls: OpenAI.ChatCompletionMessageToolCall[] | undefined =
          msg.toolCalls && msg.toolCalls.length > 0
            ? msg.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.input),
                },
              }))
            : undefined

        expanded.push({
          role: 'assistant',
          content: msg.content,
          tool_calls: toolCalls,
        })
        continue
      }

      // role === 'tool' — expand each tool result into its own message
      if (msg.toolResults && msg.toolResults.length > 0) {
        for (const tr of msg.toolResults) {
          expanded.push({
            role: 'tool',
            tool_call_id: tr.id,
            content: tr.error
              ? JSON.stringify({ error: tr.error })
              : JSON.stringify(tr.result ?? { success: true }),
          })
        }
      } else {
        // Fallback: no tool results, treat as user message
        expanded.push({ role: 'user', content: msg.content ?? '' })
      }
    }

    return expanded
  }

  private parseResponse(
    response: OpenAI.ChatCompletion
  ): LLMResponse {
    const choice = response.choices[0]
    if (!choice) {
      return { content: null, toolCalls: [], stopReason: 'end_turn' }
    }

    const content = choice.message.content
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
      .filter((tc): tc is OpenAI.ChatCompletionMessageToolCall & { type: 'function' } => tc.type === 'function')
      .map((tc) => {
        let input: Record<string, unknown> = {}
        try {
          input = JSON.parse(tc.function.arguments) as Record<string, unknown>
        } catch (err) {
          logger.error('Failed to parse tool call arguments', {
            toolName: tc.function.name,
            args: tc.function.arguments,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return { id: tc.id, name: tc.function.name, input }
      })

    let stopReason: LLMResponse['stopReason'] = 'end_turn'
    if (choice.finish_reason === 'tool_calls') {
      stopReason = 'tool_use'
    } else if (choice.finish_reason === 'length') {
      stopReason = 'max_tokens'
    }

    return { content, toolCalls, stopReason }
  }
}
