import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import type { Tool, ToolResult, UserContext } from '@/lib/llm/types'

const SetInput = z.object({
  message: z.string().describe('The reminder message'),
  fire_at: z.string().describe('ISO 8601 datetime when the reminder should fire'),
})

export const reminderSet: Tool = {
  name: 'reminder_set',
  description: 'Create a reminder with a message and datetime. The user will receive a Telegram message at the specified time.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'The reminder message' },
      fire_at: { type: 'string', description: 'ISO 8601 datetime when the reminder should fire' },
    },
    required: ['message', 'fire_at'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = SetInput.parse(input)
      const supabase = createServerClient()

      const { data, error } = await supabase
        .from('reminders')
        .insert({
          user_id: ctx.userId,
          message: parsed.message,
          fire_at: parsed.fire_at,
        })
        .select('id, message, fire_at')
        .single()

      if (error) {
        return { success: false, error: `Failed to create reminder: ${error.message}` }
      }

      return { success: true, data }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

const ListInput = z.object({}).optional()

export const reminderList: Tool = {
  name: 'reminder_list',
  description: 'List all active (unfired) reminders for the user.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  async execute(_input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      ListInput.parse(_input)
      const supabase = createServerClient()

      const { data, error } = await supabase
        .from('reminders')
        .select('id, message, fire_at, created_at')
        .eq('user_id', ctx.userId)
        .eq('fired', false)
        .order('fire_at', { ascending: true })

      if (error) {
        return { success: false, error: `Failed to list reminders: ${error.message}` }
      }

      return { success: true, data }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}

const CancelInput = z.object({
  id: z.string().uuid().describe('The reminder ID to cancel'),
})

export const reminderCancel: Tool = {
  name: 'reminder_cancel',
  description: 'Cancel (delete) a reminder by its ID.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The reminder ID to cancel' },
    },
    required: ['id'],
  },
  async execute(input: unknown, ctx: UserContext): Promise<ToolResult> {
    try {
      const parsed = CancelInput.parse(input)
      const supabase = createServerClient()

      const { error } = await supabase
        .from('reminders')
        .delete()
        .eq('id', parsed.id)
        .eq('user_id', ctx.userId)

      if (error) {
        return { success: false, error: `Failed to cancel reminder: ${error.message}` }
      }

      return { success: true, data: { cancelled: true } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  },
}
