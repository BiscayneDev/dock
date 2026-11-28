"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Brief, type BriefEntry } from "@/components/onboarding/Brief"
import { writeLaunchArrival } from "@/components/onboarding/LaunchCard"
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

// Chapters give the 11 steps a shape: a reader can see where they are, not just a number.
const CHAPTERS: Record<StepKey, string> = {
  goal: "The venture",
  source: "The venture",
  story: "The venture",
  stage: "Where you stand",
  direction: "Where you stand",
  customer: "The market",
  pricing: "The market",
  acquisition: "The market",
  rules: "Working rules",
  chief: "Chief of Staff",
  review: "Review",
}

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
  const [desktopPane, setDesktopPane] = useState(false)

  const key: StepKey = order[step]

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)")
    const apply = () => setDesktopPane(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])

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
          router.replace("/work")
          return
        }
        setWorkspaceId(s.workspaceId ?? null)
        setDraft(hydrate(s))
        setLoaded(true)
      })
      .catch(() => setError("Could not load your workspace. Refresh to try again."))
    return () => {
      cancelled = true
    }
  }, [router, venture, order.length])

  // Venture draft: saved on every change until Confirm (then cleared in confirmVenture).
  useEffect(() => {
    if (!venture || !loaded || !workspaceId || launched) return
    try {
      window.localStorage.setItem(draftKey(workspaceId), JSON.stringify({ draft, step }))
    } catch {
      // Storage full or blocked: the draft just is not kept across a refresh.
    }
  }, [venture, loaded, workspaceId, launched, draft, step])

  // After a venture is created: show the launch steps, then hand off to Work.
  useEffect(() => {
    if (!launched) return
    const timers = [
      setTimeout(() => setLaunchStage(1), 500),
      setTimeout(() => setLaunchStage(2), 1000),
      setTimeout(() => setLaunchStage(3), 1500),
      setTimeout(() => router.replace("/work"), 2100),
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
    writeLaunchArrival(workspaceId, draft.goal)
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
        writeLaunchArrival(workspaceId, draft.goal)
        router.replace("/work")
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

  const skippable = SKIPPABLE.includes(key)
  const [advanceTick, bumpAdvance] = useState(0)
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRef = useRef<(() => void) | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const autoChoice = key === "source" || key === "story" || key === "stage" || key === "direction" || key === "customer" || key === "acquisition"

  function cancelAdvance() {
    if (advanceTimer.current !== null) clearTimeout(advanceTimer.current)
    advanceTimer.current = null
  }

  function pick(value: string) {
    if (!autoChoice && key !== "pricing") return
    cancelAdvance()
    setAns(key, { choice: value })
    if (autoChoice && value !== OTHER) bumpAdvance((tick) => tick + 1)
  }

  function continueStep() {
    cancelAdvance()
    if (!busy && canContinue()) void saveStep()
  }

  function goBack() {
    cancelAdvance()
    if (editing) {
      setEditing(false)
      moveTo(order.indexOf("review"))
      if (!venture) void refreshFromServer()
    } else if (step > 0) moveTo(step - 1)
  }

  function skipCurrent() {
    cancelAdvance()
    void skipStep()
  }

  async function skipRest() {
    cancelAdvance()
    setError(null)
    setBusy(true)
    try {
      for (const remaining of order.slice(step)) {
        if (!SKIPPABLE.includes(remaining)) continue
        if (!venture) {
          await post(remaining === "rules"
            ? { action: "rules", skipped: true }
            : { action: "answer", step: remaining, skipped: true })
        }
        markSkipped(remaining)
      }
      const destination = venture ? "review" : "chief"
      moveTo(order.indexOf(destination))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.")
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    saveRef.current = continueStep
  })

  useEffect(() => {
    if (!advanceTick) return
    advanceTimer.current = setTimeout(() => saveRef.current?.(), 260)
    return cancelAdvance
  }, [advanceTick])

  useEffect(() => {
    if (loaded && key !== "goal") headingRef.current?.focus({ preventScroll: true })
  }, [key, loaded, launched])

  useEffect(() => {
    if (!loaded || launched) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.repeat) return
      const target = event.target instanceof HTMLElement ? event.target : null
      const textarea = target?.tagName === "TEXTAREA"
      const typing = textarea || target?.tagName === "INPUT" || target?.isContentEditable
      if (event.key === "Enter") {
        if (target?.closest("button, a[href]") || (textarea && event.shiftKey) || target?.isContentEditable) return
        event.preventDefault()
        continueStep()
        return
      }
      if (typing || busy) return
      if (event.key === "Backspace" && (step > 0 || editing)) {
        event.preventDefault()
        goBack()
      } else if (event.key.toLowerCase() === "s" && skippable) {
        event.preventDefault()
        skipCurrent()
      } else if ((autoChoice || key === "pricing") && /^[1-9]$/.test(event.key)) {
        const option = OPTIONS[key][Number(event.key) - 1]
        if (option) {
          event.preventDefault()
          pick(option.value)
        }
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  if (!loaded) return <main className="ob-root"><div className="ob-left"><p className="ob-content" role="status">{error ?? "Loading…"}</p></div></main>

  const total = order.length
  const ready = key === "review" || Boolean(launched)
  const canEdit = key === "review" && !busy && !launched
  const title = venture && key === "goal" ? VENTURE_GOAL_TITLE : STEP_TITLES[key]
  const activeRules = draft.rules.filter((rule) => rule.enabled).length
  const answer = (step: "source" | "story" | "stage" | "direction" | "customer" | "pricing" | "acquisition", label: string): BriefEntry => {
    const a = draft[step]
    const payment = step === "pricing" && optionLabel("payment", draft.payment)
    const value = a.choice && (a.choice !== OTHER || a.other.trim()) ? summarizeAns(step, a) : null
    return { step, label, skipped: a.skipped, value: value && payment ? `${value} · ${payment}` : value }
  }
  const entries: BriefEntry[] = [
    answer("source", "Starting point"), answer("story", "Why"), answer("stage", "Stage"),
    answer("direction", "Direction"), answer("customer", "First customer"), answer("pricing", "Pricing"),
    answer("acquisition", "Acquisition"),
    { step: "rules", label: "Rules", value: `${activeRules} active`, skipped: draft.rulesSkipped },
    { step: "chief", label: "Chief of Staff", value: venture ? `${chiefName.trim()} · existing` : chiefName.trim(), fixed: venture },
  ]
  const brief = <Brief goal={draft.goal.trim()} entries={entries} current={key} order={order} ready={ready} onEdit={canEdit ? editStep : undefined} />

  return (
    <main className="ob-root">
      <div className="ob-left">
        <header className="ob-top">
          <p className="ob-wordmark"><i aria-hidden /> Dock{venture && <span> · New venture</span>}</p>
          <ProgressSegments step={step + 1} total={total} />
        </header>

        <div className="ob-content">
          {launched ? (
            <div key="launch" className="ob-step">
              <p className="ob-kicker">Launching venture</p>
              <h1 className="ob-title" ref={headingRef} tabIndex={-1}>{launched.name}</h1>
              <ol className="ob-checklist ob-body" aria-label="Launch progress">
                {LAUNCH_STAGES.map((text, index) => {
                  const done = launchStage > index
                  const current = launchStage === index
                  return (
                    <li key={text} data-done={done} aria-current={current ? "step" : undefined}>
                      <span className={`ob-stage-icon${current ? " ob-spinner" : ""}`} aria-hidden>
                        {done && <svg viewBox="0 0 16 16" width="12" height="12" fill="none"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      </span>
                      <span>{text}<span className="sr-only">{done ? " (complete)" : current ? " (in progress)" : " (pending)"}</span></span>
                    </li>
                  )
                })}
              </ol>
              <div className="ob-inline">{brief}</div>
            </div>
          ) : (
            <div key={key} className="ob-step">
              <p className="ob-kicker">{String(step + 1).padStart(2, "0")} / {String(total).padStart(2, "0")} <span aria-hidden>·</span> {CHAPTERS[key]}</p>
              <h1 id="ob-question" className="ob-title" ref={headingRef} tabIndex={-1}>{title}</h1>
              <div className="ob-body">
                {key === "goal" && (
                  <>
                    <textarea className="ob-goal" aria-labelledby="ob-question" aria-describedby="ob-goal-help" autoFocus rows={3} maxLength={300}
                      placeholder="A booking app that fills empty chairs for independent barbers" value={draft.goal}
                      onChange={(e) => setDraft((d) => ({ ...d, goal: e.target.value }))} />
                    <div className="ob-goal-meta">
                      <p className="ob-help" id="ob-goal-help">Saved as the venture&apos;s goal.</p>
                      <span className="ob-counter">{draft.goal.length}/300</span>
                    </div>
                  </>
                )}
                {autoChoice && (
                  <>
                    <Choice options={OPTIONS[key]} value={draft[key].choice} onPick={pick} labelledBy="ob-question" shortcuts disabled={busy} />
                    {draft[key].choice === OTHER && <OtherInput value={draft[key].other} onChange={(other) => setAns(key, { other })} disabled={busy} />}
                    {key === "source" && <p className="ob-help">GitHub import is not built yet. You&apos;ll start blank for now.</p>}
                  </>
                )}
                {key === "pricing" && (
                  <>
                    <fieldset className="ob-group">
                      <legend id="ob-charge" className="ob-group-title">How will the product charge?</legend>
                      <Choice options={OPTIONS.pricing} value={draft.pricing.choice} onPick={pick} labelledBy="ob-charge" shortcuts disabled={busy} />
                      {draft.pricing.choice === OTHER && <OtherInput value={draft.pricing.other} onChange={(other) => setAns("pricing", { other })} disabled={busy} />}
                    </fieldset>
                    <fieldset className="ob-group">
                      <legend id="ob-payment" className="ob-group-title">How do customers pay?</legend>
                      <Choice options={OPTIONS.payment} value={draft.payment} labelledBy="ob-payment" disabled={busy}
                        onPick={(payment) => setDraft((d) => ({ ...d, payment, pricing: { ...d.pricing, skipped: false } }))} />
                    </fieldset>
                    {(draft.payment === "usdc" || draft.payment === "both") && <p className="ob-note"><strong>Note</strong> {PAYMENT_NOTE}</p>}
                  </>
                )}
                {key === "rules" && (
                  <>
                    <p className="ob-help">Rules override requests an agent receives. Turn off any rule you don&apos;t want to keep.</p>
                    <div className="ob-rules">
                      {PRESET_RULES.map((preset) => {
                        const rule = draft.rules.find((r) => r.presetKey === preset.key)
                        return (
                          <div className="ob-rule" key={preset.key}>
                            <span id={`ob-rule-${preset.key}`}>{preset.text}</span>
                            <Switch labelledBy={`ob-rule-${preset.key}`} checked={rule?.enabled === true} disabled={busy}
                              onToggle={() => setDraft((d) => ({ ...d, rulesSkipped: false, rules: rule
                                ? d.rules.map((r) => r.presetKey === preset.key ? { ...r, enabled: !r.enabled } : r)
                                : [...d.rules, { presetKey: preset.key, text: preset.text, enabled: true }] }))} />
                          </div>
                        )
                      })}
                      {draft.rules.map((rule, index) => rule.presetKey === null && (
                        <div className="ob-rule" key={`${index}-${rule.text}`}>
                          <span>{rule.text}</span>
                          <button className="ob-link" type="button" disabled={busy} aria-label={`Remove rule: ${rule.text}`}
                            onClick={() => setDraft((d) => ({ ...d, rules: d.rules.filter((_, i) => i !== index) }))}>Remove</button>
                        </div>
                      ))}
                    </div>
                    <div className="ob-custom">
                      <input className="ob-input" aria-label="Add your own rule" placeholder="Add your own rule" maxLength={MAX_RULE_LENGTH}
                        value={customRule} disabled={busy} onChange={(e) => setCustomRule(e.target.value)} onKeyDown={(e) => {
                          if (e.key !== "Enter" || e.nativeEvent.isComposing) return
                          e.preventDefault()
                          e.stopPropagation()
                          addCustomRule()
                        }} />
                      <button className="ob-button" type="button" onClick={addCustomRule} disabled={busy || !customRule.trim() || draft.rules.filter((r) => r.presetKey === null).length >= MAX_CUSTOM_RULES}>Add</button>
                    </div>
                  </>
                )}
                {key === "chief" && (
                  <>
                    <p className="ob-help">Your Chief of Staff is the one agent you talk to directly. Other agents are reached through them. Names must be unique in your workspace.</p>
                    <input className="ob-input" aria-label="Chief of Staff name" maxLength={24} value={chiefName} onChange={(e) => setChiefName(e.target.value)} disabled={busy} />
                    <p className="ob-help">Suggested: {DEFAULT_CHIEF_NAME}. The name is saved when you confirm.</p>
                  </>
                )}
                {key === "review" && (
                  <>
                    <p className="ob-help">Select an entry in the brief to change it before you confirm.</p>
                    <div className="ob-inline">{brief}</div>
                  </>
                )}
              </div>
              {error && <p className="ob-error" role="alert">{error}</p>}
              <div className="ob-actions">
                {((step > 0) || editing) && <button className="ob-button" type="button" onClick={goBack} disabled={busy}>{editing ? "Cancel" : "Back"}</button>}
                <div className="ob-secondary">
                  {skippable && <button className="ob-link" type="button" onClick={skipCurrent} disabled={busy}>Skip</button>}
                  <button className="ob-button" data-primary="true" type="button" onClick={continueStep} disabled={busy || !canContinue()}>
                    {busy ? "Saving…" : key === "review" ? (venture ? "Confirm and launch venture" : `Confirm and create ${chiefName.trim() || "Chief of Staff"}`) : editing ? "Save and review" : "Continue"}
                  </button>
                </div>
              </div>
              {skippable && !editing && <button className="ob-link ob-skip-rest" type="button" disabled={busy} onClick={skipRest}>Skip the rest — agent decides</button>}
            </div>
          )}
        </div>

        {!launched && <footer className="ob-hints"><span><Kbd>↵</Kbd> continue</span>{step > 0 && <span><Kbd>⌫</Kbd> back</span>}{skippable && <span><Kbd>S</Kbd> skip</span>}{(autoChoice || key === "pricing") && <span><Kbd>1–9</Kbd> select</span>}</footer>}
      </div>
      <aside className="ob-desktop">
        {desktopPane && <WaveBackground contained scrim="pane" />}
        {brief}
      </aside>
    </main>
  )
}

function ProgressSegments({ step, total }: { step: number; total: number }) {
  return (
    <div className="ob-progress" role="progressbar" aria-label="Onboarding progress" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step}>
      {Array.from({ length: total }, (_, i) => <span key={i} data-filled={i < step} />)}
    </div>
  )
}

function Kbd({ children }: { children: string }) {
  return <kbd className="ob-kbd">{children}</kbd>
}

function Choice({ options, value, onPick, labelledBy, shortcuts, disabled }: {
  options: Option[]; value: string | null; onPick: (value: string) => void; labelledBy: string; shortcuts?: boolean; disabled: boolean
}) {
  return (
    <div className="ob-options" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((option, index) => (
        <button type="button" role="radio" aria-checked={option.value === value} disabled={disabled} key={option.value}
          className="ob-choice" onClick={() => onPick(option.value)}>
          <span className="ob-ring" aria-hidden />
          <span className="ob-option-label">{option.label}</span>
          {option.recommended && <span className="ob-recommended">Recommended</span>}
          {shortcuts && <span aria-hidden><Kbd>{String(index + 1)}</Kbd></span>}
        </button>
      ))}
    </div>
  )
}

function OtherInput({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  return <input className="ob-input" aria-label="Something else" placeholder="Tell us in a few words" maxLength={300} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
}

function Switch({ checked, onToggle, labelledBy, disabled }: { checked: boolean; onToggle: () => void; labelledBy: string; disabled: boolean }) {
  return <button type="button" className="ob-switch" role="switch" aria-checked={checked} aria-labelledby={labelledBy} disabled={disabled} onClick={onToggle}><span aria-hidden /></button>
}
