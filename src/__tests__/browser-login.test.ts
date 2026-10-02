import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => ({
  mintConnectToken: vi.fn(async () => 'tok_' + 'x'.repeat(30)),
  peekConnectAttempt: vi.fn(),
  updateConnectAttempt: vi.fn(async () => true),
  consumeConnectAttempt: vi.fn(),
  saveCapability: vi.fn(async () => 'cap1'),
  auditEvent: vi.fn(async () => undefined),
  CONNECT_LINK_TTL_SECONDS: 900,
}))
vi.mock('@/lib/capabilities/store', () => store)
const enqueue = vi.hoisted(() => vi.fn(async () => 'ob1'))
vi.mock('@/lib/spectrum/outbox', () => ({ enqueueOutbox: enqueue }))
process.env.ENCRYPTION_KEY = 'b'.repeat(64)

import { mintLoginLink, startLogin, finishLogin, cancelLogin, vncPassword, type LoginProvider, type LoginSandbox } from '@/lib/browser-sessions/login'
import { CAPTURE_OUTPUT_PATH } from '@/lib/browser-sessions/login-scripts'

function fakeSandbox(stateJson: string, failStep?: number) {
  const calls: string[] = []
  const killed = { v: false }
  let n = 0
  const files: Record<string, string> = { [CAPTURE_OUTPUT_PATH]: stateJson }
  const sbx: LoginSandbox = {
    id: 'sbx1',
    host: (p) => `${p}-sbx1.e2b.app`,
    async run(cmd) {
      calls.push(cmd)
      n++
      return { stdout: '', stderr: '', exitCode: failStep === n ? 1 : 0 }
    },
    async writeFile(path, c) { files[path] = c },
    async readFile(path) { return files[path] },
    async kill() { killed.v = true },
  }
  const provider: LoginProvider = { create: vi.fn(async () => sbx), connect: vi.fn(async () => sbx) }
  return { sbx, provider, calls, killed }
}

const good = JSON.stringify({
  cookies: [
    { name: 'sess', value: 'S', domain: '.github.com' },
    { name: 'g', value: 'G', domain: 'accounts.google.com' },
  ],
  origins: [],
})

beforeEach(() => {
  Object.values(store).forEach((f) => typeof f === 'function' && 'mockClear' in f && (f as ReturnType<typeof vi.fn>).mockClear())
  store.peekConnectAttempt.mockReset()
  store.consumeConnectAttempt.mockReset()
  enqueue.mockClear()
})

describe('mintLoginLink', () => {
  it('mints a link for a normal site', async () => {
    const r = await mintLoginLink('u1', 'chat1', 'https://www.GitHub.com/x')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.site).toBe('github.com')
      expect(r.url).toMatch(/\/connect\/browser\?t=tok_/)
    }
    expect(store.mintConnectToken).toHaveBeenCalledWith('u1', 'chat1', 'browser_session', { site: 'github.com' })
  })
  it('refuses denylisted and junk sites without minting', async () => {
    store.mintConnectToken.mockClear()
    const bank = await mintLoginLink('u1', 'c', 'chase.com')
    expect(bank.ok).toBe(false)
    if (!bank.ok) expect(bank.error).toMatch(/banks/)
    expect((await mintLoginLink('u1', 'c', 'accounts.google.com')).ok).toBe(false)
    expect((await mintLoginLink('u1', 'c', 'not a site')).ok).toBe(false)
    expect(store.mintConnectToken).not.toHaveBeenCalled()
  })
})

describe('vncPassword', () => {
  it('is 8 characters (the VNC auth limit) and random', () => {
    expect(vncPassword()).toHaveLength(8)
    expect(vncPassword()).not.toBe(vncPassword())
  })
})

describe('startLogin', () => {
  it('starts the live view, passes no env, and stores the sandbox id + encrypted view url', async () => {
    store.peekConnectAttempt.mockResolvedValue({ user_id: 'u1', chat_guid: 'c', kind: 'browser_session', params: { site: 'github.com' } })
    const { provider, calls } = fakeSandbox(good)
    const r = await startLogin('tok', provider)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.viewUrl).toMatch(/^https:\/\/6080-sbx1\.e2b\.app\/vnc\.html\?autoconnect=true&resize=scale&password=/)
    expect(calls.some((c) => c.includes('https://github.com/'))).toBe(true)
    const [, params] = store.updateConnectAttempt.mock.calls[0] as unknown as [string, Record<string, string>]
    expect(params.sandbox_id).toBe('sbx1')
    expect(params.view_enc).not.toContain('vnc.html')
  })
  it('resumes the same session on reload instead of starting another sandbox', async () => {
    store.peekConnectAttempt.mockResolvedValue({ user_id: 'u1', chat_guid: 'c', kind: 'browser_session', params: { site: 'github.com' } })
    const first = fakeSandbox(good)
    const r1 = await startLogin('tok', first.provider)
    const enc = (store.updateConnectAttempt.mock.calls[0] as unknown as [string, Record<string, string>])[1].view_enc
    store.peekConnectAttempt.mockResolvedValue({ user_id: 'u1', chat_guid: 'c', kind: 'browser_session', params: { site: 'github.com', sandbox_id: 'sbx1', view_enc: enc } })
    const second = fakeSandbox(good)
    const r2 = await startLogin('tok', second.provider)
    expect(second.provider.create).not.toHaveBeenCalled()
    expect(r1.ok && r2.ok && r2.resumed && r2.viewUrl === r1.viewUrl).toBe(true)
  })
  it('rejects a dead link, and a denylisted site even if it somehow got in the row', async () => {
    store.peekConnectAttempt.mockResolvedValue(null)
    expect((await startLogin('tok', fakeSandbox(good).provider)).ok).toBe(false)
    store.peekConnectAttempt.mockResolvedValue({ user_id: 'u1', chat_guid: 'c', kind: 'browser_session', params: { site: 'coinbase.com' } })
    const f = fakeSandbox(good)
    expect((await startLogin('tok', f.provider)).ok).toBe(false)
    expect(f.provider.create).not.toHaveBeenCalled()
  })
  it('kills the sandbox if a startup step fails', async () => {
    store.peekConnectAttempt.mockResolvedValue({ user_id: 'u1', chat_guid: 'c', kind: 'browser_session', params: { site: 'github.com' } })
    const f = fakeSandbox(good, 2)
    const r = await startLogin('tok', f.provider)
    expect(r.ok).toBe(false)
    expect(f.killed.v).toBe(true)
  })
})

describe('finishLogin', () => {
  const attempt = { user_id: 'u1', chat_guid: 'chat1', kind: 'browser_session', params: { site: 'github.com', sandbox_id: 'sbx1' } }
  it('saves only the connected site cookies, texts the user, kills the sandbox', async () => {
    store.peekConnectAttempt.mockResolvedValue(attempt)
    store.consumeConnectAttempt.mockResolvedValue(attempt)
    const f = fakeSandbox(good)
    const r = await finishLogin('tok', f.provider)
    expect(r).toEqual({ ok: true, site: 'github.com', cookies: 1 })
    const saved = (store.saveCapability.mock.calls[0] as unknown as [{ secret: { cookies: Array<{ name: string }> }; mode: string; label: string; kind: string }])[0]
    expect(saved.secret.cookies.map((c) => c.name)).toEqual(['sess'])
    expect(saved.mode).toBe('read')
    expect(saved.kind).toBe('browser_session')
    expect(saved.label).toBe('github.com')
    expect(f.killed.v).toBe(true)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(enqueue.mock.calls)).not.toContain('"S"')
  })
  it('keeps the link alive when no login for the site was captured', async () => {
    store.peekConnectAttempt.mockResolvedValue(attempt)
    const f = fakeSandbox(JSON.stringify({ cookies: [{ name: 'g', value: 'G', domain: 'google.com' }], origins: [] }))
    const r = await finishLogin('tok', f.provider)
    expect(r.ok).toBe(false)
    expect(store.consumeConnectAttempt).not.toHaveBeenCalled()
    expect(store.saveCapability).not.toHaveBeenCalled()
    expect(f.killed.v).toBe(false)
  })
  it('does not save if the link was already used (double tap)', async () => {
    store.peekConnectAttempt.mockResolvedValue(attempt)
    store.consumeConnectAttempt.mockResolvedValue(null)
    const r = await finishLogin('tok', fakeSandbox(good).provider)
    expect(r.ok).toBe(false)
    expect(store.saveCapability).not.toHaveBeenCalled()
  })
  it('refuses a link with no started sandbox', async () => {
    store.peekConnectAttempt.mockResolvedValue({ ...attempt, params: { site: 'github.com' } })
    expect((await finishLogin('tok', fakeSandbox(good).provider)).ok).toBe(false)
  })
})

describe('cancelLogin', () => {
  it('burns the link and kills the sandbox', async () => {
    store.peekConnectAttempt.mockResolvedValue({ user_id: 'u1', chat_guid: 'c', kind: 'browser_session', params: { site: 'github.com', sandbox_id: 'sbx1' } })
    const f = fakeSandbox(good)
    await cancelLogin('tok', f.provider)
    expect(store.consumeConnectAttempt).toHaveBeenCalled()
    expect(f.killed.v).toBe(true)
  })
})

describe('site tiers at connect', () => {
  it('refuses newly denied families at mint', async () => {
    for (const s of ['mail.google.com', 'outlook.office.com', 'icloud.com', 'amazon.com', 'x.com', 'irs.gov'])
      expect((await mintLoginLink('u1', 'c', s)).ok, s).toBe(false)
  })
  it('marks vetted sites allowed and unvetted ones confirm', async () => {
    const a = await mintLoginLink('u1', 'c', 'github.com')
    const b = await mintLoginLink('u1', 'c', 'smallshop.example.com')
    expect(a.ok && a.tier).toBe('allowed')
    expect(b.ok && b.tier).toBe('confirm')
  })
  it('does not start a browser for an unvetted site until the user ticks the box', async () => {
    store.peekConnectAttempt.mockResolvedValue({ user_id: 'u1', chat_guid: 'c', kind: 'browser_session', params: { site: 'smallshop.example.com' } })
    const { provider } = fakeSandbox(good)
    const no = await startLogin('tok', provider)
    expect(no.ok).toBe(false)
    expect(provider.create).not.toHaveBeenCalled()
    const yes = await startLogin('tok', provider, true)
    expect(yes.ok).toBe(true)
  })
  it('audits the connect link and the saved login', async () => {
    await mintLoginLink('u1', 'c', 'github.com')
    expect(store.auditEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'connect_link', label: 'github.com' }))
  })
})
