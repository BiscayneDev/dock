import { createHmac } from 'crypto'

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000 // 15 minutes

function getSecret(): string {
  return process.env.ENCRYPTION_KEY ?? ''
}

export interface MagicLinkPayload {
  telegramId: number
  name: string
  username: string | null
  ts: number
}

export function generateMagicToken(payload: MagicLinkPayload): string {
  const data = JSON.stringify(payload)
  const encoded = Buffer.from(data).toString('base64url')
  const signature = createHmac('sha256', getSecret()).update(encoded).digest('hex')
  return `${encoded}.${signature}`
}

export function verifyMagicToken(token: string): MagicLinkPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [encoded, signature] = parts
  const expectedSig = createHmac('sha256', getSecret()).update(encoded).digest('hex')

  if (signature !== expectedSig) return null

  try {
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as MagicLinkPayload

    // Check expiry
    if (Date.now() - data.ts > MAGIC_LINK_TTL_MS) return null

    return data
  } catch {
    return null
  }
}

export function buildMagicLink(payload: MagicLinkPayload): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const token = generateMagicToken(payload)
  return `${appUrl}/auth/magic?token=${token}`
}
