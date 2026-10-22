"use client"

import { Suspense, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createBrowserClient } from "@supabase/ssr"
import { WaveBackground } from "@/components/onboarding/WaveBackground"

const CODE_LENGTH = 6

function safeNext(value: string | null): string {
  // Only same-origin relative paths; never an absolute or protocol-relative URL.
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/assistant"
  return value
}

function CodeBoxes({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const digits = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? "")

  function setAt(index: number, char: string) {
    const next = digits.slice()
    next[index] = char
    onChange(next.join("").replace(/\s/g, ""))
  }

  return (
    <div className="flex justify-center gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${CODE_LENGTH}`}
          onChange={(e) => {
            const pasted = e.target.value.replace(/\D/g, "")
            if (pasted.length > 1) {
              // Paste or autofill: spread across the boxes.
              onChange(pasted.slice(0, CODE_LENGTH))
              refs.current[Math.min(pasted.length, CODE_LENGTH) - 1]?.focus()
              return
            }
            setAt(i, pasted)
            if (pasted && i < CODE_LENGTH - 1) refs.current[i + 1]?.focus()
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus()
          }}
          className="h-14 w-11 rounded-[12px] text-center text-[22px] font-semibold outline-none focus:ring-2"
          style={{ background: "var(--surface-0)", border: "1px solid var(--line-strong)", color: "var(--ink)" }}
        />
      ))}
    </div>
  )
}

function LoginInner() {
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNext(params.get("next"))
  // Invite links carry ?invite=<token>. Only with a token can a new account be created.
  const inviteToken = params.get("invite")?.trim() || null
  const [step, setStep] = useState<"email" | "code">("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: !!inviteToken },
    })
    setBusy(false)
    if (error) {
      setError("We couldn't send a code to that address. Check it and try again.")
      return
    }
    setStep("code")
  }

  async function verify(value: string) {
    if (value.length !== CODE_LENGTH || busy) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: value, type: "email" })
    if (error) {
      setBusy(false)
      setError("That code didn't work. Check it, or request a new one.")
      setCode("")
      return
    }
    if (inviteToken) {
      const res = await fetch("/api/invites/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: inviteToken }),
      }).catch(() => null)
      if (!res || !res.ok) {
        setBusy(false)
        setError("This invite is not valid for this email, or it has already been used.")
        return
      }
    }
    setBusy(false)
    router.replace(next)
    router.refresh()
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <WaveBackground />
      <div className="relative z-10 w-full max-w-sm rounded-[18px] p-8" style={{ background: "var(--surface-1)", border: "1px solid var(--line)" }}>
        <p className="text-[13px] font-semibold tracking-wide" style={{ color: "var(--ink-2)" }}>
          ⚓ Dock
        </p>

        {step === "email" ? (
          <form onSubmit={sendCode} className="mt-6 space-y-4">
            <div>
              <h1 className="text-[22px] font-semibold" style={{ color: "var(--ink)" }}>
                Sign in
              </h1>
              <p className="mt-1 text-[13px]" style={{ color: "var(--ink-3)" }}>
                We&apos;ll email you a 6-digit code.
              </p>
            </div>
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-[12px] px-4 py-3 text-[15px] outline-none"
              style={{ background: "var(--surface-0)", border: "1px solid var(--line-strong)", color: "var(--ink)" }}
            />
            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="w-full rounded-[12px] py-3 text-[14px] font-medium disabled:opacity-40"
              style={{ background: "var(--ink)", color: "var(--surface-0)" }}
            >
              {busy ? "Sending…" : "Send code"}
            </button>
          </form>
        ) : (
          <form
            className="mt-6 space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              verify(code).catch(() => null)
            }}
          >
            <div>
              <h1 className="text-[22px] font-semibold" style={{ color: "var(--ink)" }}>
                Enter your code
              </h1>
              <p className="mt-1 text-[13px]" style={{ color: "var(--ink-3)" }}>
                Sent to <span style={{ color: "var(--ink-2)" }}>{email}</span>
              </p>
            </div>
            <CodeBoxes
              value={code}
              disabled={busy}
              onChange={(v) => {
                setCode(v)
                if (v.length === CODE_LENGTH) verify(v).catch(() => null)
              }}
            />
            <div className="flex items-center justify-between text-[13px]" style={{ color: "var(--ink-3)" }}>
              <button type="button" onClick={() => setStep("email")} className="hover:underline">
                Use a different email
              </button>
              <button type="button" onClick={() => sendCode()} disabled={busy} className="hover:underline disabled:opacity-40">
                Send a new code
              </button>
            </div>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-4 text-[13px]" style={{ color: "#f59e0b" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}
