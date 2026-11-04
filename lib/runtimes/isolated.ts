// Coding execution belongs on a paired home node, not a serverless control
// plane. The older direct-spawn implementation is removed. Existing callers
// fail closed; queue a home isolated task through /api/runs instead.
import type { AgentRuntime, RuntimeSession, ActivateParams, ChatParams } from './types'
export class IsolatedRuntime implements AgentRuntime {
  readonly name = 'Isolated coding (home queue required)'
  readonly id = 'isolated'
  readonly enforcesWorktreeIsolation = false
  async healthCheck() { return { ok: false, error: 'use paired home-node queue for isolated coding' } }
  async listSessions(): Promise<RuntimeSession[]> { return [] }
  async chat(_params: ChatParams): Promise<string> { throw new Error('isolated runtime has no direct chat') }
  async testDelivery(): Promise<void> { throw new Error('isolated runtime has no delivery channel') }
  async activate(_params: ActivateParams & { message: string }): Promise<void> {
    throw new Error('direct isolated launch disabled; use paired home-node queue')
  }
}
