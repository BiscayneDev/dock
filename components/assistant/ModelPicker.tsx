"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"

/** One provider entry from GET /api/models. */
export interface ProviderModels {
  provider: string
  configured: boolean
  note?: string
  models: Array<{ id: string; label: string }>
}

/** Selected model as `provider/model-id`, or null for Auto (agent default). */
export type ModelRef = string | null

export const MODEL_STORAGE_KEY = "dock:model"

/** Model choice survives navigation within the tab (home -> thread). */
export function readStoredModel(): ModelRef {
  try {
    return window.sessionStorage.getItem(MODEL_STORAGE_KEY) || null
  } catch {
    return null
  }
}

export function storeModel(ref: ModelRef) {
  try {
    if (ref) window.sessionStorage.setItem(MODEL_STORAGE_KEY, ref)
    else window.sessionStorage.removeItem(MODEL_STORAGE_KEY)
  } catch {
    // sessionStorage unavailable: the choice simply won't persist.
  }
}

/** Fetch the curated model catalog once. Empty until loaded or on failure. */
export function useModelCatalog(): ProviderModels[] {
  const [providers, setProviders] = useState<ProviderModels[]>([])
  useEffect(() => {
    let cancelled = false
    fetch("/api/models", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { providers?: ProviderModels[] }) => {
        if (!cancelled && Array.isArray(d.providers)) setProviders(d.providers)
      })
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [])
  return providers
}

function labelFor(ref: ModelRef, providers: ProviderModels[]): string {
  if (!ref) return "Auto"
  for (const p of providers) {
    const hit = p.models.find((m) => `${p.provider}/${m.id}` === ref)
    if (hit) return hit.label
  }
  return ref
}

const PROVIDER_TITLES: Record<string, string> = {
  shipyard: "Shipyard Inference",
  anthropic: "Anthropic",
  nous: "Nous Portal",
  ollama: "Ollama (local)",
}

export function ModelPicker({
  providers,
  value,
  onChange,
}: {
  providers: ProviderModels[]
  value: ModelRef
  onChange: (ref: ModelRef) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] hover:bg-white/5"
        style={{ color: "var(--ink-2)" }}
        aria-label="Choose model"
      >
        <span className="font-medium">{labelFor(value, providers)}</span>
        <ChevronDown size={13} style={{ color: "var(--ink-3)" }} />
      </button>
      {open && (
        <div
          className="absolute bottom-full left-0 z-30 mb-2 max-h-96 w-72 overflow-y-auto rounded-[14px] p-1 shadow-2xl"
          style={{ background: "var(--surface-2)", border: "1px solid var(--line-strong)" }}
        >
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
            className="flex w-full items-center justify-between rounded-[10px] px-3 py-2.5 text-left hover:bg-white/5"
          >
            <div>
              <p className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>
                Auto
              </p>
              <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>
                The agent&apos;s default model
              </p>
            </div>
            {value === null && <span className="text-[12px]" style={{ color: "var(--ink-2)" }}>✓</span>}
          </button>
          {providers.map((p) => (
            <div key={p.provider} className="mt-1 border-t pt-1" style={{ borderColor: "var(--line)" }}>
              <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
                {PROVIDER_TITLES[p.provider] ?? p.provider}
              </p>
              {!p.configured && (
                <p className="px-3 pb-2 text-[11px]" style={{ color: "var(--ink-3)", opacity: 0.6 }}>
                  {p.note ?? "Not configured"}
                </p>
              )}
              {p.models.map((m) => {
                const full = `${p.provider}/${m.id}`
                const selected = value === full
                return (
                  <button
                    key={full}
                    type="button"
                    disabled={!p.configured}
                    onClick={() => {
                      onChange(full)
                      setOpen(false)
                    }}
                    className="flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left hover:bg-white/5 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    style={{ opacity: p.configured ? 1 : 0.4 }}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px]" style={{ color: "var(--ink)" }}>
                        {m.label}
                      </p>
                      <p className="truncate text-[11px]" style={{ color: "var(--ink-3)" }}>
                        {full}
                      </p>
                    </div>
                    {selected && <span className="text-[12px]" style={{ color: "var(--ink-2)" }}>✓</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
