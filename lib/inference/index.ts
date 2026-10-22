/**
 * Inference Layer
 *
 * Provider-agnostic LLM calls for Dock, built on the Vercel AI SDK.
 *
 * Model selection is per-agent and env-driven:
 *   AGENT_MODEL_VIC=anthropic/claude-sonnet-4-5
 *   AGENT_MODEL_SCOUT=nous/xiaomi/mimo-v2-pro
 *   AGENT_MODEL=anthropic/claude-haiku-4-5      (fallback default)
 *
 * When no model is configured (or the provider's key is missing), callers
 * fall back to the existing AgentRuntime pipeline (OpenClaw / Ollama / demo).
 */

import { generateText, streamText } from "ai"
import { buildModel, type ResolvedModel } from "./providers"
import type { ShipyardCapture } from "./shipyard-capture"
import type { RunModelCall, RunTelemetry } from "@/lib/conversations"

export { buildModel, parseModelRef, listConfiguredProviders } from "./providers"
export type { ResolvedModel, ProviderKey } from "./providers"

/** Resolve the model reference configured for an agent (or null). */
export function resolveModelRef(agent?: string): string | null {
  if (agent) {
    const perAgent = process.env[`AGENT_MODEL_${agent.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`]
    if (perAgent?.trim()) return perAgent.trim()
  }
  const fallback = process.env.AGENT_MODEL
  return fallback?.trim() ?? null
}

/** Resolve a LanguageModel for an agent. Null = use the AgentRuntime pipeline. */
export function resolveModel(agent?: string, capture?: ShipyardCapture): ResolvedModel | null {
  const ref = resolveModelRef(agent)
  if (!ref) return null
  const resolved = buildModel(ref, capture)
  if (!resolved) {
    console.warn(`[inference] Unrecognized model reference '${ref}' — expected provider/model-id`)
    return null
  }
  return resolved
}

/** True when inference-layer configuration exists for this agent. */
export function hasInferenceConfig(agent?: string): boolean {
  return resolveModel(agent) !== null
}

export interface InferenceChatParams {
  message: string
  agent?: string
  system?: string
}

/**
 * One-shot generation through the inference layer.
 * Returns null when the agent has no model configured (caller falls back).
 */
export async function inferenceChat({ message, agent, system }: InferenceChatParams): Promise<string | null> {
  const resolved = resolveModel(agent)
  if (!resolved) return null
  try {
    const result = await generateText({
      model: resolved.model,
      prompt: message,
      ...(system ? { system } : {}),
    })
    return result.text
  } catch (error) {
    const message_ = error instanceof Error ? error.message : "inference call failed"
    throw new Error(`[inference:${resolved.label}] ${message_}`)
  }
}

/**
 * Streamed generation through the inference layer.
 * Returns the streamText result (consume `textStream`, then await `steps`
 * for per-call usage), or null when no model is configured (caller falls
 * back to the AgentRuntime pipeline).
 */
export async function inferenceStream({
  message,
  agent,
  system,
  override,
  history,
}: InferenceChatParams & {
  override?: ResolvedModel | null
  /** Earlier turns of the same conversation, oldest first. The new message is appended after them. */
  history?: Array<{ role: "user" | "assistant"; content: string }>
}) {
  // A per-request override (chosen in the composer) wins over the agent default.
  const resolved = override ?? resolveModel(agent)
  if (!resolved) return null
  const turns = history && history.length > 0 ? [...history, { role: "user" as const, content: message }] : null
  return streamText({
    model: resolved.model,
    ...(turns ? { messages: turns } : { prompt: message }),
    ...(system ? { system } : {}),
  })
}

/** Minimal shape of an AI SDK step we need for telemetry. */
interface TelemetryStep {
  usage: { inputTokens?: number; outputTokens?: number }
  response: { modelId?: string }
}

function sumOrNull(values: Array<number | null>): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null
  return values.reduce<number>((total, v) => total + (v as number), 0)
}

/**
 * Pair each AI SDK step (tokens, from the SDK result) with the Shipyard HTTP
 * call captured for it (cost, timing). Steps and HTTP calls are issued in
 * order, so index pairing holds. Totals are null whenever any call is unknown.
 */
export function collectRunTelemetry(
  steps: TelemetryStep[],
  capture: ShipyardCapture | null,
): RunTelemetry | null {
  if (steps.length === 0) return null
  const calls: RunModelCall[] = steps.map((step, index) => {
    const http = capture?.calls[index] ?? null
    return {
      index,
      model: http?.model ?? step.response?.modelId ?? null,
      provider: http?.provider ?? null,
      startedAt: http?.startedAt ?? null,
      endedAt: http?.endedAt ?? null,
      inputTokens: typeof step.usage?.inputTokens === "number" ? step.usage.inputTokens : null,
      outputTokens: typeof step.usage?.outputTokens === "number" ? step.usage.outputTokens : null,
      costUsd: http?.costUsd ?? null,
    }
  })
  return {
    calls,
    inputTokens: sumOrNull(calls.map((c) => c.inputTokens)),
    outputTokens: sumOrNull(calls.map((c) => c.outputTokens)),
    costUsd: sumOrNull(calls.map((c) => c.costUsd)),
  }
}
