import { createHmac, randomUUID } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000 // 15 minutes

function getSecret(): string {
  return process.env.ENCRYPTION_KEY ?? ''
}

export interface MagicLinkPayload {
  telegramId: number
  name: string
  username: string | null
  ts: number
  /** Random token id — recorded in consumed_magic_tokens on first verify. */
  jti: string
}

export function generateMagicToken(payload: Omit<MagicLinkPayload, 'jti'>): string {
  const data = JSON.stringify({ ...payload, jti: randomUUID() })
  const encoded = Buffer.from(data).toString('base64url')
  const signature = createHmac('sha256', getSecret()).update(encoded).digest('hex')
  return `${encoded}.${signature}`
}

/**
 * Atomically consume a token id: inserts jti with a primary key so a replay
 * hits a unique violation. Returns false when the jti was already used.
 */
async function consumeJti(
  jti: string,
  supabase: ReturnType<typeof createServerClient>
): Promise<boolean> {
  const { error } = await supabase
    .from('consumed_magic_tokens')
    .insert({ jti })

  if (!error) return true
  // Unique violation = already consumed.
  if (error.code === '23505') return false
  throw new Error(`Failed to consume magic token: ${error.message}`)
}

/**
 * Verify signature + TTL, then atomically consume the token BEFORE any session
 * is issued. Returns null on bad signature, expiry, or replay. Fail-closed:
 * if consumption cannot be recorded, the token is rejected.
 */
export async function verifyMagicToken(
  token: string,
  supabase: ReturnType<typeof createServerClient> = createServerClient()
): Promise<MagicLinkPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [encoded, signature] = parts
  const expectedSig = createHmac('sha256', getSecret()).update(encoded).digest('hex')

  if (signature !== expectedSig) return null

  try {
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as MagicLinkPayload

    // Check expiry
    if (Date.now() - data.ts > MAGIC_LINK_TTL_MS) return null

    if (!data.jti) return null

    // Single-use: consume before the caller issues a session.
    const consumed = await consumeJti(data.jti, supabase)
    if (!consumed) return null

    return data
  } catch {
    return null
  }
}

export function buildMagicLink(payload: Omit<MagicLinkPayload, 'jti'>): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const token = generateMagicToken(payload)
  return `${appUrl}/auth/magic?token=${token}`
}
