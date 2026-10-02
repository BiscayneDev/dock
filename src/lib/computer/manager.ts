/**
 * Dinghy's computer: a persistent per-user sandbox (E2B microVM), with an
 * in-memory mock as the default provider so the whole app boots and the
 * test suite runs with no E2B key.
 *
 * Security invariants (docs/plans/2026-09-24-dinghy-computer.md):
 * - Never place secrets (PAYBOX, OAuth tokens, SUPABASE_SERVICE_ROLE) inside
 *   the sandbox. Commands come from the model, credentials never do.
 * - The kill switch is server-side: allowance exhaustion stops the sandbox
 *   from Dinghy's side, never from inside it.
 *
 * Metering: every run() bumps last_activity_at and writes the wall-clock
 * seconds since the previous bump into spend_events (source='sandbox') at
 * E2B's $0.17/hr prorated. One ledger keeps the $5/day cap honest.
 */

import { createServerClient } from '@/lib/supabase/server'
import { recordSpend } from '@/lib/payments/spend-caps'

/** E2B micro list price: $0.17 per sandbox-hour. */
export const E2B_USD_PER_HOUR = 0.17
export const USD_PER_SECOND = E2B_USD_PER_HOUR / 3600

/** Sandbox pauses after this many idle minutes (enforced by the sweeper). */
export const SLEEP_AFTER_IDLE_MINUTES = 10

/** E2B lifetime of a running sandbox; refreshed on every connect. */
export const SANDBOX_TIMEOUT_MS = 15 * 60_000

/** Default per-command timeout (the calling Vercel function caps at 120s). */
export const DEFAULT_COMMAND_TIMEOUT_MS = 90_000

/** Thrown by a provider when the sandbox id no longer exists (killed/expired). */
export class SandboxGoneError extends Error {
  constructor(sandboxId: string) {
    super(`sandbox ${sandboxId} is gone`)
    this.name = 'SandboxGoneError'
  }
}

export type SessionStatus = 'running' | 'sleeping' | 'killed' | 'error'

export interface ComputerSessionRow {
  id: string
  user_id: string
  sandbox_id: string | null
  status: SessionStatus
  started_at: string | null
  last_activity_at: string | null
  killed_reason: string | null
}

/** Minimal provider interface — two impls: E2BManager and MockManager. */
export interface ComputerProvider {
  start(): Promise<{ sandboxId: string }>
  stop(sandboxId: string): Promise<void>
  /** Pause (keeps files, processes and memory). Throws if it cannot. */
  pause(sandboxId: string): Promise<void>
  /** Runs resume a paused sandbox transparently. Throws SandboxGoneError if the id is dead. */
  run(sandboxId: string, command: string, opts?: RunOpts): Promise<{ stdout: string; stderr: string; exitCode: number }>
  status(sandboxId: string): Promise<'running' | 'stopped'>
}

export interface RunOpts {
  timeoutMs?: number
}

/**
 * In-memory mock. Used when E2B_SANDBOX_MOCK=1 or no E2B_API_KEY is set —
 * the default. Returns fake sandbox ids, echoes commands, never touches
 * the network.
 */
export class MockManager implements ComputerProvider {
  private sandboxes = new Map<string, boolean>()
  private paused = new Set<string>()
  /** Test hook: ids that behave as expired/killed on the provider side. */
  private gone = new Set<string>()

  expire(sandboxId: string): void {
    this.gone.add(sandboxId)
  }

  isPaused(sandboxId: string): boolean {
    return this.paused.has(sandboxId)
  }

  async pause(sandboxId: string): Promise<void> {
    if (this.gone.has(sandboxId)) throw new SandboxGoneError(sandboxId)
    this.paused.add(sandboxId)
  }

  async start(): Promise<{ sandboxId: string }> {
    const sandboxId = `mock-${Math.random().toString(36).slice(2, 10)}`
    this.sandboxes.set(sandboxId, true)
    return { sandboxId }
  }

  async stop(sandboxId: string): Promise<void> {
    this.sandboxes.set(sandboxId, false)
  }

  async run(sandboxId: string, command: string, _opts?: RunOpts): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (this.gone.has(sandboxId)) throw new SandboxGoneError(sandboxId)
    // Like E2B connect: running a paused sandbox resumes it.
    this.paused.delete(sandboxId)
    if (this.sandboxes.get(sandboxId) !== true) {
      return { stdout: '', stderr: `sandbox ${sandboxId} is not running`, exitCode: 1 }
    }
    return { stdout: `$ ${command}`, stderr: '', exitCode: 0 }
  }

  async status(sandboxId: string): Promise<'running' | 'stopped'> {
    return this.sandboxes.get(sandboxId) === true ? 'running' : 'stopped'
  }
}

/**
 * Real E2B provider. Small and honest: direct SDK calls only. The SDK is
 * imported dynamically so test runs (which use the mock) never load it.
 */
export class E2BManager implements ComputerProvider {
  private async sdk() {
    const { Sandbox } = await import('e2b')
    return Sandbox
  }

  /**
   * Env vars the sandbox bootstrap needs (browser-use talks to Shipyard).
   * Injected at create and re-applied on every connect — E2B envs are
   * sandbox-scoped and never logged; no Dinghy master keys go in here, only
   * the sandbox-scoped Shipyard key minted for this purpose.
   */
  private sandboxEnvs(): Record<string, string> {
    const envs: Record<string, string> = {}
    const url = process.env.SHIPYARD_GATEWAY_URL
    const key = process.env.SHIPYARD_SANDBOX_KEY
    const model = process.env.SHIPYARD_MODEL
    if (url) envs.SHIPYARD_GATEWAY_URL = url
    if (key) envs.SHIPYARD_SANDBOX_KEY = key
    if (model) envs.SHIPYARD_MODEL = model
    return envs
  }

  async start(): Promise<{ sandboxId: string }> {
    const Sandbox = await this.sdk()
    const opts = { timeoutMs: SANDBOX_TIMEOUT_MS, envs: this.sandboxEnvs() }
    // E2B_TEMPLATE: prebuilt template with Chromium + browser-use baked in
    // (scripts/build-e2b-template.mjs). Unset = E2B's default base image.
    const template = process.env.E2B_TEMPLATE
    const sandbox = template ? await Sandbox.create(template, opts) : await Sandbox.create(opts)
    return { sandboxId: sandbox.sandboxId }
  }

  async stop(sandboxId: string): Promise<void> {
    const Sandbox = await this.sdk()
    try {
      const sandbox = await Sandbox.connect(sandboxId)
      await sandbox.kill()
    } catch {
      // Already gone — stopping a dead sandbox is a no-op.
    }
  }

  async pause(sandboxId: string): Promise<void> {
    const Sandbox = await this.sdk()
    await Sandbox.pause(sandboxId)
  }

  async run(sandboxId: string, command: string, opts: RunOpts = {}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const sdk = await import('e2b')
    const Sandbox = sdk.Sandbox
    let sandbox
    try {
      // connect() resumes a paused sandbox and extends a running one's lifetime.
      sandbox = await Sandbox.connect(sandboxId, { timeoutMs: SANDBOX_TIMEOUT_MS })
    } catch (err) {
      if (err instanceof sdk.NotFoundError) throw new SandboxGoneError(sandboxId)
      throw err
    }
    try {
      const result = await sandbox.commands.run(command, {
        envs: this.sandboxEnvs(),
        timeoutMs: opts.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      })
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
    } catch (err) {
      // A non-zero exit throws CommandExitError in the SDK; surface it as a result.
      if (err instanceof sdk.CommandExitError) {
        return { stdout: err.stdout, stderr: err.stderr, exitCode: err.exitCode }
      }
      throw err
    }
  }

  async status(sandboxId: string): Promise<'running' | 'stopped'> {
    const Sandbox = await this.sdk()
    const paginator = await Sandbox.list()
    while (paginator.hasNext) {
      const items = await paginator.nextItems()
      if (items.some((s) => s.sandboxId === sandboxId)) return 'running'
    }
    return 'stopped'
  }
}

/** Mock unless explicitly configured for real E2B (key present, mock off).
 * The mock is a singleton so sandbox ids persist across calls within the
 * process (mirroring E2B's persistent sandboxes); tests can reach it via
 * getProvider().start() to pre-seed a sandbox id. */
let mockSingleton: MockManager | null = null

export function getProvider(): ComputerProvider {
  const mock = process.env.E2B_SANDBOX_MOCK === '1' || !process.env.E2B_API_KEY
  if (mock) {
    if (!mockSingleton) mockSingleton = new MockManager()
    return mockSingleton
  }
  return new E2BManager()
}

export function usingMock(): boolean {
  return process.env.E2B_SANDBOX_MOCK === '1' || !process.env.E2B_API_KEY
}

type Supabase = ReturnType<typeof createServerClient>

/**
 * Reuse this user's running/sleeping sandbox or start a fresh one.
 * Persistent-per-user: exactly one live session per user.
 */
export async function getOrStart(
  userId: string,
  supabase: Supabase = createServerClient()
): Promise<{ session: ComputerSessionRow; resumed: boolean }> {
  const provider = getProvider()

  const { data: existing } = await supabase
    .from('computer_sessions')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['running', 'sleeping'])
    .maybeSingle()

  if (existing) {
    const session = existing as ComputerSessionRow
    const wasSleeping = session.status === 'sleeping'
    const now = new Date().toISOString()
    // Only the sleeping→running transition bumps activity: bumping a
    // running session would zero the metering window and unbill time.
    if (wasSleeping) {
      const { error } = await supabase
        .from('computer_sessions')
        .update({ status: 'running', last_activity_at: now })
        .eq('id', session.id)
      if (error) throw new Error(`Failed to resume computer session: ${error.message}`)
    }
    return { session: { ...session, status: 'running', last_activity_at: wasSleeping ? now : session.last_activity_at }, resumed: wasSleeping }
  }

  const { sandboxId } = await provider.start()
  const now = new Date().toISOString()
  const { data: created, error } = await supabase
    .from('computer_sessions')
    .insert({ user_id: userId, sandbox_id: sandboxId, status: 'running', started_at: now, last_activity_at: now })
    .select('*')
    .single()
  if (error || !created) throw new Error(`Failed to create computer session: ${error?.message ?? 'no row'}`)
  return { session: created as ComputerSessionRow, resumed: false }
}

/** Start a fresh sandbox for a session whose stored sandbox id is dead. */
export async function replaceDeadSandbox(
  session: ComputerSessionRow,
  supabase: Supabase = createServerClient(),
  provider: ComputerProvider = getProvider()
): Promise<string> {
  const { sandboxId } = await provider.start()
  const { error } = await supabase
    .from('computer_sessions')
    .update({ sandbox_id: sandboxId, status: 'running' })
    .eq('id', session.id)
  if (error) throw new Error(`Failed to replace dead sandbox: ${error.message}`)
  return sandboxId
}

/** Server-side stop: kills the sandbox and marks the session killed. */
export async function stopSession(
  session: ComputerSessionRow,
  reason: string,
  supabase: Supabase = createServerClient(),
  provider: ComputerProvider = getProvider()
): Promise<void> {
  if (session.sandbox_id) await provider.stop(session.sandbox_id)
  const { error } = await supabase
    .from('computer_sessions')
    .update({ status: 'killed', killed_reason: reason })
    .eq('id', session.id)
  if (error) throw new Error(`Failed to kill computer session: ${error.message}`)
}

/**
 * Run a command in the user's sandbox, metering wall-clock seconds since
 * the session's last activity into the spend ledger. Returns null when the
 * sandbox could not be used (caller surfaces the reason).
 */
export async function runInSandbox(
  userId: string,
  command: string,
  supabase: Supabase = createServerClient(),
  provider: ComputerProvider = getProvider(),
  memoTag = '',
  runOpts: RunOpts = {}
): Promise<{ output: { stdout: string; stderr: string; exitCode: number }; sessionId: string; billedSeconds: number } | { error: string }> {
  const { session: started } = await getOrStart(userId, supabase)
  let session = started
  if (!session.sandbox_id) return { error: 'sandbox has no id' }

  const now = Date.now()
  const last = session.last_activity_at ? new Date(session.last_activity_at).getTime() : now
  const billedSeconds = Math.max(0, Math.round((now - last) / 1000))

  let result: { stdout: string; stderr: string; exitCode: number }
  try {
    try {
      result = await provider.run(session.sandbox_id, command, runOpts)
    } catch (err) {
      if (!(err instanceof SandboxGoneError)) throw err
      // The stored sandbox expired or was killed: start a fresh one, point
      // the session at it, and retry once. State in the old VM is gone.
      const sandboxId = await replaceDeadSandbox(session, supabase, provider)
      session = { ...session, sandbox_id: sandboxId }
      result = await provider.run(sandboxId, command, runOpts)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await supabase
      .from('computer_sessions')
      .update({ status: 'error', last_activity_at: new Date(now).toISOString() })
      .eq('id', session.id)
    return { error: `sandbox run failed: ${message}` }
  }

  // Meter the elapsed wall-clock seconds since the last bump. The ledger
  // write must succeed (recordSpend throws) — a run we cannot bill for is
  // a failed run, same fail-closed rule as the money rails.
  if (billedSeconds > 0) {
    await recordSpend(
      userId,
      'sandbox',
      Number((billedSeconds * USD_PER_SECOND).toFixed(6)),
      `${session.id}:${billedSeconds}s${memoTag ? ` ${memoTag}` : ''}`,
      supabase
    )
  }

  const { error } = await supabase
    .from('computer_sessions')
    .update({ last_activity_at: new Date(now).toISOString(), status: 'running' })
    .eq('id', session.id)
  if (error) throw new Error(`Failed to update computer session: ${error.message}`)

  return { output: result, sessionId: session.id, billedSeconds }
}
