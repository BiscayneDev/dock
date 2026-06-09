import { randomBytes } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { sendMessage } from '@/lib/telegram/client'
import type { InlineKeyboardMarkup } from '@/lib/telegram/client'

export const CONFIRM_TOOLS = new Set([
  'gmail_send',
  'gmail_reply',
  'gcal_delete_event',
  'wallet_send',
  'recipe_delete',
])

const TOOL_DESCRIPTIONS: Record<string, string> = {
  gmail_send: '📧 Send email',
  gmail_reply: '📧 Reply to email',
  gcal_delete_event: '📅 Delete calendar event',
  wallet_send: '🔐 Send crypto',
  recipe_delete: '🤖 Delete recipe',
}

const CONFIRMATION_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 2_000

function generateActionId(): string {
  return randomBytes(16).toString('hex')
}

function buildConfirmMessage(toolName: string, toolInput: Record<string, unknown>): string {
  const label = TOOL_DESCRIPTIONS[toolName] ?? toolName

  // Show the salient scalar fields of the action so the user knows what they're
  // approving (generalized — not a hardcoded field list).
  const details = Object.entries(toolInput)
    .filter(([, v]) => v != null && ['string', 'number', 'boolean'].includes(typeof v))
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 120)}`)

  const detailStr = details.length > 0 ? `\n${details.join('\n')}` : ''
  return `${label}${detailStr}\n\ngo ahead?`
}

// Request confirmation and block until the user responds — works across Vercel
// invocations via a DB row (the button callback runs in a separate invocation
// and flips the status, which this poll observes). Auto-cancels on timeout.
export async function requestConfirmation(
  chatId: number,
  toolName: string,
  toolInput: Record<string, unknown>,
  userId?: string
): Promise<boolean> {
  const supabase = createServerClient()
  const actionId = generateActionId()

  await supabase.from('pending_confirmations').insert({
    action_id: actionId,
    user_id: userId ?? null,
    chat_id: chatId,
    tool_name: toolName,
    tool_input: toolInput,
    status: 'pending',
  })

  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        { text: '✅ yes', callback_data: `confirm:${actionId}` },
        { text: '❌ cancel', callback_data: `cancel:${actionId}` },
      ],
    ],
  }

  await sendMessage({
    chatId,
    text: buildConfirmMessage(toolName, toolInput),
    replyMarkup: keyboard,
  })

  const deadline = Date.now() + CONFIRMATION_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

    const { data } = await supabase
      .from('pending_confirmations')
      .select('status')
      .eq('action_id', actionId)
      .single()

    if (data?.status === 'confirmed') return true
    if (data?.status === 'cancelled') return false
  }

  // Timed out — mark cancelled (only if still pending) and decline.
  await supabase
    .from('pending_confirmations')
    .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
    .eq('action_id', actionId)
    .eq('status', 'pending')

  return false
}

// Resolve a pending confirmation from the Telegram callback handler. Returns
// false if there was no pending row (already resolved or expired).
export async function resolveConfirmation(
  actionId: string,
  confirmed: boolean
): Promise<boolean> {
  const supabase = createServerClient()

  const { data } = await supabase
    .from('pending_confirmations')
    .update({
      status: confirmed ? 'confirmed' : 'cancelled',
      resolved_at: new Date().toISOString(),
    })
    .eq('action_id', actionId)
    .eq('status', 'pending')
    .select('action_id')

  return Boolean(data && data.length > 0)
}
