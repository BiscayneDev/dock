/**
 * Dinghy's computer tools (Workstream G4): shell access to the user's own
 * persistent sandbox. Metered per second into the spend ledger; the $5/day
 * hard cap and the server-side kill switch (metering.ts) apply to every
 * call. No secrets ever enter the sandbox.
 */

import { createServerClient } from '@/lib/supabase/server'
import type { Tool, ToolResult } from '@/lib/llm/types'
import { getOrStart, runInSandbox, stopSession, getProvider } from '@/lib/computer/manager'
import {
  assertComputerAllowed,
  getComputerSettings,
  getTodaySandboxSeconds,
  killIfOverCap,
  recordOveragePurchase,
} from '@/lib/computer/metering'

const COMMAND_CHAR_CAP = 4000

export const computerRun: Tool = {
  name: 'computer_run',
  description:
    "Run a shell command in the user's own private sandbox (a small Linux VM that keeps its state between messages). Use for real execution: running code, processing files, heavy fetching. Metered per second; the free daily allowance and the hard cap apply automatically.",
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to run' },
    },
    required: ['command'],
  },
  async execute(input, ctx): Promise<ToolResult> {
    const userId = ctx.userId
    if (!userId) return { success: false, error: 'computer is only available to bound users' }
    const command = String((input as { command?: unknown }).command ?? '').trim()
    if (!command) return { success: false, error: 'command is required' }

    const supabase = createServerClient()

    const settings = await getComputerSettings(userId, supabase)
    if (!settings.enabled) {
      return { success: false, error: 'the computer is turned off in your settings' }
    }

    // Kill switch, checked server-side before anything runs.
    const { session } = await getOrStart(userId, supabase)
    const provider = getProvider()
    const killed = await killIfOverCap(userId, session, (s, reason) => stopSession(s, reason, supabase, provider), supabase)
    if (killed) {
      return { success: false, error: "the computer was stopped because today's spending cap was reached" }
    }

    const allowance = await assertComputerAllowed(userId, supabase)
    if (!allowance.allowed && 'blocked' in allowance) {
      return { success: false, error: allowance.reason }
    }
    if (!allowance.allowed && 'needsApproval' in allowance) {
      return {
        success: false,
        error:
          `${allowance.reason} offer computer_overage to the user — it charges $${allowance.overageUsd.toFixed(2)} and needs their explicit yes.`,
      }
    }

    const result = await runInSandbox(userId, command, supabase, provider)
    if ('error' in result) return { success: false, error: result.error }

    let output = result.output.stdout
    if (result.output.stderr) output += (output ? '\n' : '') + result.output.stderr
    if (output.length > COMMAND_CHAR_CAP) output = output.slice(0, COMMAND_CHAR_CAP) + '…'
    return {
      success: result.output.exitCode === 0,
      data: { output, exitCode: result.output.exitCode, billedSeconds: result.billedSeconds },
      error: result.output.exitCode !== 0 ? `exit code ${result.output.exitCode}` : undefined,
    }
  },
}

export const computerStatus: Tool = {
  name: 'computer_status',
  description: 'Check the state of the sandbox: running/sleeping, seconds used today, and the free allowance.',
  inputSchema: { type: 'object', properties: {} },
  async execute(_input, ctx): Promise<ToolResult> {
    if (!ctx.userId) return { success: false, error: 'computer is only available to bound users' }
    const supabase = createServerClient()
    const settings = await getComputerSettings(ctx.userId, supabase)
    const used = await getTodaySandboxSeconds(ctx.userId, supabase)
    const { session, resumed } = await getOrStart(ctx.userId, supabase)
    return {
      success: true,
      data: {
        status: session.status,
        resumedFromSleep: resumed,
        sandboxId: session.sandbox_id,
        secondsUsedToday: used,
        freeSecondsPerDay: settings.freeSecondsPerDay,
        hardCapUsdPerDay: settings.hardCapUsdPerDay,
        enabled: settings.enabled,
      },
    }
  },
}

export const computerStop: Tool = {
  name: 'computer_stop',
  description: "Stop the user's sandbox. Its files stay for next time the computer starts.",
  inputSchema: { type: 'object', properties: {} },
  async execute(_input, ctx): Promise<ToolResult> {
    if (!ctx.userId) return { success: false, error: 'computer is only available to bound users' }
    const supabase = createServerClient()
    const { session } = await getOrStart(ctx.userId, supabase)
    await stopSession(session, 'stopped_by_user', supabase)
    return { success: true, data: { stopped: true } }
  },
}

/**
 * Confirm-gated overage purchase: $1 buys another ~6h of sandbox time.
 * Registered in CONFIRM_TOOLS — the user must explicitly say yes, exactly
 * like wallet_send.
 */
export const computerOverage: Tool = {
  name: 'computer_overage',
  description:
    'Buy more computer time for today: $1 buys another 6 hours of sandbox use, charged to the ledger. Requires the user’s explicit confirmation.',
  inputSchema: { type: 'object', properties: {} },
  async execute(_input, ctx): Promise<ToolResult> {
    if (!ctx.userId) return { success: false, error: 'computer is only available to bound users' }
    const supabase = createServerClient()
    await recordOveragePurchase(ctx.userId, supabase)
    return { success: true, data: { purchased: true, overageUsd: 1.0 } }
  },
}

export const COMPUTER_TOOLS: Tool[] = [computerRun, computerStatus, computerStop, computerOverage]
