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
export function resolveModel(agent?: string): ResolvedModel | null {
  const ref = resolveModelRef(agent)
  if (!ref) return null
  const resolved = buildModel(ref)
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
 * Returns an async iterable of text deltas, or null when no model is
 * configured (caller falls back to the AgentRuntime pipeline).
 */
export async function inferenceStream({
  message,
  agent,
  system,
}: InferenceChatParams): Promise<AsyncIterable<string> | null> {
  const resolved = resolveModel(agent)
  if (!resolved) return null
  const result = streamText({
    model: resolved.model,
    prompt: message,
    ...(system ? { system } : {}),
  })
  return result.textStream
}
