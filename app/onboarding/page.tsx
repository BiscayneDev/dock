"use client"

import { Suspense, useEffect, useState, type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { WaveBackground } from "@/components/onboarding/WaveBackground"
import {
  DEFAULT_CHIEF_NAME,
  MAX_CUSTOM_RULES,
  MAX_RULE_LENGTH,
  OPTIONS,
  OTHER,
  PAYMENT_NOTE,
  PRESET_RULES,
  SKIPPABLE,
  STEP_ORDER,
  STEP_TITLES,
  optionLabel,
  type Option,
  type StepKey,
} from "@/lib/onboarding-spec"

// Onboarding: ten questions plus a review screen. Each answer saves when the user moves forward.
// Skip stores null with skipped=true (the agent decides later). The Chief of Staff name is only
// saved on Confirm, and only after a uniqueness check.
//
// Venture mode (/onboarding?mode=venture): the same questions for a NEW project in the workspace.
// The Chief of Staff step is skipped (the existing Chief is used), nothing is saved until Confirm,
// and Confirm creates the project with its own answers and rules in one request.

type Ans = { choice: string | null; other: string; skipped: boolean }
type Rule = { presetKey: string | null; text: string; enabled: boolean }
type Draft = {
  goal: string
  source: Ans
  story: Ans
  stage: Ans
  direction: Ans
  customer: Ans
  pricing: Ans
  payment: string | null
  acquisition: Ans
  rules: Rule[]
  rulesSkipped: boolean
}
type Answered = { choice: string | null; other: string | null; skipped: boolean }
type ServerState = {
  workspaceId?: string
  chief: { id: string; displayName: string } | null
  profile: null | {
    goal: string | null
    source: Answered
    story: Answered
    stage: Answered
    direction: Answered
    customer: Answered
    pricing: Answered & { payment: string | null }
    acquisition: Answered
    rulesSkipped: boolean
  }
  rules: Array<{ presetKey: string | null; text: string; enabled: boolean }>
}
type Launched = { projectId: string; name: string; conversationId: string | null }

// Venture drafts survive a refresh: kept in this browser only, per workspace. Cleared on Confirm.
const DRAFT_VERSION = 1
function draftKey(workspaceId: string): string {
  return `dock:venture-draft:v${DRAFT_VERSION}:${workspaceId}`
}
function readDraft(workspaceId: string): { draft: Draft; step: number } | null {
  try {
    const raw = window.localStorage.getItem(draftKey(workspaceId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { draft?: Draft; step?: number }
    if (!parsed.draft || typeof parsed.draft !== "object") return null
    return { draft: parsed.draft, step: typeof parsed.step === "number" ? parsed.step : 0 }
  } catch {
    return null
  }
}

// Recommended defaults shown before a value is saved. Other questions have no default.
const DEFAULTS: Record<string, string> = { source: "blank", direction: "carry_on" }
const DEFAULT_PAYMENT = "usdc"
const VENTURE_GOAL_TITLE = "What is the new venture, in one sentence?"
const LAUNCH_STAGES = ["Goal and answers saved", "Rules set for this venture", "Handing it to your Chief of Staff"]

function ans(a: Answered | undefined, key: string): Ans {
  if (!a) return { choice: DEFAULTS[key] ?? null, other: "", skipped: false }
  if (a.skipped) return { choice: null, other: "", skipped: true }
  return { choice: a.choice ?? DEFAULTS[key] ?? null, other: a.other ?? "", skipped: false }
}

function hydrate(s: ServerState): Draft {
  const p = s.profile
  let rules: Rule[]
  if (s.rules.length > 0) {
    rules = s.rules.map((r) => ({ presetKey: r.presetKey, text: r.text, enabled: r.enabled }))
  } else if (p?.rulesSkipped) {
    rules = []
  } else {
    rules = PRESET_RULES.map((r) => ({ presetKey: r.key, text: r.text, enabled: true }))
  }
  return {
    goal: p?.goal ?? "",
    source: ans(p?.source, "source"),
    story: ans(p?.story, "story"),
    stage: ans(p?.stage, "stage"),
    direction: ans(p?.direction, "direction"),
    customer: ans(p?.customer, "customer"),
    pricing: ans(p?.pricing, "pricing"),
    payment: p?.pricing.skipped ? null : (p?.pricing.payment ?? DEFAULT_PAYMENT),
    acquisition: ans(p?.acquisition, "acquisition"),
    rules,
    rulesSkipped: p?.rulesSkipped ?? false,
  }
}

const EMPTY_DRAFT = hydrate({ chief: null, profile: null, rules: [] })

const field = {
  background: "var(--surface-0)",
  border: "1px solid var(--line-strong)",
  color: "var(--ink)",
}

const label = { color: "var(--ink-2)" }
const hint = { color: "var(--ink-3)" }

function summarizeAns(group: string, a: Ans): string {
  if (a.skipped) return "Skipped: agent decides"
  if (!a.choice) return "Not answered"
  if (a.choice === OTHER) return `Something else: ${a.other}`
  return optionLabel(group, a.choice) ?? a.choice
}

function ansBody(a: Ans): Record<string, unknown> {
  return a.skipped ? { skipped: true } : { choice: a.choice, other: a.other }
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingFlow />
    </Suspense>
  )
}

function OnboardingFlow() {
  const router = useRouter()
  const venture = useSearchParams().get("mode") === "venture"
  const order: StepKey[] = venture ? STEP_ORDER.filter((k) => k !== "chief") : STEP_ORDER

  const [loaded, setLoaded] = useState(false)
  const [step, setStep] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [chiefName, setChiefName] = useState(DEFAULT_CHIEF_NAME)
  const [customRule, setCustomRule] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [launched, setLaunched] = useState<Launched | null>(null)
  const [launchStage, setLaunchStage] = useState(0)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)

  const key: StepKey = order[step]

  useEffect(() => {
    let cancelled = false
    const signIn = venture ? "/login?next=/onboarding?mode=venture" : "/login?next=/onboarding"
    fetch("/api/onboarding", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) {
          router.replace(signIn)
          return null
        }
        return (await r.json()) as ServerState
      })
      .then((s) => {
        if (!s || cancelled) return
        if (venture) {
          // Venture mode needs a Chief of Staff. Without one, the first-run flow names one first.
          if (!s.chief) {
            router.replace("/onboarding")
            return
          }
          setChiefName(s.chief.displayName)
          // Restore the venture draft saved in this browser (if any) so a refresh keeps the answers.
          const saved = s.workspaceId ? readDraft(s.workspaceId) : null
          if (saved) {
            setDraft(saved.draft)
            setStep(Math.min(Math.max(saved.step, 0), order.length - 1))
          } else {
            setDraft(EMPTY_DRAFT)
          }
          setWorkspaceId(s.workspaceId ?? null)
          setLoaded(true)
          return
        }
        if (s.chief) {
          router.replace("/assistant")
          return
        }
        setDraft(hydrate(s))
        setLoaded(true)
      })
      .catch(() => setError("Could not load your workspace. Refresh to try again."))
    return () => {
      cancelled = true
    }
  }, [router, venture])

  // Venture draft: saved on every change until Confirm (then cleared in confirmVenture).
  useEffect(() => {
    if (!venture || !loaded || !workspaceId || launched) return
    try {
      window.localStorage.setItem(draftKey(workspaceId), JSON.stringify({ draft, step }))
    } catch {
      // Storage full or blocked: the draft just is not kept across a refresh.
    }
  }, [venture, loaded, workspaceId, launched, draft, step])

  // After a venture is created: show the launch steps, then open its chat (the Chief's introduction).
  useEffect(() => {
    if (!launched) return
    const next = launched.conversationId
      ? `/assistant?id=${encodeURIComponent(launched.conversationId)}`
      : `/assistant?prefill=${encodeURIComponent(`Working on ${launched.name}: `)}`
    const timers = [
      setTimeout(() => setLaunchStage(1), 500),
      setTimeout(() => setLaunchStage(2), 1000),
      setTimeout(() => setLaunchStage(3), 1500),
      setTimeout(() => router.replace(next), 2100),
    ]
    return () => timers.forEach(clearTimeout)
  }, [launched, router])

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) throw new Error(data.error ?? "Something went wrong. Try again.")
    return data
  }

  // First-run review shows what is saved on the server, not what is typed locally.
  // Venture drafts are not saved yet, so there is nothing to reload.
  async function refreshFromServer() {
    const res = await fetch("/api/onboarding", { cache: "no-store" })
    if (!res.ok) return
    const s = (await res.json()) as ServerState
    setDraft((d) => ({ ...hydrate(s), goal: s.profile?.goal ?? d.goal }))
  }

  function moveTo(index: number) {
    setError(null)
    setStep(index)
  }

  function afterSave() {
    if (editing) {
      setEditing(false)
      moveTo(order.indexOf("review"))
      if (!venture) void refreshFromServer()
    } else {
      moveTo(step + 1)
      if (!venture && order[step + 1] === "review") void refreshFromServer()
    }
  }

  function setAns(group: keyof Draft, patch: Partial<Ans>) {
    setDraft((d) => ({ ...d, [group]: { ...(d[group] as Ans), ...patch, skipped: false } }))
  }

  function markSkipped(k: StepKey) {
    if (k === "rules") setDraft((d) => ({ ...d, rules: [], rulesSkipped: true }))
    else if (k === "pricing") setDraft((d) => ({ ...d, pricing: { choice: null, other: "", skipped: true }, payment: null }))
    else setDraft((d) => ({ ...d, [k]: { choice: null, other: "", skipped: true } }))
  }

  // Venture: every answer goes in one request at Confirm.
  async function confirmVenture() {
    const steps = {
      goal: { text: draft.goal.trim() },
      source: ansBody(draft.source),
      story: ansBody(draft.story),
      stage: ansBody(draft.stage),
      direction: ansBody(draft.direction),
      customer: ansBody(draft.customer),
      pricing: { ...ansBody(draft.pricing), payment: draft.payment },
      acquisition: ansBody(draft.acquisition),
    }
    const rules = draft.rulesSkipped
      ? { skipped: true }
      : { items: draft.rules.map((r) => ({ presetKey: r.presetKey, text: r.text, enabled: r.enabled })) }
    const data = (await post({ action: "venture", steps, rules })) as unknown as Launched
    // Confirmed: the saved draft is no longer needed.
    try {
      if (workspaceId) window.localStorage.removeItem(draftKey(workspaceId))
    } catch {
      // Nothing to clear if storage is blocked.
    }
    setLaunched({ projectId: data.projectId, name: data.name, conversationId: data.conversationId ?? null })
  }

  async function saveStep() {
    setError(null)
    if (venture && key !== "review") {
      afterSave()
      return
    }
    setBusy(true)
    try {
      if (key === "review") {
        if (venture) {
          await confirmVenture()
          return
        }
        await post({ action: "chief", name: chiefName.trim() })
        router.replace("/assistant")
        return
      }
      if (key === "goal") {
        await post({ action: "answer", step: "goal", text: draft.goal.trim() })
      } else if (key === "chief") {
        // Check only. The name is saved on Confirm.
        await post({ action: "check-name", name: chiefName.trim() })
      } else if (key === "rules") {
        await post({
          action: "rules",
          items: draft.rules.map((r) => ({ presetKey: r.presetKey, text: r.text, enabled: r.enabled })),
        })
      } else if (key === "pricing") {
        await post({
          action: "answer",
          step: "pricing",
          choice: draft.pricing.choice,
          other: draft.pricing.other,
          payment: draft.payment,
        })
      } else {
        const a = draft[key] as Ans
        await post({ action: "answer", step: key, choice: a.choice, other: a.other })
      }
      afterSave()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function skipStep() {
    setError(null)
    if (venture) {
      markSkipped(key)
      afterSave()
      return
    }
    setBusy(true)
    try {
      if (key === "rules") {
        await post({ action: "rules", skipped: true })
      } else if (key === "pricing") {
        await post({ action: "answer", step: "pricing", skipped: true })
      } else {
        await post({ action: "answer", step: key, skipped: true })
      }
      markSkipped(key)
      afterSave()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.")
    } finally {
      setBusy(false)
    }
  }

  function canContinue(): boolean {
    if (key === "goal") return draft.goal.trim().length > 0
    if (key === "chief") return chiefName.trim().length > 0
    if (key === "rules" || key === "review") return true
    if (key === "pricing") {
      const priceOk = draft.pricing.choice !== null && (draft.pricing.choice !== OTHER || draft.pricing.other.trim().length > 0)
      return priceOk && draft.payment !== null
    }
    const a = draft[key] as Ans
    return a.choice !== null && (a.choice !== OTHER || a.other.trim().length > 0)
  }

  function addCustomRule() {
    const text = customRule.trim().slice(0, MAX_RULE_LENGTH)
    const customCount = draft.rules.filter((r) => r.presetKey === null).length
    if (!text || customCount >= MAX_CUSTOM_RULES) return
    setDraft((d) => ({ ...d, rulesSkipped: false, rules: [...d.rules, { presetKey: null, text, enabled: true }] }))
    setCustomRule("")
  }

  function editStep(k: StepKey) {
    setEditing(true)
    moveTo(order.indexOf(k))
  }

  if (!loaded) {
    return (
      <div className="relative flex min-h-screen items-center justify-center" style={{ color: "var(--ink-3)" }}>
        <WaveBackground />
        <span className="relative z-10">{error ?? "Loading…"}</span>
      </div>
    )
  }

  if (launched) {
    const rulesLine = draft.rulesSkipped
      ? "Rules skipped: the agent decides"
      : `${draft.rules.filter((r) => r.enabled).length} active rule${draft.rules.filter((r) => r.enabled).length === 1 ? "" : "s"}`
    return (
      <div className="relative flex min-h-screen items-center justify-center p-6">
        <WaveBackground />
        <div className="relative z-10 w-full max-w-[600px] rounded-[18px] p-6 sm:p-8" style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
          <p className="text-[12px] uppercase tracking-[0.18em]" style={hint}>
            Launching
          </p>
          <h1 className="mt-3 break-words text-[22px] font-semibold" style={{ color: "var(--ink)" }}>
            {launched.name}
          </h1>
          <ul className="mt-6 space-y-3 text-[14px]" style={{ color: "var(--ink-2)" }}>
            {LAUNCH_STAGES.map((text, i) => {
              const done = launchStage > i
              return (
                <li key={text} className="flex items-center gap-3" style={{ opacity: done ? 1 : 0.4 }}>
                  <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full text-[11px]" style={{ border: "1px solid var(--line-strong)", color: "var(--ink)" }}>
                    {done ? "✓" : ""}
                  </span>
                  <span>{i === 1 ? `${text}: ${rulesLine}` : text}</span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    )
  }

  const isQuestion = (SKIPPABLE as StepKey[]).includes(key)
  const total = order.length
  const title = venture && key === "goal" ? VENTURE_GOAL_TITLE : STEP_TITLES[key]

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4 sm:p-6">
      <WaveBackground />
      <div className="relative z-10 w-full max-w-[600px] rounded-[18px] p-5 sm:p-8" style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-semibold tracking-wide" style={{ color: "var(--ink-2)" }}>
            ⚓ Dock{venture ? " · Launch a venture" : ""}
          </p>
          <p className="shrink-0 text-[12px]" style={{ color: "var(--ink-3)" }}>
            {step + 1} of {total}
          </p>
        </div>
        <div className="mt-3 flex gap-1" aria-hidden>
          {order.map((k, i) => (
            <div key={k} className="h-1 flex-1 rounded-full" style={{ background: i <= step ? "var(--ink)" : "var(--line-strong)" }} />
          ))}
        </div>

        {venture && (
          <p className="mt-7 text-[12px] uppercase tracking-[0.18em]" style={hint}>
            Launch a venture: new project
          </p>
        )}
        <h1 className={`${venture ? "mt-2" : "mt-7"} text-[22px] font-semibold`} style={{ color: "var(--ink)" }}>
          {title}
        </h1>

        <div className="mt-5 space-y-4">
          {key === "goal" && (
            <label className="block">
              <span className="text-[13px]" style={label}>
                One sentence: what are you building, and for whom?
              </span>
              <textarea
                value={draft.goal}
                onChange={(e) => setDraft((d) => ({ ...d, goal: e.target.value }))}
                rows={3}
                maxLength={300}
                placeholder="A booking app that fills empty chairs for independent barbers"
                className="mt-1.5 w-full rounded-[12px] px-4 py-3 text-[14px] outline-none"
                style={field}
              />
            </label>
          )}

          {key === "source" && (
            <>
              <Choice options={OPTIONS.source} value={draft.source.choice} onPick={(v) => setAns("source", { choice: v })} />
              {draft.source.choice === "github" && (
                <p className="text-[12px]" style={hint}>
                  {OPTIONS.source[1].hint}
                </p>
              )}
            </>
          )}

          {(key === "story" || key === "stage" || key === "direction" || key === "customer" || key === "acquisition") && (
            <Pick group={key} value={draft[key]} onChange={(patch) => setAns(key, patch)} />
          )}

          {key === "rules" && (
            <div className="space-y-3">
              <p className="text-[13px]" style={hint}>
                Rules override any request an agent receives. Uncheck a rule to turn it off.
              </p>
              {PRESET_RULES.map((preset) => {
                const rule = draft.rules.find((r) => r.presetKey === preset.key)
                const checked = rule?.enabled === true
                return (
                  <label key={preset.key} className="flex items-start gap-3 rounded-[12px] p-3 text-[14px]" style={{ border: "1px solid var(--line)", color: "var(--ink-2)" }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          rulesSkipped: false,
                          rules: d.rules.map((r) => (r.presetKey === preset.key ? { ...r, enabled: e.target.checked } : r)),
                        }))
                      }
                      className="mt-1"
                    />
                    <span>{preset.text}</span>
                  </label>
                )
              })}
              {draft.rules
                .map((r, i) => ({ r, i }))
                .filter(({ r }) => r.presetKey === null)
                .map(({ r, i }) => (
                  <div key={i} className="flex items-start gap-3 rounded-[12px] p-3 text-[14px]" style={{ border: "1px solid var(--line)", color: "var(--ink-2)" }}>
                    <span className="flex-1">{r.text}</span>
                    <button
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, rules: d.rules.filter((_, j) => j !== i) }))}
                      className="text-[12px] hover:underline"
                      style={hint}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              <div className="flex gap-2">
                <input
                  value={customRule}
                  onChange={(e) => setCustomRule(e.target.value)}
                  maxLength={MAX_RULE_LENGTH}
                  aria-label="Add your own rule"
                  placeholder="Add your own rule"
                  className="min-w-0 flex-1 rounded-[12px] px-4 py-2.5 text-[14px] outline-none"
                  style={field}
                />
                <button
                  type="button"
                  onClick={addCustomRule}
                  disabled={!customRule.trim()}
                  className="shrink-0 rounded-[12px] px-4 text-[13px] disabled:opacity-40"
                  style={{ border: "1px solid var(--line-strong)", color: "var(--ink)" }}
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {key === "pricing" && (
            <>
              <p className="text-[13px] font-medium" style={label}>
                How will the product charge?
              </p>
              <Choice options={OPTIONS.pricing} value={draft.pricing.choice} onPick={(v) => setAns("pricing", { choice: v })} />
              {draft.pricing.choice === OTHER && (
                <OtherInput value={draft.pricing.other} onChange={(v) => setAns("pricing", { other: v })} />
              )}
              <p className="pt-2 text-[13px] font-medium" style={label}>
                How do customers pay?
              </p>
              <Choice
                options={OPTIONS.payment}
                value={draft.payment}
                onPick={(v) => setDraft((d) => ({ ...d, payment: v, pricing: { ...d.pricing, skipped: false } }))}
              />
              {(draft.payment === "usdc" || draft.payment === "both") && (
                <p className="rounded-[12px] p-3 text-[12px]" style={{ background: "var(--surface-0)", border: "1px solid var(--line)", color: "var(--ink-3)" }}>
                  {PAYMENT_NOTE}
                </p>
              )}
            </>
          )}

          {key === "chief" && (
            <>
              <p className="text-[13px]" style={hint}>
                Your Chief of Staff is the one agent you talk to directly. Other agents are reached through them. Names must be unique in your workspace.
              </p>
              <input
                value={chiefName}
                onChange={(e) => setChiefName(e.target.value)}
                maxLength={24}
                aria-label="Chief of Staff name"
                className="w-full rounded-[12px] px-4 py-3 text-[15px] outline-none"
                style={field}
              />
              <p className="text-[12px]" style={hint}>
                Suggested: {DEFAULT_CHIEF_NAME}. Nothing is saved until you confirm on the last step.
              </p>
            </>
          )}

          {key === "review" && (
            <div className="space-y-2 rounded-[12px] p-4 text-[14px]" style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}>
              <ReviewRow title={venture ? "New venture" : STEP_TITLES.goal} value={draft.goal.trim() || "Not set"} onEdit={() => editStep("goal")} />
              <ReviewRow title="Source" value={summarizeAns("source", draft.source)} onEdit={() => editStep("source")} />
              <ReviewRow title="Story" value={summarizeAns("story", draft.story)} onEdit={() => editStep("story")} />
              <ReviewRow title="Stage" value={summarizeAns("stage", draft.stage)} onEdit={() => editStep("stage")} />
              <ReviewRow title="Direction" value={summarizeAns("direction", draft.direction)} onEdit={() => editStep("direction")} />
              <ReviewRow title="First customer" value={summarizeAns("customer", draft.customer)} onEdit={() => editStep("customer")} />
              <ReviewRow
                title="Pricing and payments"
                value={
                  draft.pricing.skipped
                    ? "Skipped: agent decides"
                    : `${summarizeAns("pricing", draft.pricing)}; paid by ${optionLabel("payment", draft.payment) ?? "not set"}`
                }
                onEdit={() => editStep("pricing")}
              />
              <ReviewRow title="Acquisition" value={summarizeAns("acquisition", draft.acquisition)} onEdit={() => editStep("acquisition")} />
              <ReviewRow
                title="Rules"
                value={
                  draft.rulesSkipped
                    ? "Skipped: agent decides"
                    : draft.rules.filter((r) => r.enabled).map((r) => r.text).join("; ") || "None active"
                }
                onEdit={() => editStep("rules")}
              />
              {venture ? (
                <ReviewRow title="Chief of Staff (existing)" value={chiefName.trim()} />
              ) : (
                <ReviewRow title="Chief of Staff" value={chiefName.trim()} onEdit={() => editStep("chief")} />
              )}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 text-[13px]" style={{ color: "#f59e0b" }}>
            {error}
          </p>
        )}

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => moveTo(Math.max(0, step - 1))}
            disabled={step === 0 || busy}
            className="text-[13px] hover:underline disabled:opacity-40"
            style={{ color: "var(--ink-3)" }}
          >
            Back
          </button>
          <div className="flex flex-wrap items-center justify-end gap-3 sm:gap-4">
            {isQuestion && (
              <button
                type="button"
                onClick={() => skipStep()}
                disabled={busy}
                className="text-[13px] hover:underline disabled:opacity-40"
                style={{ color: "var(--ink-3)" }}
              >
                Skip: agent decides
              </button>
            )}
            <button
              type="button"
              onClick={() => saveStep()}
              disabled={busy || !canContinue()}
              className="rounded-[12px] px-5 py-2.5 text-[14px] font-medium disabled:opacity-40"
              style={{ background: "var(--ink)", color: "var(--surface-0)" }}
            >
              {busy
                ? "Saving…"
                : key === "review"
                  ? venture
                    ? "Confirm and launch venture"
                    : `Confirm and create ${chiefName.trim() || "Chief of Staff"}`
                  : editing
                    ? "Save and review"
                    : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Pick({ group, value, onChange }: { group: string; value: Ans; onChange: (patch: Partial<Ans>) => void }) {
  return (
    <>
      <Choice options={OPTIONS[group]} value={value.choice} onPick={(v) => onChange({ choice: v, skipped: false })} />
      {value.choice === OTHER && <OtherInput value={value.other} onChange={(v) => onChange({ other: v })} />}
    </>
  )
}

function Choice({ options, value, onPick }: { options: Option[]; value: string | null; onPick: (v: string) => void }) {
  return (
    <div role="radiogroup" className="space-y-2">
      {options.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(o.value)}
            className="flex w-full items-center justify-between gap-3 rounded-[12px] px-4 py-3 text-left text-[14px]"
            style={{
              background: active ? "var(--surface-2)" : "var(--surface-0)",
              border: `1px solid ${active ? "var(--ink-2)" : "var(--line)"}`,
              color: "var(--ink)",
            }}
          >
            <span>{o.label}</span>
            {o.recommended && (
              <span className="shrink-0 text-[11px] uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
                Recommended
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function OtherInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={300}
      aria-label="Something else"
      placeholder="Tell us in a few words"
      className="w-full rounded-[12px] px-4 py-3 text-[14px] outline-none"
      style={field}
    />
  )
}

function ReviewRow({ title, value, onEdit }: { title: string; value: string; onEdit?: () => void }): ReactNode {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="min-w-0">
        <p className="text-[12px]" style={hint}>
          {title}
        </p>
        <p className="break-words" style={{ color: "var(--ink-2)" }}>
          {value}
        </p>
      </div>
      {onEdit && (
        <button type="button" onClick={onEdit} className="shrink-0 text-[12px] hover:underline" style={{ color: "var(--ink-3)" }}>
          Edit
        </button>
      )}
    </div>
  )
}
