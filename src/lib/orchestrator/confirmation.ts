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

interface PendingConfirmation {
  resolve: (confirmed: boolean) => void
  timeout: ReturnType<typeof setTimeout>
}

// In-memory store for pending confirmations
// TODO: Replace with Redis for multi-instance deployments
const pendingConfirmations = new Map<string, PendingConfirmation>()

const CONFIRMATION_TIMEOUT_MS = 60_000

function generateActionId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function buildConfirmMessage(toolName: string, toolInput: Record<string, unknown>): string {
  const label = TOOL_DESCRIPTIONS[toolName] ?? toolName

  // Build a human-readable summary of what's about to happen
  const details: string[] = []
  if (toolInput.to) details.push(`to: ${toolInput.to}`)
  if (toolInput.subject) details.push(`subject: ${toolInput.subject}`)
  if (toolInput.amount) details.push(`amount: ${toolInput.amount}`)
  if (toolInput.eventId) details.push(`event: ${toolInput.eventId}`)

  const detailStr = details.length > 0 ? `\n${details.join('\n')}` : ''
  return `${label}${detailStr}\n\ngo ahead?`
}

export async function requestConfirmation(
  chatId: number,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<boolean> {
  const actionId = generateActionId()

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

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingConfirmations.delete(actionId)
      resolve(false) // Auto-cancel on timeout
    }, CONFIRMATION_TIMEOUT_MS)

    pendingConfirmations.set(actionId, { resolve, timeout })
  })
}

export function resolveConfirmation(actionId: string, confirmed: boolean): boolean {
  const pending = pendingConfirmations.get(actionId)
  if (!pending) return false

  clearTimeout(pending.timeout)
  pendingConfirmations.delete(actionId)
  pending.resolve(confirmed)
  return true
}

export function hasPendingConfirmation(actionId: string): boolean {
  return pendingConfirmations.has(actionId)
}
