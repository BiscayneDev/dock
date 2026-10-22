"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

// Onboarding (P1): goals, first project, name the Chief of Staff, confirm.
// Each step saves through /api/onboarding. The name is never saved until the user confirms it.

const DEFAULT_NAME = "Vic"
const STEPS = ["Your goal", "First project", "Name your Chief of Staff", "Confirm"] as const

interface WorkspaceState {
  building: string
  mainGoal: string
  projects: Array<{ id: string; name: string; goal: string }>
  chief: { id: string; displayName: string } | null
}

const field = {
  background: "var(--surface-0)",
  border: "1px solid var(--line-strong)",
  color: "var(--ink)",
}

export default function OnboardingPage() {
  const router = useRouter()
  const [loaded, setLoaded] = useState(false)
  const [step, setStep] = useState(0)
  const [building, setBuilding] = useState("")
  const [mainGoal, setMainGoal] = useState("")
  const [projectName, setProjectName] = useState("")
  const [projectGoal, setProjectGoal] = useState("")
  const [chiefName, setChiefName] = useState(DEFAULT_NAME)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/onboarding", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) {
          router.replace("/login?next=/onboarding")
          return null
        }
        return (await r.json()) as WorkspaceState
      })
      .then((s) => {
        if (!s || cancelled) return
        if (s.chief) {
          router.replace("/assistant")
          return
        }
        setBuilding(s.building)
        setMainGoal(s.mainGoal)
        if (s.projects[0]) {
          setProjectName(s.projects[0].name)
          setProjectGoal(s.projects[0].goal)
        }
        setLoaded(true)
      })
      .catch(() => setError("Could not load your workspace. Refresh to try again."))
    return () => {
      cancelled = true
    }
  }, [router])

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

  async function next() {
    setError(null)
    setBusy(true)
    try {
      if (step === 0) {
        await post({ action: "goals", building: building.trim(), mainGoal: mainGoal.trim() })
      } else if (step === 1) {
        await post({ action: "project", name: projectName.trim(), goal: projectGoal.trim() })
      } else if (step === 2) {
        // Check only. Nothing is saved here.
        await post({ action: "check-name", name: chiefName.trim() })
      } else if (step === 3) {
        await post({ action: "chief", name: chiefName.trim() })
        router.replace("/assistant")
        return
      }
      setStep((s) => s + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const canContinue =
    step === 0
      ? building.trim().length > 0 && mainGoal.trim().length > 0
      : step === 1
        ? projectName.trim().length > 0
        : step === 2
          ? chiefName.trim().length > 0
          : true

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--surface-0)", color: "var(--ink-3)" }}>
        {error ?? "Loading…"}
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6" style={{ background: "var(--surface-0)" }}>
      <div className="w-full max-w-[560px] rounded-[18px] p-8" style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold tracking-wide" style={{ color: "var(--ink-2)" }}>
            ⚓ Dock
          </p>
          <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>
            Step {step + 1} of {STEPS.length}
          </p>
        </div>
        <div className="mt-3 flex gap-1.5" aria-hidden>
          {STEPS.map((label, i) => (
            <div key={label} className="h-1 flex-1 rounded-full" style={{ background: i <= step ? "var(--ink)" : "var(--line-strong)" }} />
          ))}
        </div>

        <h1 className="mt-7 text-[22px] font-semibold" style={{ color: "var(--ink)" }}>
          {step === 0 && "What are you building, and what is your main goal?"}
          {step === 1 && "What is the first project you want to launch?"}
          {step === 2 && "Name your Chief of Staff"}
          {step === 3 && "Confirm and start"}
        </h1>

        <div className="mt-5 space-y-4">
          {step === 0 && (
            <>
              <label className="block">
                <span className="text-[13px]" style={{ color: "var(--ink-2)" }}>What are you building?</span>
                <textarea
                  value={building}
                  onChange={(e) => setBuilding(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="A product, a service, a shop, a side project…"
                  className="mt-1.5 w-full rounded-[12px] px-4 py-3 text-[14px] outline-none"
                  style={field}
                />
              </label>
              <label className="block">
                <span className="text-[13px]" style={{ color: "var(--ink-2)" }}>Your main goal in the next 90 days</span>
                <textarea
                  value={mainGoal}
                  onChange={(e) => setMainGoal(e.target.value)}
                  rows={2}
                  maxLength={1000}
                  placeholder="First 20 paying customers"
                  className="mt-1.5 w-full rounded-[12px] px-4 py-3 text-[14px] outline-none"
                  style={field}
                />
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <label className="block">
                <span className="text-[13px]" style={{ color: "var(--ink-2)" }}>Project name</span>
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  maxLength={80}
                  placeholder="Launch v1"
                  className="mt-1.5 w-full rounded-[12px] px-4 py-3 text-[14px] outline-none"
                  style={field}
                />
              </label>
              <label className="block">
                <span className="text-[13px]" style={{ color: "var(--ink-2)" }}>What does done look like?</span>
                <textarea
                  value={projectGoal}
                  onChange={(e) => setProjectGoal(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="Landing page live, first ten sign-ups from the waitlist"
                  className="mt-1.5 w-full rounded-[12px] px-4 py-3 text-[14px] outline-none"
                  style={field}
                />
              </label>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>
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
              <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>
                Suggested: {DEFAULT_NAME}. Nothing is saved until you confirm on the last step.
              </p>
            </>
          )}

          {step === 3 && (
            <div className="space-y-3 rounded-[12px] p-4 text-[14px]" style={{ background: "var(--surface-0)", border: "1px solid var(--line)" }}>
              <p style={{ color: "var(--ink-2)" }}>
                <span style={{ color: "var(--ink-3)" }}>Building:</span> {building.trim()}
              </p>
              <p style={{ color: "var(--ink-2)" }}>
                <span style={{ color: "var(--ink-3)" }}>Goal:</span> {mainGoal.trim()}
              </p>
              <p style={{ color: "var(--ink-2)" }}>
                <span style={{ color: "var(--ink-3)" }}>Project:</span> {projectName.trim()}
              </p>
              <p style={{ color: "var(--ink-2)" }}>
                <span style={{ color: "var(--ink-3)" }}>Chief of Staff:</span> {chiefName.trim()}
              </p>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 text-[13px]" style={{ color: "#f59e0b" }}>
            {error}
          </p>
        )}

        <div className="mt-7 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || busy}
            className="text-[13px] hover:underline disabled:opacity-40"
            style={{ color: "var(--ink-3)" }}
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => next()}
            disabled={busy || !canContinue}
            className="rounded-[12px] px-5 py-2.5 text-[14px] font-medium disabled:opacity-40"
            style={{ background: "var(--ink)", color: "var(--surface-0)" }}
          >
            {busy ? "Saving…" : step === 3 ? `Create ${chiefName.trim() || "Chief of Staff"}` : "Continue"}
          </button>
        </div>
      </div>
    </div>
  )
}
