/**
 * Dock's iMessage front door via Spectrum (Photon).
 *
 * This is the Spectrum entry point — it bridges iMessage conversations to
 * Dock's existing LLM layer (src/lib/llm), which routes all model calls
 * through Shipyard Inference (cost-aware routing, prompt caching, savings
 * telemetry). Telegram remains channel #2; iMessage is the primary front
 * door.
 *
 * Spectrum Cloud project: "Dock" (958b9de0-be41-4251-97ba-aa83894db907)
 * Managed iMessage line: +1 (628) 264-7754
 *
 * Run with: npx tsx src/spectrum/index.ts
 * (or `bun run start` if using bun)
 */

import { Spectrum } from 'spectrum-ts'
import { imessage } from '@spectrum-ts/imessage'
import { getLLMProvider } from '@/lib/llm'
import type { ChatMessage } from '@/lib/llm/types'
import { logger } from '@/lib/logger'

// Conversation memory — keyed by iMessage chat guid.
// In production this should persist to Supabase; for now it's in-memory.
const conversations = new Map<string, ChatMessage[]>()

const MAX_HISTORY = 20

const SYSTEM_PROMPT = `You are Dock, a personal AI assistant accessible via iMessage.

You help with email, calendar, GitHub, Notion, crypto, and anything else the user needs.
You're direct, concise, and helpful. You don't waste words on pleasantries.

All your model calls route through Shipyard Inference — cost-aware routing across
providers, per-call USDC settlement, and automatic failover. The user never thinks
about which model you're using; you just use the cheapest one that can do the job.

When the user asks something you can't do from iMessage, tell them to use the web
dashboard at dock for full tool access.`

interface SpectrumMessage {
  content: { type: string; text?: string }
  from: { handle?: string; name?: string }
}

interface SpectrumSpace {
  guid: string
  send(text: string): Promise<void>
}

export async function createDockSpectrum() {
  const projectId = process.env.SPECTRUM_PROJECT_ID
  const projectSecret = process.env.SPECTRUM_PROJECT_SECRET

  if (!projectId || !projectSecret) {
    throw new Error(
      'SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET are required. ' +
        'Get them from the Photon dashboard (https://app.photon.codes).',
    )
  }

  const app = await Spectrum({
    projectId,
    projectSecret,
    providers: [imessage.config()],
  })

  logger.info('Dock Spectrum iMessage front door is live', {
    projectId,
    line: '+1 (628) 264-7754',
    providers: ['imessage'],
  })

  // Main message loop — each incoming iMessage is routed through the LLM layer.
  for await (const [space, message] of app.messages) {
    const msg = message as SpectrumMessage
    const sp = space as SpectrumSpace

    // Only handle text messages for now.
    if (msg.content.type !== 'text' || !msg.content.text) continue

    const text = msg.content.text.trim()
    if (!text) continue

    const senderName = msg.from?.name ?? msg.from?.handle ?? 'unknown'
    logger.info('imessage inbound', { from: senderName, guid: sp.guid })

    // Load or initialize conversation history.
    let history = conversations.get(sp.guid) ?? []
    history.push({ role: 'user', content: text })

    // Trim to keep context manageable.
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY)
    }

    try {
      const provider = getLLMProvider({ userId: `imessage:${sp.guid}` })
      const response = await provider.chat({
        system: SYSTEM_PROMPT,
        messages: history,
        tools: [],
        model: undefined, // Let the router pick the cheapest capable model.
      })

      const reply = response.content ?? '(no response)'
      await sp.send(reply)

      // Store the assistant's reply in history.
      history.push({ role: 'assistant', content: reply })
      conversations.set(sp.guid, history)
    } catch (err) {
      logger.error('imessage LLM call failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      await sp.send(
        'Something went wrong on my end. Try again in a moment — if it keeps happening, reach Halsey.',
      )
    }
  }
}

// Entry point when run directly.
createDockSpectrum().catch((err) => {
  console.error('Dock Spectrum failed to start:', err)
  process.exit(1)
})
