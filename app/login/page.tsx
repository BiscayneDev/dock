"use client"

import { DockEntry } from "@/components/DockEntry"
import { Suspense, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createBrowserClient } from "@supabase/ssr"

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
    <div className="grid grid-cols-6 gap-2">
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
          className="dock-entry-input px-0 text-center font-mono tabular-nums"
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
  const [error, setError] = useState<string | null>(
    params.get("denied") ? "That email isn't on this workspace's access list. Ask the owner for an invite." : null,
  )

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
      setError(
        inviteToken
          ? "We couldn't send a code. Your invite link may have expired — ask the owner for a new one."
          : "Dock is invite-only right now. Open your invitation link to join.",
      )
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
    <DockEntry>
      <header className="dock-entry-header"><p className="dock-wordmark"><span aria-hidden />Dock</p></header>
      {step === "email" ? (
        <>
          <h1 className="dock-entry-title">Sign in to Dock</h1>
          <p className="dock-entry-copy">
            {inviteToken
              ? "We'll email you a 6-digit code to confirm your invitation."
              : "Dock is invite-only right now. We'll email you a 6-digit code if your email has access."}
          </p>
          <form onSubmit={sendCode} className="dock-entry-form">
            <label htmlFor="dock-email">Email address</label>
            <input id="dock-email" name="email" type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="dock-entry-input" />
            <button type="submit" disabled={busy || !email.trim()} className="dock-action self-start justify-self-start">
              {busy ? "Sending…" : "Send code"}
            </button>
          </form>
        </>
      ) : (
        <>
          <h1 className="dock-entry-title">Enter your code</h1>
          <p className="dock-entry-copy">Sent to {email}</p>
          <form className="dock-entry-form" onSubmit={(e) => { e.preventDefault(); verify(code).catch(() => null) }}>
            <CodeBoxes value={code} disabled={busy} onChange={(v) => {
              setCode(v)
              if (v.length === CODE_LENGTH) verify(v).catch(() => null)
            }} />
            <div className="flex flex-wrap justify-between gap-x-4 text-[13px]">
              <button type="button" onClick={() => setStep("email")} disabled={busy} className="underline underline-offset-4">Use a different email</button>
              <button type="button" onClick={() => sendCode()} disabled={busy} className="underline underline-offset-4">Send a new code</button>
            </div>
            {busy && <p role="status" className="dock-entry-copy">Checking code…</p>}
          </form>
        </>
      )}
      {error && <p role="alert" className="mt-4 text-sm">{error}</p>}
    </DockEntry>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}
