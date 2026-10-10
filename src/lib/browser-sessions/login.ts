import { sandboxOwnerTag } from '@/lib/data-portability/owner-tag'
import { assertAccountActive } from '@/lib/data-portability/erasure-state'
/**
 * Remote-browser login for a site (slice 4, PR B).
 *
 * The user logs in themselves inside a Chromium that runs in a throwaway E2B
 * sandbox and is shown to them through a noVNC live view. Dinghy never sees
 * a password. When they tap done, we read the cookies over CDP, keep only the
 * connected site's, encrypt them with the AES-GCM helper and store them as a
 * 'browser_session' capability. The login sandbox is always killed after.
 *
 * The login sandbox has NO Dinghy secrets (no Shipyard key, no env at all).
 */

import { randomBytes } from 'crypto'
import { decryptTokenFromDb, encryptTokenForDb } from '@/lib/crypto'
import {
  consumeConnectAttempt,
  mintConnectToken,
  peekConnectAttempt,
  saveCapability,
  updateConnectAttempt,
  CONNECT_LINK_TTL_SECONDS,
  auditEvent,
} from '@/lib/capabilities/store'
import { enqueueOutbox } from '@/lib/spectrum/outbox'
import { denyMessage, filterStateToSite, isDenied, normalizeSite, siteTier, type SiteTier, type StorageState } from './policy'
import { CAPTURE_OUTPUT_PATH, CAPTURE_SCRIPT, CAPTURE_SCRIPT_PATH, NOVNC_PORT, loginStartCommands } from './login-scripts'

/** Login sandbox lifetime: matches the link TTL. E2B kills it on timeout even if we never get to. */
export const LOGIN_SANDBOX_TIMEOUT_MS = CONNECT_LINK_TTL_SECONDS * 1000

export interface LoginSandbox {
  id: string
  host(port: number): string
  run(cmd: string, opts?: { background?: boolean; timeoutMs?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>
  writeFile(path: string, content: string): Promise<void>
  readFile(path: string): Promise<string>
  kill(): Promise<void>
}

export interface LoginProvider {
  create(userId?:string): Promise<LoginSandbox>
  connect(id: string): Promise<LoginSandbox>
}

type E2BSandbox = {
  sandboxId: string
  getHost(port: number): string
  commands: { run(cmd: string, opts?: Record<string, unknown>): Promise<{ stdout: string; stderr: string; exitCode: number; disconnect?: () => Promise<void> }> }
  files: { write(path: string, data: string): Promise<unknown>; read(path: string): Promise<string> }
  kill(): Promise<unknown>
}

function wrap(sbx: E2BSandbox): LoginSandbox {
  return {
    id: sbx.sandboxId,
    host: (port) => sbx.getHost(port),
    async run(cmd, opts) {
      if (opts?.background) {
        const handle = await sbx.commands.run(cmd, { background: true, timeoutMs: 0 })
        await handle.disconnect?.()
        return { stdout: '', stderr: '', exitCode: 0 }
      }
      try {
        const r = await sbx.commands.run(cmd, { timeoutMs: opts?.timeoutMs ?? 60_000 })
        return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
      } catch (err) {
        // E2B throws on a non-zero exit; surface it as a result.
        const e = err as { stdout?: string; stderr?: string; exitCode?: number; message?: string }
        return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '', exitCode: e.exitCode ?? 1 }
      }
    },
    writeFile: async (path, content) => void (await sbx.files.write(path, content)),
    readFile: (path) => sbx.files.read(path),
    kill: async () => void (await sbx.kill()),
  }
}

/** Real provider. The SDK loads lazily so tests never import it. */
export function e2bLoginProvider(): LoginProvider {
  const template = process.env.E2B_LOGIN_TEMPLATE || 'dinghy-login'
  return {
    async create(userId) {
      if(!userId) throw new Error('Sandbox owner required')
      await assertAccountActive(userId)
      const { Sandbox } = await import('e2b')
      // No envs on purpose: nothing from Dinghy goes into the login sandbox.
      const sbx = await Sandbox.create(template, { timeoutMs: LOGIN_SANDBOX_TIMEOUT_MS, metadata: { purpose: 'browser-login', dinghy_owner: sandboxOwnerTag(userId) } })
      return wrap(sbx as unknown as E2BSandbox)
    },
    async connect(id) {
      const { Sandbox } = await import('e2b')
      return wrap((await Sandbox.connect(id)) as unknown as E2BSandbox)
    },
  }
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.getdinghy.sh').replace(/\/+$/, '')
}

const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
/** VNC auth only uses the first 8 characters, so 8 random characters is the real limit. */
export function vncPassword(): string {
  const bytes = randomBytes(8)
  return Array.from(bytes, (b) => PW_CHARS[b % PW_CHARS.length]).join('')
}

export type MintResult = { ok: true; url: string; site: string; minutes: number; tier: SiteTier } | { ok: false; error: string }

/** Validate the site and mint the texted link. Refuses denylisted sites. */
export async function mintLoginLink(userId: string, chatGuid: string | null, siteInput: string): Promise<MintResult> {
  const site = normalizeSite(siteInput)
  if (!site) return { ok: false, error: `"${siteInput}" doesn't look like a website. Use a name like github.com.` }
  const denied = isDenied(site)
  if (denied) {
    return { ok: false, error: denyMessage(site, denied) }
  }
  const token = await mintConnectToken(userId, chatGuid, 'browser_session', { site })
  await auditEvent({ userId, kind: 'browser_session', label: site, event: 'connect_link', detail: { tier: siteTier(site) } })
  return { ok: true, url: `${appUrl()}/connect/browser?t=${token}`, site, minutes: Math.round(CONNECT_LINK_TTL_SECONDS / 60), tier: siteTier(site) }
}

export type StartResult = { ok: true; viewUrl: string; site: string; resumed: boolean } | { ok: false; error: string; status: number }

const GONE = 'This link expired or was already used. Ask Dinghy for a fresh one.'

/** Bring up the live view for a live link. Idempotent: a reload resumes the same session. */
export async function startLogin(token: string, provider: LoginProvider = e2bLoginProvider(), ack = false): Promise<StartResult> {
  const attempt = await peekConnectAttempt(token)
  if (!attempt || attempt.kind !== 'browser_session') return { ok: false, error: GONE, status: 410 }
  const site = String(attempt.params.site ?? '')
  if (!normalizeSite(site) || isDenied(site)) return { ok: false, error: GONE, status: 410 }
  // Sites outside the vetted low-stakes list need an explicit tick on the page.
  if (siteTier(site) === 'confirm' && !ack) {
    return { ok: false, error: `Tick the box to confirm you want Dinghy to hold a read-only login for ${site}.`, status: 412 }
  }

  const existing = typeof attempt.params.view_enc === 'string' ? attempt.params.view_enc : null
  if (existing) {
    try {
      return { ok: true, viewUrl: decryptTokenFromDb(existing), site, resumed: true }
    } catch {
      /* fall through and start fresh */
    }
  }

  let sandbox: LoginSandbox | null = null
  try {
    sandbox = await provider.create(attempt.user_id)
    const password = vncPassword()
    for (const step of loginStartCommands(`https://${site}/`, password)) {
      const r = await sandbox.run(step.cmd, { background: step.background, timeoutMs: 60_000 })
      if (r.exitCode !== 0) throw new Error(`login sandbox step failed (exit ${r.exitCode})`)
    }
    // Known limit: this URL is a bearer credential. Anyone who has it (host + password)
    // can drive the login browser until the sandbox dies at the link TTL. It is shown only
    // on the one-use page, stored encrypted, and never texted. Do not log or proxy it.
    const viewUrl = `https://${sandbox.host(NOVNC_PORT)}/vnc.html?autoconnect=true&resize=scale&password=${encodeURIComponent(password)}`
    const saved = await updateConnectAttempt(token, { sandbox_id: sandbox.id, view_enc: encryptTokenForDb(viewUrl) })
    if (!saved) throw new Error('link no longer live')
    return { ok: true, viewUrl, site, resumed: false }
  } catch (err) {
    if (sandbox) await sandbox.kill().catch(() => null)
    console.error('browser login start failed:', err instanceof Error ? err.message : String(err))
    return { ok: false, error: "Couldn't open the browser. Ask Dinghy for a fresh link in a minute.", status: 502 }
  }
}

export type FinishResult = { ok: true; site: string; cookies: number } | { ok: false; error: string; status: number }

/** The user tapped done: capture, filter to the site, encrypt, save, kill the sandbox. */
export async function finishLogin(token: string, provider: LoginProvider = e2bLoginProvider()): Promise<FinishResult> {
  const attempt = await peekConnectAttempt(token)
  const sandboxId = typeof attempt?.params.sandbox_id === 'string' ? attempt.params.sandbox_id : null
  if (!attempt || attempt.kind !== 'browser_session' || !sandboxId) return { ok: false, error: GONE, status: 410 }
  const site = String(attempt.params.site ?? '')
  if (!normalizeSite(site) || isDenied(site)) return { ok: false, error: GONE, status: 410 }

  try {
    const sandbox = await provider.connect(sandboxId)
    await sandbox.writeFile(CAPTURE_SCRIPT_PATH, CAPTURE_SCRIPT)
    const run = await sandbox.run(`python3 ${CAPTURE_SCRIPT_PATH}`, { timeoutMs: 30_000 })
    if (run.exitCode !== 0) throw new Error(`capture failed (exit ${run.exitCode})`)
    const raw = await sandbox.readFile(CAPTURE_OUTPUT_PATH)
    const parsed = JSON.parse(raw) as StorageState
    const { state } = filterStateToSite(parsed, site)
    if (state.cookies.length === 0) {
      // Not consumed: the user can log in and try again.
      return { ok: false, error: `I didn't see a login for ${site} yet. Finish logging in, then tap done again.`, status: 422 }
    }
    const used = await consumeConnectAttempt(token)
    if (!used) return { ok: false, error: GONE, status: 410 }
    await saveCapability({
      userId: used.user_id,
      kind: 'browser_session',
      label: site,
      scope: { site },
      mode: 'read',
      secret: state,
    })
    if (used.chat_guid) {
      await enqueueOutbox(
        used.chat_guid,
        'reply',
        `connected ${site}, read-only, for 30 days. i only use it when you say yes to a task, and only on ${site}. text "disconnect ${site}" any time to delete it.`
      ).catch(() => null)
    }
    await auditEvent({ userId: used.user_id, kind: 'browser_session', label: site, event: 'connected', detail: { cookies: state.cookies.length } })
    await sandbox.kill().catch(() => null)
    return { ok: true, site, cookies: state.cookies.length }
  } catch (err) {
    console.error('browser login finish failed:', err instanceof Error ? err.message : String(err))
    return { ok: false, error: "Couldn't save the login. Try again, or ask Dinghy for a fresh link.", status: 500 }
  }
  // Retryable misses leave the live view up on purpose; E2B kills it at the link TTL.
}

/** The user backed out: kill the sandbox and burn the link. */
export async function cancelLogin(token: string, provider: LoginProvider = e2bLoginProvider()): Promise<void> {
  const attempt = await peekConnectAttempt(token)
  const sandboxId = typeof attempt?.params.sandbox_id === 'string' ? attempt.params.sandbox_id : null
  await consumeConnectAttempt(token)
  if (sandboxId) {
    const sbx = await provider.connect(sandboxId).catch(() => null)
    await sbx?.kill().catch(() => null)
  }
}
