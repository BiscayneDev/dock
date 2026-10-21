import { listConfiguredProviders, type ProviderKey } from "@/lib/inference"

export const dynamic = "force-dynamic"

/**
 * Curated model lists for the composer's model picker.
 *
 * EDIT HERE: this is the one place the picker's model list is defined.
 * Only providers that are configured on the server are selectable in the UI.
 * The chat route accepts any model id for a configured provider; this list is
 * just what the picker offers. Only IDs already used in this repo's config
 * examples (.env.example, lib/inference docs) are listed.
 */
const CURATED_MODELS: Record<ProviderKey, Array<{ id: string; label: string }>> = {
  // Shipyard Inference gateway (SHIPYARD_INFERENCE_URL). Default route in .env.example.
  shipyard: [{ id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" }],
  // Anthropic direct (ANTHROPIC_API_KEY).
  anthropic: [
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  // Nous Portal (NOUS_API_KEY).
  nous: [{ id: "xiaomi/mimo-v2-pro", label: "MiMo v2 Pro" }],
  // Local Ollama (OLLAMA_BASE_URL).
  ollama: [
    { id: "qwen3-coder", label: "Qwen3 Coder" },
    { id: "llama3.2", label: "Llama 3.2" },
  ],
}

/** Default model when Shipyard Inference is configured; null otherwise (Auto). */
const SHIPYARD_DEFAULT_MODEL = "shipyard/claude-sonnet-4-5"

export async function GET() {
  const entries = listConfiguredProviders()
  const providers = entries.map((entry) => ({
    provider: entry.provider,
    configured: entry.configured,
    ...(entry.note ? { note: entry.note } : {}),
    models: CURATED_MODELS[entry.provider] ?? [],
  }))
  const shipyardConfigured = entries.some((e) => e.provider === "shipyard" && e.configured)
  return Response.json({
    providers,
    defaultLabel: "Auto",
    defaultModel: shipyardConfigured ? SHIPYARD_DEFAULT_MODEL : null,
  })
}
