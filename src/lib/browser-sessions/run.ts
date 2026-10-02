/**
 * Logged-in browser run (slice 4, PR C): read-only, one site, throwaway sandbox.
 *
 * - The user's cookies are decrypted server-side and written to a RAM-backed
 *   file inside a FRESH sandbox that exists only for this run. The user's
 *   persistent computer (computer_run) never holds them.
 * - PRIMARY containment is inside the sandbox and the browser: bootstrap.py
 *   routes every browser request through a guard that allows only the site's
 *   hosts and only GET/HEAD, blocks downloads and service workers, and deletes
 *   the cookie file right after loading it. The page's own JS cannot read
 *   HttpOnly cookies, and the only secret in the sandbox is the scoped,
 *   short-lived Shipyard gateway key (shipyardSandboxEnvs), never a Dinghy
 *   master key or the user's cookies on disk.
 * - E2B's egress allowlist (allowOut/denyOut) is defense in depth, NOT a
 *   boundary. It filters by TLS SNI / HTTP Host, not destination IP, so domain
 *   fronting works; DNS is not filtered, so DNS tunneling is possible; arbitrary
 *   TCP connects succeed at the socket level; and "*.site" matches ONE label
 *   (gist.github.com yes, a.b.github.com no). It stops casual requests and
 *   nothing more. (Observed in a live test on throwaway E2B sandboxes, Oct 2026,
 *   reported by the template-prep run; re-verify if E2B changes its network layer.)
 * - Anything that would let code inside the sandbox reach an attacker is
 *   therefore treated as possible; keep the secrets inside it to the minimum.
 * - The sandbox is killed in a finally block, server-side.
 */

import { loadCapabilitySecret, startRun, finishRun, touchCapability } from '@/lib/capabilities/store'
import { browserRunCommand, browserTaskTemplate, scrubInjectedInstructions } from '@/lib/computer/browser'
import { shipyardSandboxEnvs, USD_PER_SECOND } from '@/lib/computer/manager'
import { recordSpend } from '@/lib/payments/spend-caps'
import { GATEWAY_URL } from '@/lib/spectrum/config'
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

/**
 * Hosts the sandbox may reach at E2B's layer: the site (+ explicitly listed
 * extras, see SITE_EXTRA_HOSTS) and the model gateway. Defense in depth only;
 * see the file header. The gateway defaults to the same host the rest of the
 * app uses (spectrum/config), not a hardcoded guess.
 */
export function allowOutFor(site: string, gatewayUrl: string | undefined = GATEWAY_URL): string[] {
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
        // The only secret in here: the scoped Shipyard key. The URL is pinned to the app's configured gateway so allowOut and the bootstrap agree.
        envs: { ...shipyardSandboxEnvs(), SHIPYARD_GATEWAY_URL: GATEWAY_URL },
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

/**
 * Last pass over text that came out of a logged-in page before it reaches the
 * user. Page content is untrusted: it can tell the model to put things in the
 * answer. The browser can only reach the connected site, so nothing leaves the
 * sandbox, but an answer that renders an image or link to another host is the
 * one channel left, so images are dropped and off-site URLs are defanged.
 *
 * Residual risks that stay in v1 and are why only low-stakes sites should be
 * connected: (1) page text can still steer what the answer says; (2) GET
 * requests on the connected site can have side effects (e.g. "/logout",
 * "/unsubscribe?x"), because read-only here means no non-GET requests, not
 * "no state change". Both are bounded by the per-run approval and the
 * site's own low stakes.
 */
export function sanitizeAnswer(text: string, site: string): string {
  const onSite = (host: string) => {
    const h = host.toLowerCase().replace(/^www\./, '')
    return h === site || h.endsWith(`.${site}`)
  }
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[image removed]')
    .replace(/https?:\/\/([^\s/)>\]]+)[^\s)>\]]*/gi, (m, host: string) => (onSite(host.split(':')[0]) ? m : '[off-site link removed]'))
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

  // Fail-closed: no audit row, no run. Nothing has been started yet at this point.
  let runId: string
  try {
    runId = await startRun({ userId, capabilityId: cap.row.id, kind: 'browser_session', label: site, mode: 'read', task: input.task })
  } catch (err) {
    console.error('logged-in run refused, audit unavailable:', err instanceof Error ? err.message : String(err))
    return { ok: false, error: "I couldn't record this run, so I didn't start it. Try again in a minute." }
  }
  const started = Date.now()
  let sandbox: EphemeralSandbox | null = null
  let outcome = 'error'
  let detail: Record<string, unknown> = {}
  try {
    sandbox = await provider.create({ allowOut: allowOutFor(site) })
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
    let output = sanitizeAnswer(scrubInjectedInstructions(answer), site)
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
    if (outcome === 'ok') await touchCapability(cap.row.id).catch(() => null)
    await finishRun(runId, outcome, detail).catch((err) => console.error('audit close failed:', err instanceof Error ? err.message : String(err)))
  }
}
