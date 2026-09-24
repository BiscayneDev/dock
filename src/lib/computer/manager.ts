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
  run(sandboxId: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>
  status(sandboxId: string): Promise<'running' | 'stopped'>
}

/**
 * In-memory mock. Used when E2B_SANDBOX_MOCK=1 or no E2B_API_KEY is set —
 * the default. Returns fake sandbox ids, echoes commands, never touches
 * the network.
 */
export class MockManager implements ComputerProvider {
  private sandboxes = new Map<string, boolean>()

  async start(): Promise<{ sandboxId: string }> {
    const sandboxId = `mock-${Math.random().toString(36).slice(2, 10)}`
    this.sandboxes.set(sandboxId, true)
    return { sandboxId }
  }

  async stop(sandboxId: string): Promise<void> {
    this.sandboxes.set(sandboxId, false)
  }

  async run(sandboxId: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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

  async start(): Promise<{ sandboxId: string }> {
    const Sandbox = await this.sdk()
    const sandbox = await Sandbox.create({ timeoutMs: 15 * 60_000 })
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

  async run(sandboxId: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const Sandbox = await this.sdk()
    const sandbox = await Sandbox.connect(sandboxId)
    const result = await sandbox.commands.run(command)
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
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
  memoTag = ''
): Promise<{ output: { stdout: string; stderr: string; exitCode: number }; sessionId: string; billedSeconds: number } | { error: string }> {
  const { session } = await getOrStart(userId, supabase)
  if (!session.sandbox_id) return { error: 'sandbox has no id' }

  const now = Date.now()
  const last = session.last_activity_at ? new Date(session.last_activity_at).getTime() : now
  const billedSeconds = Math.max(0, Math.round((now - last) / 1000))

  let result: { stdout: string; stderr: string; exitCode: number }
  try {
    result = await provider.run(session.sandbox_id, command)
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
