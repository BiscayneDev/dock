import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import { executeRecipe } from '@/lib/recipes/execution-agent'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'

// --- recipe_create ---

const CreateInput = z.object({
  name: z.string(),
  instructions: z.string(),
  trigger_type: z.enum(['schedule', 'email_event', 'github_event', 'notion_event', 'keyword', 'manual']),
  trigger_config: z.record(z.string(), z.unknown()),
  notify_on_run: z.boolean().optional().default(true),
  fee_amount: z.number().min(0).max(100).optional().default(0),
  fee_required: z.boolean().optional().default(false),
})

export const recipeCreate: Tool = {
  name: 'recipe_create',
  description: 'Create a new recipe/automation. Created disabled initially — user must activate.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short descriptive name' },
      instructions: { type: 'string', description: 'What the execution agent should do' },
      trigger_type: { type: 'string', enum: ['schedule', 'email_event', 'github_event', 'notion_event', 'keyword', 'manual'] },
      trigger_config: { type: 'object', description: 'Trigger-specific config' },
      notify_on_run: { type: 'boolean', description: 'Notify user after each run (default true)' },
      fee_amount: { type: 'number', description: 'Fee in USDC to charge per run (0-100, default 0)' },
      fee_required: { type: 'boolean', description: 'Whether to require payment to run this recipe (default false)' },
    },
    required: ['name', 'instructions', 'trigger_type', 'trigger_config'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = CreateInput.parse(input)
      const supabase = createServerClient()

      const { data, error } = await supabase
        .from('recipes')
        .insert({
          user_id: ctx.userId,
          name: parsed.name,
          instructions: parsed.instructions,
          trigger_type: parsed.trigger_type,
          trigger_config: parsed.trigger_config,
          notify_on_run: parsed.notify_on_run,
          fee_amount: parsed.fee_amount,
          fee_required: parsed.fee_required,
          enabled: false,
        })
        .select('id, name, trigger_type, enabled, fee_amount, fee_required')
        .single()

      if (error) {
        return { success: false, error: `Failed to create recipe: ${error.message}` }
      }

      return {
        success: true,
        data: {
          ...data,
          message: 'Recipe created (disabled). Ask user to activate it.',
          activateCallbackData: `recipe_activate:${data.id}`,
          cancelCallbackData: `recipe_cancel:${data.id}`,
          editUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/recipes/${data.id}/edit`,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- recipe_list ---

export const recipeList: Tool = {
  name: 'recipe_list',
  description: "List the user's recipes with their status.",
  inputSchema: { type: 'object', properties: {} },
  async execute(_input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const supabase = createServerClient()

      const { data, error } = await supabase
        .from('recipes')
        .select('id, name, trigger_type, enabled, last_run_at, run_count, fee_amount, fee_required')
        .eq('user_id', ctx.userId)
        .order('created_at', { ascending: false })

      if (error) {
        return { success: false, error: `Failed to list recipes: ${error.message}` }
      }

      return { success: true, data: { count: data?.length ?? 0, recipes: data ?? [] } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- recipe_toggle ---

const ToggleInput = z.object({
  id: z.string().uuid(),
  enabled: z.boolean(),
})

export const recipeToggle: Tool = {
  name: 'recipe_toggle',
  description: 'Enable or disable a recipe.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Recipe ID' },
      enabled: { type: 'boolean', description: 'Enable or disable' },
    },
    required: ['id', 'enabled'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = ToggleInput.parse(input)
      const supabase = createServerClient()

      const { error } = await supabase
        .from('recipes')
        .update({ enabled: parsed.enabled, updated_at: new Date().toISOString() })
        .eq('id', parsed.id)
        .eq('user_id', ctx.userId)

      if (error) {
        return { success: false, error: `Failed to toggle recipe: ${error.message}` }
      }

      return { success: true, data: { id: parsed.id, enabled: parsed.enabled } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- recipe_delete ---

const DeleteInput = z.object({
  id: z.string().uuid(),
})

export const recipeDelete: Tool = {
  name: 'recipe_delete',
  description: 'Delete a recipe. Requires user confirmation first.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Recipe ID' },
    },
    required: ['id'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = DeleteInput.parse(input)
      const supabase = createServerClient()

      const { error } = await supabase
        .from('recipes')
        .delete()
        .eq('id', parsed.id)
        .eq('user_id', ctx.userId)

      if (error) {
        return { success: false, error: `Failed to delete recipe: ${error.message}` }
      }

      return { success: true, data: { deleted: true } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- recipe_run ---

const RunInput = z.object({
  id: z.string().uuid(),
})

export const recipeRun: Tool = {
  name: 'recipe_run',
  description: 'Manually trigger a recipe to run immediately.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Recipe ID' },
    },
    required: ['id'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = RunInput.parse(input)
      const supabase = createServerClient()

      const { data: recipe, error } = await supabase
        .from('recipes')
        .select('*')
        .eq('id', parsed.id)
        .eq('user_id', ctx.userId)
        .single()

      if (error || !recipe) {
        return { success: false, error: 'Recipe not found' }
      }

      // Fire-and-forget execution
      executeRecipe(
        {
          id: recipe.id as string,
          user_id: recipe.user_id as string,
          name: recipe.name as string,
          instructions: recipe.instructions as string,
          trigger_type: recipe.trigger_type as string,
          notify_on_run: recipe.notify_on_run as boolean,
          run_count: recipe.run_count as number,
          fee_amount: (recipe.fee_amount as number) ?? 0,
          fee_required: (recipe.fee_required as boolean) ?? false,
        },
        { manual: true, triggered_by: ctx.name },
        undefined,
        ctx.userId
      ).catch(() => {
        // Error handling is inside executeRecipe
      })

      return { success: true, data: { message: 'Recipe triggered. Output will be sent when complete.' } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

// --- recipe_history ---

const HistoryInput = z.object({
  id: z.string().uuid(),
  limit: z.number().optional().default(10),
})

export const recipeHistory: Tool = {
  name: 'recipe_history',
  description: 'Show the last N runs for a recipe.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Recipe ID' },
      limit: { type: 'number', description: 'Number of runs to show (default 10)' },
    },
    required: ['id'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = HistoryInput.parse(input)
      const supabase = createServerClient()

      const { data, error } = await supabase
        .from('recipe_runs')
        .select('id, status, triggered_at, completed_at, output, error, duration_ms')
        .eq('recipe_id', parsed.id)
        .eq('user_id', ctx.userId)
        .order('triggered_at', { ascending: false })
        .limit(parsed.limit)

      if (error) {
        return { success: false, error: `Failed to fetch history: ${error.message}` }
      }

      return { success: true, data: { runs: data ?? [] } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

export const allRecipeTools: Tool[] = [
  recipeCreate,
  recipeList,
  recipeToggle,
  recipeDelete,
  recipeRun,
  recipeHistory,
]
