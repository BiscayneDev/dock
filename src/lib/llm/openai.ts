import OpenAI from 'openai'
import type {
  LLMProvider,
  LLMChatParams,
  LLMResponse,
  ChatMessage,
  ToolCall,
} from './types'

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }

  async chat(params: LLMChatParams): Promise<LLMResponse> {
    const model = params.model ?? process.env.LLM_MODEL ?? 'gpt-4o'
    const maxTokens = params.maxTokens ?? 4096

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.system },
      ...params.messages.map((msg) => this.toOpenAIMessage(msg)),
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

    const response = await this.client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages,
      tools,
    })

    return this.parseResponse(response)
  }

  private toOpenAIMessage(
    msg: ChatMessage
  ): OpenAI.ChatCompletionMessageParam {
    if (msg.role === 'user') {
      return { role: 'user', content: msg.content ?? '' }
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

      return {
        role: 'assistant',
        content: msg.content,
        tool_calls: toolCalls,
      }
    }

    // role === 'tool'
    if (msg.toolResults && msg.toolResults.length > 0) {
      // OpenAI expects one message per tool result, but we need to return a single message.
      // Return the first one; the agent loop sends them individually.
      const tr = msg.toolResults[0]
      return {
        role: 'tool',
        tool_call_id: tr.id,
        content: tr.error
          ? JSON.stringify({ error: tr.error })
          : JSON.stringify(tr.result ?? { success: true }),
      }
    }

    return { role: 'user', content: msg.content ?? '' }
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
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      }))

    let stopReason: LLMResponse['stopReason'] = 'end_turn'
    if (choice.finish_reason === 'tool_calls') {
      stopReason = 'tool_use'
    } else if (choice.finish_reason === 'length') {
      stopReason = 'max_tokens'
    }

    return { content, toolCalls, stopReason }
  }
}
