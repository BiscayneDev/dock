/**
 * Dock — iMessage front door via Spectrum (Photon).
 *
 * Standalone entry point: no Next.js, no @/ aliases, no vendored tgz.
 * Calls Shipyard Inference's OpenAI-compatible HTTP gateway directly.
 *
 * Run: npx tsx src/spectrum/index.ts
 *
 * Env:
 *   SPECTRUM_PROJECT_ID     — Photon project ID
 *   SPECTRUM_PROJECT_SECRET  — Photon project secret
 *   SHIPYARD_GATEWAY_URL    — Shipyard Inference gateway (default: https://shipyard-inference.vercel.app)
 *   SHIPYARD_API_KEY        — Gateway API key (sk-shipyard-…)
 */

import { Spectrum } from 'spectrum-ts'
import { imessage } from '@spectrum-ts/imessage'

// ── Config ─────────────────────────────────────────────────────────────────

const PROJECT_ID = process.env.SPECTRUM_PROJECT_ID
const PROJECT_SECRET = process.env.SPECTRUM_PROJECT_SECRET
const GATEWAY_URL = process.env.SHIPYARD_GATEWAY_URL ?? 'https://shipyard-inference.vercel.app'
const API_KEY = process.env.SHIPYARD_API_KEY

if (!PROJECT_ID || !PROJECT_SECRET) {
  console.error('SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET are required.')
  console.error('Get them from the Photon dashboard: https://app.photon.codes')
  process.exit(1)
}

if (!API_KEY) {
  console.error('SHIPYARD_API_KEY is required. Get one from the Shipyard gateway:')
  console.error(`  curl -X POST ${GATEWAY_URL}/api/keys -H 'Content-Type: application/json' -d '{}'`)
  process.exit(1)
}

// ── Conversation memory ──────────────────────────────────────────────────────
// In-memory per iMessage chat guid. Persist to Supabase in production.

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

const conversations = new Map<string, Message[]>()
const MAX_HISTORY = 20

const SYSTEM_PROMPT =
  'You are Dock, a personal AI assistant accessible via iMessage. ' +
  'You help with email, calendar, GitHub, Notion, crypto, and anything else the user needs. ' +
  "You're direct, concise, and helpful. You don't waste words on pleasantries. " +
  'All your model calls route through Shipyard Inference — cost-aware routing across providers, ' +
  'per-call USDC settlement, and automatic failover. The user never thinks about which model you use.'

// ── Shipyard gateway call ───────────────────────────────────────────────────

async function chat(history: Message[]): Promise<string> {
  const messages = [{ role: 'system' as const, content: SYSTEM_PROMPT }, ...history]

  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'auto',
      messages,
      stream: false,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Gateway ${res.status}: ${body || res.statusText}`)
  }

  const data = (await res.json()) as {
    choices: { message: { content: string | null } }[]
  }

  return data.choices?.[0]?.message?.content ?? '(no response)'
}

// ── Spectrum bridge ─────────────────────────────────────────────────────────

interface SpectrumMessage {
  content: { type: string; text?: string }
}

interface SpectrumSpace {
  guid: string
  send(text: string): Promise<void>
}

async function main() {
const app = await Spectrum({
  projectId: PROJECT_ID,
  projectSecret: PROJECT_SECRET,
  providers: [imessage.config()],
})

console.log('Dock iMessage front door is live')
console.log(`  Project: ${PROJECT_ID}`)
console.log(`  Line: +1 (628) 264-7754`)
console.log(`  Gateway: ${GATEWAY_URL}`)

for await (const [space, message] of app.messages) {
  const msg = message as SpectrumMessage
  const sp = space as SpectrumSpace

  if (msg.content.type !== 'text' || !msg.content.text) continue

  const text = msg.content.text.trim()
  if (!text) continue

  console.log(`imessage ← ${sp.guid}: ${text.slice(0, 80)}`)

  // Load + update history
  let history = conversations.get(sp.guid) ?? []
  history.push({ role: 'user', content: text })
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY)

  try {
    const reply = await chat(history)
    await sp.send(reply)
    history.push({ role: 'assistant', content: reply })
    conversations.set(sp.guid, history)
    console.log(`imessage → ${sp.guid}: ${reply.slice(0, 80)}`)
  } catch (err) {
    console.error('Gateway call failed:', err instanceof Error ? err.message : String(err))
    await sp.send('Something went wrong on my end. Try again in a moment.')
  }
}
}

main().catch((err) => {
  console.error('Dock Spectrum failed to start:', err)
  process.exit(1)
})
