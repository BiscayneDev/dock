/**
 * Agent Runtime Interface
 *
 * Implement this interface to add a new runtime to Dock.
 * See openclaw.ts and ollama.ts for examples.
 */

export interface RuntimeSession {
  key: string
  model?: string
  [key: string]: unknown
}

export interface ActivateParams {
  taskId: string
  title: string
  description?: string
  assignee?: string
  priority?: string
  callbackUrl: string
}

export interface ChatParams {
  message: string
  sessionId?: string
}

export interface AgentRuntime {
  /** Human-readable name of the runtime */
  readonly name: string

  /** Short identifier used in AGENT_RUNTIME env var */
  readonly id: string

  /** Check if the runtime is reachable */
  healthCheck(): Promise<{ ok: boolean; version?: string; error?: string }>

  /** List active agent sessions */
  listSessions(): Promise<RuntimeSession[]>

  /** Send a message to an agent and get a reply (chat) */
  chat(params: ChatParams): Promise<string>

  /** Fire-and-forget: activate an agent for a task */
  activate(params: ActivateParams): Promise<void>

  /** Send a test message to a delivery channel */
  testDelivery(channel: string, target: string, message: string): Promise<void>
}
