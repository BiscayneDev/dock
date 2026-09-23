import { describe, it, expect, vi } from 'vitest'
import { buildSystemPrompt, wantsHealth } from '@/lib/spectrum/dinghy'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/crypto', () => ({ decryptTokenFromDb: (v: string) => v, encryptTokenForDb: (v: string) => v }))

const base = { userId: 'u1', telegramId: 0, telegramChatId: 0, name: '', timezone: 'America/New_York' }
const tok = { accessToken: 'a', refreshToken: null, expiresAt: null }

describe('Oura/WHOOP on iMessage', () => {
  it('offers health tools with either wearable, not without', async () => {
    const { toolsFor, capabilitiesFor } = await import('@/lib/spectrum/imessage-tools')
    expect(toolsFor({ ...base, tokens: {} }).some((t) => t.name.startsWith('health_'))).toBe(false)
    const sets: Array<Record<string, typeof tok>> = [{ oura: tok }, { whoop: tok }]
    for (const tokens of sets) {
      const names = toolsFor({ ...base, tokens }).map((t) => t.name)
      expect(names).toEqual(expect.arrayContaining(['health_summary', 'health_sleep', 'health_readiness', 'health_activity', 'health_heart_rate']))
      expect(capabilitiesFor({ ...base, tokens }).health).toBe(true)
    }
  })

  it('detects health asks', () => {
    expect(wantsHealth('how did i sleep last night')).toBe(true)
    expect(wantsHealth('remind me to go to sleep at 11')).toBe(false)
    expect(wantsHealth("what's my recovery today")).toBe(true)
    expect(wantsHealth('how was my sleep score')).toBe(true)
    expect(wantsHealth('check my whoop')).toBe(true)
    expect(wantsHealth('book dinner at 8')).toBe(false)
  })

  it('prompt mentions health only when offered', () => {
    expect(buildSystemPrompt([], false, { google: false, wallet: false, health: true })).toContain('health_ tools')
    expect(buildSystemPrompt([], false, { google: false, wallet: false })).not.toContain('health_ tools')
  })

  it('auth urls keep the fixed web state by default and take a connect state', async () => {
    const { getOuraAuthUrl } = await import('@/lib/integrations/oura')
    const { getWhoopAuthUrl } = await import('@/lib/integrations/whoop')
    expect(new URL(getOuraAuthUrl()).searchParams.get('state')).toBe('oura')
    expect(new URL(getWhoopAuthUrl()).searchParams.get('state')).toBe('whoop_dock_auth')
    expect(new URL(getOuraAuthUrl('abc')).searchParams.get('state')).toBe('abc')
    expect(new URL(getWhoopAuthUrl('abc')).searchParams.get('state')).toBe('abc')
  })
})
