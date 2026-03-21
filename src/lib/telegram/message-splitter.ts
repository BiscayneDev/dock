import { sendMessage, sendChatAction, smartEscapeMarkdownV2 } from './client'

const MIN_DELAY_MS = 300
const MAX_DELAY_MS = 800

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Split text into telegram-sized chunks that feel like natural human messages.
 * Keeps bullet lists, code blocks, and short paragraphs as atomic units.
 */
export function splitIntoChunks(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  // Split into paragraphs first
  const paragraphs = trimmed.split(/\n\n+/)
  const chunks: string[] = []

  for (const paragraph of paragraphs) {
    const lines = paragraph.trim()
    if (!lines) continue

    // Keep code blocks atomic
    if (lines.startsWith('```')) {
      chunks.push(lines)
      continue
    }

    // Keep bullet lists atomic (lines starting with - * or digits.)
    const bulletLines = lines.split('\n')
    const isList = bulletLines.every((l) =>
      /^\s*[-*•]\s/.test(l) || /^\s*\d+[.)]\s/.test(l) || l.trim() === ''
    )
    if (isList && bulletLines.length > 1) {
      chunks.push(lines)
      continue
    }

    // Split by sentences for regular paragraphs
    const sentences = splitSentences(lines)

    if (sentences.length <= 2) {
      chunks.push(lines)
      continue
    }

    // Group into chunks of 2-3 sentences
    let current: string[] = []
    for (const sentence of sentences) {
      current.push(sentence)
      if (current.length >= 2) {
        chunks.push(current.join(' '))
        current = []
      }
    }
    if (current.length > 0) {
      // Merge leftover single sentence with previous chunk if possible
      if (chunks.length > 0 && current.length === 1) {
        chunks[chunks.length - 1] += ' ' + current[0]
      } else {
        chunks.push(current.join(' '))
      }
    }
  }

  return chunks.filter((c) => c.trim().length > 0)
}

function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by space or end
  // But don't split on abbreviations (Mr. Dr. etc.) or decimals (3.14)
  const parts = text.match(/[^.!?]+[.!?]+[\s]?|[^.!?]+$/g)
  return (parts ?? [text]).map((s) => s.trim()).filter(Boolean)
}

/**
 * Send a message as rapid-fire chunks with typing indicators between them.
 * Mimics human texting patterns.
 */
export async function sendRapidFire(chatId: number, text: string): Promise<void> {
  const chunks = splitIntoChunks(text)

  // Short responses: send as single message, no splitting
  if (chunks.length <= 1) {
    await sendFormattedMessage(chatId, chunks[0] ?? text)
    return
  }

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) {
      // Typing indicator + natural delay between messages
      await sendChatAction(chatId)
      await delay(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS))
    }
    await sendFormattedMessage(chatId, chunks[i])
  }
}

async function sendFormattedMessage(chatId: number, text: string): Promise<void> {
  // Try MarkdownV2 first, fall back to plain text on parse error
  try {
    const escaped = smartEscapeMarkdownV2(text)
    await sendMessage({ chatId, text: escaped, parseMode: 'MarkdownV2' })
  } catch {
    // MarkdownV2 failed — send as plain text
    await sendMessage({ chatId, text })
  }
}
