import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'

// SSRF prevention — block private/internal addresses
const BLOCKED_HOSTS = ['localhost', '127.', '10.', '0.0.0.0', '169.254.', '::1', 'fc00:', 'fe80:']
const BLOCKED_RANGES = [/^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./]

function isBlockedUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr)
    if (url.protocol !== 'https:') return true
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    if (BLOCKED_HOSTS.some((h) => hostname.startsWith(h) || hostname === h)) return true
    if (BLOCKED_RANGES.some((r) => r.test(hostname))) return true
    return false
  } catch {
    return true
  }
}

const ProxyBody = z.object({
  url: z.string().url().refine((url) => !isBlockedUrl(url), { message: 'URL must use HTTPS and cannot target private addresses' }),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
})

// Rate limiting — 10 req/min per user
const rateLimits = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const entry = rateLimits.get(userId)
  if (!entry || now > entry.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (entry.count >= 10) return false
  entry.count++
  return true
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!checkRateLimit(session.userId)) {
    return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = ProxyBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const { url, method, headers: customHeaders, body: reqBody } = parsed.data
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30_000)
  const startTime = Date.now()

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'User-Agent': 'Dock-Playground/1.0',
        'Accept': 'application/json, text/plain, */*',
        ...customHeaders,
      },
      body: ['POST', 'PUT', 'PATCH'].includes(method) ? reqBody : undefined,
      signal: controller.signal,
      redirect: 'follow',
    })

    const responseBody = await response.text()
    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => { responseHeaders[key] = value })

    return NextResponse.json({
      success: true,
      data: {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseBody,
        durationMs: Date.now() - startTime,
      },
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ error: 'Request timed out (30s limit)' }, { status: 504 })
    }
    const msg = err instanceof Error ? err.message : 'Network error'
    return NextResponse.json({ error: `Failed to reach endpoint: ${msg}` }, { status: 502 })
  } finally {
    clearTimeout(timeoutId)
  }
}
