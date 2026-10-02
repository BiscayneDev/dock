/**
 * Logged-in browser run (slice 4, PR C): read-only, one site, throwaway sandbox.
 *
 * - The user's cookies are decrypted server-side and written to a RAM-backed
 *   file inside a FRESH sandbox that exists only for this run. The user's
 *   persistent computer (computer_run) never holds them.
 * - The sandbox network is pinned to the site (plus the Shipyard gateway for the
 *   model) at E2B's egress layer, and the browser itself is pinned and made
 *   GET/HEAD-only by bootstrap.py. Two independent layers.
 * - The sandbox is killed in a finally block, server-side.
 */

import { loadCapabilitySecret, startRun, finishRun } from '@/lib/capabilities/store'
import { browserRunCommand, browserTaskTemplate, scrubInjectedInstructions } from '@/lib/computer/browser'
import { shipyardSandboxEnvs, USD_PER_SECOND } from '@/lib/computer/manager'
import { recordSpend } from '@/lib/payments/spend-caps'
import { egressHostsFor, isDenied, normalizeSite, type StorageState } from './policy'

export const SESSION_STATE_PATH = '/dev/shm/dinghy-session.json'
/** A run is bounded: the Vercel function caps at 120s and the sandbox dies on its own after this. */
export const EPHEMERAL_TIMEOUT_MS = 5 * 60_000
export const LOGGED_IN_RUN_TIMEOUT_MS = 100_000
const OUTPUT_CAP = 4000

export interface EphemeralSandbox {
  run(cmd: string, opts?: { timeoutMs?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>
  writeFile(path: string, content: string): Promise<void>
  kill(): Promise<void>
}

export interface EphemeralProvider {
  create(opts: { allowOut: string[] }): Promise<EphemeralSandbox>
}

/** Hosts the sandbox may reach: the site, plus the model gateway (the agent loop needs it). */
export function allowOutFor(site: string, gatewayUrl: string | undefined): string[] {
  const hosts = egressHostsFor(site)
  if (gatewayUrl) {
    try {
      hosts.push(new URL(gatewayUrl).hostname)
    } catch {
      /* ignore a malformed gateway url; the run will fail loudly later */
    }
  }
  return hosts
}

/** Real provider. Needs the prebuilt template: with the network pinned, nothing can be installed at run time. */
export function e2bEphemeralProvider(): EphemeralProvider {
  return {
    async create({ allowOut }) {
      const template = process.env.E2B_TEMPLATE
      if (!template) throw new Error('logged-in browsing needs the prebuilt browser template (E2B_TEMPLATE)')
      const { Sandbox } = await import('e2b')
      const sbx = await Sandbox.create(template, {
        timeoutMs: EPHEMERAL_TIMEOUT_MS,
        envs: shipyardSandboxEnvs(),
        metadata: { purpose: 'logged-in-browse' },
        network: { denyOut: ['0.0.0.0/0'], allowOut },
      })
      return {
        async run(cmd, opts) {
          try {
            const r = await sbx.commands.run(cmd, { timeoutMs: opts?.timeoutMs ?? LOGGED_IN_RUN_TIMEOUT_MS })
            return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
          } catch (err) {
            const e = err as { stdout?: string; stderr?: string; exitCode?: number; message?: string }
            return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '', exitCode: e.exitCode ?? 1 }
          }
        },
        writeFile: async (path, content) => void (await sbx.files.write(path, content)),
        kill: async () => void (await sbx.kill()),
      }
    },
  }
}

export interface RunStats {
  requests: number
  blocked: number
  hosts: string[]
  blocked_hosts: string[]
  blocked_methods: string[]
}

/** Split bootstrap.py output into the answer and its stats line. */
export function parseBrowserOutput(stdout: string): { answer: string; stats: RunStats | null } {
  const [head, statsPart] = stdout.split('=== BROWSER_STATS ===')
  const answer = (head.split('=== BROWSER_RESULT ===')[1] ?? head).trim()
  let stats: RunStats | null = null
  if (statsPart) {
    try {
      stats = JSON.parse(statsPart.trim().split('\n')[0]) as RunStats
    } catch {
      stats = null
    }
  }
  return { answer, stats }
}

/** One short line for the user: what was touched and what the guard stopped. */
export function receiptLine(site: string, stats: RunStats | null): string {
  if (!stats) return `used your ${site} session (read-only).`
  const blocked = stats.blocked > 0 ? `, ${stats.blocked} blocked` : ', nothing blocked'
  return `used your ${site} session (read-only): ${stats.requests} requests${blocked}.`
}

export interface LoggedInInput {
  task: string
  site: string
  urls?: string[]
}

export type LoggedInResult = { ok: true; output: string; receipt: string; billedSeconds: number } | { ok: false; error: string }

export async function runLoggedInSession(
  userId: string,
  input: LoggedInInput,
  provider: EphemeralProvider = e2bEphemeralProvider()
): Promise<LoggedInResult> {
  const site = normalizeSite(input.site)
  if (!site) return { ok: false, error: `"${input.site}" isn't a site I can use` }
  if (isDenied(site)) return { ok: false, error: `I don't use logged-in sessions for ${site}` }

  const cap = await loadCapabilitySecret<StorageState>(userId, 'browser_session', site)
  if (!cap) return { ok: false, error: `${site} isn't connected (or the login expired). Connect it again first.` }

  // v1 is read-only whatever the row says: write mode needs its own per-action confirm (later PR).
  const readOnly = true
  const allowedHosts = egressHostsFor(site)
  const startUrl = `https://${site}/`
  const urls = (input.urls ?? []).filter((u) => {
    try {
      const h = new URL(u).hostname.replace(/^www\./, '')
      return h === site || h.endsWith(`.${site}`)
    } catch {
      return false
    }
  })

  const runId = await startRun({ userId, capabilityId: cap.row.id, kind: 'browser_session', label: site, mode: 'read', task: input.task })
  const started = Date.now()
  let sandbox: EphemeralSandbox | null = null
  let outcome = 'error'
  let detail: Record<string, unknown> = {}
  try {
    sandbox = await provider.create({ allowOut: allowOutFor(site, process.env.SHIPYARD_GATEWAY_URL) })
    await sandbox.writeFile(SESSION_STATE_PATH, JSON.stringify(cap.secret))
    await sandbox.run(`chmod 600 ${SESSION_STATE_PATH}`, { timeoutMs: 10_000 })
    const command = browserRunCommand(browserTaskTemplate(input.task, urls.length ? urls : [startUrl]), urls.length ? urls : [startUrl], {
      state_path: SESSION_STATE_PATH,
      allowed_hosts: allowedHosts,
      read_only: readOnly,
    })
    const r = await sandbox.run(command, { timeoutMs: LOGGED_IN_RUN_TIMEOUT_MS })
    const { answer, stats } = parseBrowserOutput(r.stdout)
    detail = stats ? { ...stats } : {}
    if (r.exitCode !== 0) {
      outcome = 'failed'
      return { ok: false, error: `the browser task failed (exit ${r.exitCode})` }
    }
    outcome = 'ok'
    let output = scrubInjectedInstructions(answer)
    if (output.length > OUTPUT_CAP) output = output.slice(0, OUTPUT_CAP) + '…'
    return { ok: true, output, receipt: receiptLine(site, stats), billedSeconds: Math.round((Date.now() - started) / 1000) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (sandbox) await sandbox.kill().catch(() => null)
    const seconds = Math.max(0, Math.round((Date.now() - started) / 1000))
    try {
      await recordSpend(userId, 'sandbox', seconds * USD_PER_SECOND, `browser-logged-in:${site}:${seconds}s`)
    } catch (err) {
      console.error('logged-in run metering failed:', err instanceof Error ? err.message : String(err))
    }
    if (runId) await finishRun(runId, outcome, detail).catch(() => null)
  }
}
