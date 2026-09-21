import { z } from 'zod'
import {
  searchMemories,
  keywordSearchMessages,
  supersedeMemory,
} from '@/lib/memory/store'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'

const SearchInput = z.object({
  query: z.string().describe('what to search for'),
})

export const memorySearch: Tool = {
  name: 'memory_search',
  description:
    "Search everything you remember about the user — past conversations, facts, preferences, people, plans. Use when the user references something from before ('that place I mentioned', 'my flight') or you need older context.",
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'what to search for' },
    },
    required: ['query'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = SearchInput.parse(input)

      const [memories, pastMessages] = await Promise.all([
        searchMemories(ctx.userId, parsed.query, 8),
        keywordSearchMessages(ctx.userId, parsed.query),
      ])

      return {
        success: true,
        data: {
          memories,
          past_messages: pastMessages,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

const ForgetInput = z.object({
  query: z.string().describe('text matching the memory to forget'),
})

export const memoryForget: Tool = {
  name: 'memory_forget',
  description:
    'Forget a memory. Use when the user says something is no longer true or asks you to forget.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'text matching the memory to forget' },
    },
    required: ['query'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = ForgetInput.parse(input)
      const count = await supersedeMemory(ctx.userId, parsed.query)
      return { success: true, data: { forgotten: count } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}
