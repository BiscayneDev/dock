/**
 * Dinghy — iMessage front door via Spectrum (Photon).
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
import { imessage, nativeContactCard } from '@spectrum-ts/imessage'
import {
  ensureIdentity,
  isGoogleConnected,
  loadHistory,
  saveMessage,
  createConnectLink,
  claimPendingResume,
  ackResume,
  listUnresumedResumeChats,
} from './store'

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
// History persists in Supabase (spectrum_messages) — see ./store.ts.

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

const MAX_HISTORY = 20

const SYSTEM_PROMPT =
  'You are Dinghy, a personal AI first mate accessible via iMessage. ' +
  'Right now you can hold a text conversation, share your contact card when asked, ' +
  'and remember context within the current conversation. There is also a waitlist ' +
  'site at getdinghy.sh where people can sign up for the beta. ' +
  'Gmail and Google Calendar connect through a one-tap link you can send in the ' +
  'chat — but the connect-link message itself (not you) handles that: when the ' +
  "user's message triggered one, you will not even be called. If the user asks " +
  'about email or calendar and no link was sent, say they are not connected yet ' +
  'and that they can ask again to get a connect link. Do not promise any other ' +
  'integration — GitHub, Notion, and others are not connected. ' +
  "You're direct, concise, and helpful. You don't waste words on pleasantries. " +
  'In a fresh chat, open with the question: "what\'s eating your time this week?" ' +
  'and work from their answer.'

// Messages that indicate the user wants Gmail/Calendar work.
const GOOGLE_INTENT =
  /\b(gmail|e-?mails?|inbox|calendar|calender|schedule(d)?|meetings?|appointments?|events? this week|my day)\b/i

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
  send(builder: ReturnType<typeof nativeContactCard>): Promise<void>
}

// Track which chats we've already sent the onboarding contact card to.
const onboarded = new Set<string>()
// Chats seen this process lifetime — the resume poll iterates these.
const activeChats = new Set<string>()

// On-demand triggers for the contact card.
const CONTACT_CARD_TRIGGERS = ['contact card', 'my card', 'share card', 'your card', 'add me', 'save contact', 'contact details', 'save your contact', 'save your details', 'your contact']

async function main() {
const app = await Spectrum({
  projectId: PROJECT_ID!,
  projectSecret: PROJECT_SECRET!,
  providers: [imessage.config()],
})

console.log('Dinghy iMessage front door is live')
console.log(`  Project: ${PROJECT_ID}`)
console.log(`  Line: +1 (628) 264-7754`)
console.log(`  Gateway: ${GATEWAY_URL}`)

for await (const [space, message] of app.messages) {
  const msg = message as SpectrumMessage
  const sp = space as unknown as SpectrumSpace

  if (msg.content.type !== 'text' || !msg.content.text) continue

  const text = msg.content.text.trim()
  if (!text) continue

  console.log(`imessage ← ${sp.guid}: ${text.slice(0, 80)}`)

  // Track active chats for the resume poll. Capture the sender handle when
  // Photon provides one (used for identity diagnostics/collision audits).
  spaceCache.set(sp.guid, sp)
  activeChats.add(sp.guid)

  const senderHandle =
    (msg as { sender?: { handle?: string } }).sender?.handle ??
    (msg as { from?: string }).from ??
    null
  await ensureIdentity(sp.guid, senderHandle).catch((err) =>
    console.error('identity ensure failed:', err instanceof Error ? err.message : String(err))
  )

  // On-demand contact card — user asks for it.
  if (CONTACT_CARD_TRIGGERS.some((t) => text.toLowerCase().includes(t))) {
    try {
      await sp.send(nativeContactCard())
      console.log(`imessage → ${sp.guid}: shared contact card (on request)`)
    } catch (err) {
      console.error('Failed to share contact card:', err instanceof Error ? err.message : String(err))
    }
    continue
  }

  // First-message onboarding — share contact card once per chat.
  if (!onboarded.has(sp.guid)) {
    onboarded.add(sp.guid)
    try {
      await sp.send(nativeContactCard())
      console.log(`imessage → ${sp.guid}: shared contact card (onboarding)`)
    } catch (err) {
      console.error('Onboarding contact card failed:', err instanceof Error ? err.message : String(err))
    }
  }

  // Gmail/Calendar requested while unconnected → send the one-use connect
  // link in-thread. The original request rides in the token and is resumed
  // automatically after the callback verifies the connection.
  if (GOOGLE_INTENT.test(text) && !(await isGoogleConnected(sp.guid).catch(() => false))) {
    try {
      const link = await createConnectLink(sp.guid, text)
      await saveMessage(sp.guid, 'user', text)
      await sp.send(
        `email + calendar aren't connected yet — connect google and i'll take it from there:\n${link}`
      )
      console.log(`imessage → ${sp.guid}: sent google connect link`)
    } catch (err) {
      console.error('Connect link failed:', err instanceof Error ? err.message : String(err))
      await sp.send("couldn't start the connect flow — try again in a moment.")
    }
    continue
  }

  // Load persistent history, then update it.
  let history = await loadHistory(sp.guid, MAX_HISTORY)
  history.push({ role: 'user', content: text })
  void saveMessage(sp.guid, 'user', text)

  try {
    const reply = await chat(history)
    await sp.send(reply)
    await saveMessage(sp.guid, 'assistant', reply)
    console.log(`imessage → ${sp.guid}: ${reply.slice(0, 80)}`)
  } catch (err) {
    console.error('Gateway call failed:', err instanceof Error ? err.message : String(err))
    await sp.send('Something went wrong on my end. Try again in a moment.')
  }
}

// Resume poll: when the OAuth callback completes for an iMessage chat, the
// token row is completed; here we take a delivery LEASE, send the
// confirmation + re-run the original request, and only then ACK (resumed_at).
// Crash between claim and send: the lease expires (60s) and any poller —
// including a freshly restarted process — re-claims and retries, so delivery
// is at-least-once and never lost. Chats come from the DB
// (listUnresumedResumeChats), so a cold restart picks up pending resumes
// immediately without waiting for an inbound message.
async function deliverResume(guid: string): Promise<void> {
  const claimed = await claimPendingResume(guid)
  if (!claimed) return
  console.log(`imessage → ${guid}: resuming pending request after connect`)
  try {
    const history = await loadHistory(guid, MAX_HISTORY)
    history.push({ role: 'user', content: claimed.pendingRequest })
    const reply = await chat(history)
    const space = spaceCache.get(guid)
    if (!space) {
      // Cannot deliver yet (no cached space). Leave the lease to expire —
      // a later poll (this process or a restarted one) retries. If the user
      // texts first, the space cache fills and the next poll delivers.
      console.log(`imessage: ${guid} not cached — resume lease will expire and retry`)
      return
    }
    await space.send(`google connected ✓\n\n${reply}`)
    await ackResume(claimed.id) // ack ONLY after a successful send
    await saveMessage(guid, 'user', claimed.pendingRequest)
    await saveMessage(guid, 'assistant', reply)
  } catch (err) {
    // Send/gateway failure: leave the lease un-acked — it expires and retries.
    console.error('Resume delivery failed (will retry after lease):', err instanceof Error ? err.message : String(err))
  }
}

setInterval(() => {
  void (async () => {
    const chats = new Set([...activeChats, ...(await listUnresumedResumeChats().catch(() => [] as string[]))])
    for (const guid of chats) {
      try {
        await deliverResume(guid)
      } catch (err) {
        console.error('Resume poll failed:', err instanceof Error ? err.message : String(err))
      }
    }
  })()
}, 15_000)

// Cold-restart sweep: attempt deliveries immediately on boot, not just on
// the first 15s tick.
void (async () => {
  try {
    for (const guid of await listUnresumedResumeChats()) await deliverResume(guid)
  } catch (err) {
    console.error('Resume sweep failed:', err instanceof Error ? err.message : String(err))
  }
})()
}

const spaceCache = new Map<string, SpectrumSpace>()

main().catch((err) => {
  console.error('Dinghy Spectrum failed to start:', err)
  process.exit(1)
})
