/**
 * Inference Providers
 *
 * Provider-agnostic model access for Dock. Each provider is a thin
 * factory over the Vercel AI SDK, configured from environment variables.
 *
 * Model references use the form `<provider>/<model-id>`, split on the FIRST
 * slash so provider model IDs may themselves contain slashes (e.g.
 * `nous/xiaomi/mimo-v2-pro`).
 *
 * Supported providers:
 *   anthropic  — ANTHROPIC_API_KEY
 *   nous       — NOUS_API_KEY (OpenAI-compatible; any NOUS_BASE_URL override)
 *   ollama     — local OLLAMA_BASE_URL, no key
 *   shipyard   — your own Shipyard Inference gateway (OpenAI-compatible:
 *                cost-routing, failover, telemetry). Set SHIPYARD_INFERENCE_URL.
 */

import type { LanguageModel } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOllama } from "ai-sdk-ollama"
import { OLLAMA_BASE_URL } from "../config"
import { createCapturingFetch, type ShipyardCapture } from "./shipyard-capture"

export type ProviderKey = "anthropic" | "nous" | "ollama" | "shipyard"

export interface ResolvedModel {
  /** The AI SDK language model instance */
  model: LanguageModel
  /** Human-readable label, e.g. "anthropic/claude-sonnet-4-5" */
  label: string
  /** Provider key */
  provider: ProviderKey
  /** Provider model ID (may contain slashes) */
  modelId: string
}

/** Parse `provider/model-id` into its parts. Returns null when malformed. */
export function parseModelRef(ref: string): { provider: string; modelId: string } | null {
  const trimmed = ref.trim()
  const slash = trimmed.indexOf("/")
  if (slash <= 0 || slash === trimmed.length - 1) return null
  return { provider: trimmed.slice(0, slash).toLowerCase(), modelId: trimmed.slice(slash + 1) }
}

// ── Provider factories (lazy — no API keys touched until used) ──────────────

function anthropicModel(modelId: string): LanguageModel {
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return anthropic(modelId)
}

function nousModel(modelId: string): LanguageModel {
  const nous = createOpenAI({
    apiKey: process.env.NOUS_API_KEY,
    baseURL: process.env.NOUS_BASE_URL ?? "https://inference-api.nousresearch.com/v1",
  })
  // .chat() pins /chat/completions — most OpenAI-compatible providers do not
  // implement /responses.
  return nous.chat(modelId)
}

function ollamaModel(modelId: string): LanguageModel {
  const ollama = createOllama({ baseURL: OLLAMA_BASE_URL })
  return ollama(modelId)
}

function shipyardModel(modelId: string, capture?: ShipyardCapture): LanguageModel {
  // Shipyard Inference gateway — OpenAI-compatible front door to the Router
  // (cost-routing, failover, x402 payments, telemetry).
  // With a capture sink, the fetch records per-call cost from x_shipyard and
  // x-shipyard-* headers without changing the bytes the SDK sees.
  const baseURL = process.env.SHIPYARD_INFERENCE_URL ?? "http://127.0.0.1:8787/v1"
  const shipyard = createOpenAI({
    apiKey: process.env.SHIPYARD_INFERENCE_API_KEY ?? "dev-key",
    baseURL,
    ...(capture ? { fetch: createCapturingFetch(baseURL, capture) } : {}),
  })
  return shipyard.chat(modelId)
}

type Factory = (modelId: string, capture?: ShipyardCapture) => LanguageModel

const factories: Record<ProviderKey, Factory> = {
  anthropic: anthropicModel,
  nous: nousModel,
  ollama: ollamaModel,
  shipyard: shipyardModel,
}

/** Environment variable that gates each provider. */
function providerConfigured(provider: ProviderKey): boolean {
  switch (provider) {
    case "anthropic":
      return Boolean(process.env.ANTHROPIC_API_KEY)
    case "nous":
      return Boolean(process.env.NOUS_API_KEY)
    case "ollama":
      // Local, no key — but only when the operator explicitly points at a server.
      return Boolean(process.env.OLLAMA_BASE_URL)
    case "shipyard":
      // Opt-in: only treat the gateway as configured when pointed at one.
      return Boolean(process.env.SHIPYARD_INFERENCE_URL || process.env.SHIPYARD_INFERENCE_API_KEY)
  }
}

export function isProviderKey(value: string): value is ProviderKey {
  return value in factories
}

/** Build a resolved model from a `provider/model-id` reference. */
export function buildModel(ref: string, capture?: ShipyardCapture): ResolvedModel | null {
  const parsed = parseModelRef(ref)
  if (!parsed || !isProviderKey(parsed.provider)) return null
  return {
    model: factories[parsed.provider](parsed.modelId, capture),
    label: ref,
    provider: parsed.provider,
    modelId: parsed.modelId,
  }
}

/** List configured providers (for status endpoints / UI). */
export function listConfiguredProviders(): Array<{
  provider: ProviderKey
  configured: boolean
  note?: string
}> {
  return (Object.keys(factories) as ProviderKey[]).map((provider) => {
    const configured = providerConfigured(provider)
    if (provider === "nous" && !configured) {
      return { provider, configured, note: "Set NOUS_API_KEY to enable" }
    }
    if (provider === "anthropic" && !configured) {
      return { provider, configured, note: "Set ANTHROPIC_API_KEY to enable" }
    }
    if (provider === "ollama" && !configured) {
      return { provider, configured, note: "Set OLLAMA_BASE_URL to enable (local models only)" }
    }
    if (provider === "shipyard" && !configured) {
      return { provider, configured, note: "Set SHIPYARD_INFERENCE_URL to enable (your Shipyard Inference gateway)" }
    }
    return { provider, configured }
  })
}
