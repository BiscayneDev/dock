import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'

const SwitchInput = z.object({
  provider: z.enum(['anthropic', 'openai', 'usepod']),
})

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic (direct API)',
  openai: 'OpenAI (direct API)',
  usepod: 'UsePod (wallet-funded proxy in front of Anthropic)',
}

export const switchLLMProvider: Tool = {
  name: 'switch_llm_provider',
  description:
    "Switch which LLM provider you (Dock) will use for the user's future messages. " +
    "Options: 'anthropic' (direct Claude API), 'openai' (direct GPT API), 'usepod' " +
    "(wallet-funded proxy that pays Anthropic with the user's USDC balance). " +
    "The change is persisted to the user's preferences and takes effect on their next message.",
  inputSchema: {
    type: 'object',
    properties: {
      provider: {
        type: 'string',
        enum: ['anthropic', 'openai', 'usepod'],
        description: 'Which provider to switch to.',
      },
    },
    required: ['provider'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const { provider } = SwitchInput.parse(input)
      const supabase = createServerClient()

      const { data: user, error: readErr } = await supabase
        .from('users')
        .select('preferences')
        .eq('id', ctx.userId)
        .single()

      if (readErr || !user) {
        return { success: false, error: `Could not read user preferences: ${readErr?.message ?? 'unknown'}` }
      }

      const existing = (user.preferences as Record<string, unknown> | null) ?? {}
      const next = { ...existing, llm_provider: provider }

      const { error: writeErr } = await supabase
        .from('users')
        .update({ preferences: next })
        .eq('id', ctx.userId)

      if (writeErr) {
        return { success: false, error: `Could not save preferences: ${writeErr.message}` }
      }

      return {
        success: true,
        data: {
          provider,
          label: PROVIDER_LABELS[provider] ?? provider,
          effective: 'next message',
          note: 'Tell the user the switch is saved and will take effect on their next message.',
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}
