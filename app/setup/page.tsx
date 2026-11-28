"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { TEAM_TEMPLATES } from "@/lib/agent-templates"
import { DEFAULT_CHIEF_NAME } from "@/lib/chief-key"

// ── Types ─────────────────────────────────────────────────────────────────

type RuntimeType = "openclaw" | "ollama" | "demo"

interface SetupState {
  runtimeType: RuntimeType
  gatewayUrl: string
  gatewayToken: string
  gatewayVersion: string
  ollamaUrl: string
  ollamaModel: string
  ollamaModels: string[]
  deliveryChannel: string
  deliveryTarget: string
  workspace: string
  userName: string
  assistantName: string
  companyName: string
  anthropicAdminKey: string
}

interface ScanResult {
  ok: boolean
  found: string[]
  missing: string[]
}

// ── Main Wizard ───────────────────────────────────────────────────────────

export default function SetupPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)

  const [state, setState] = useState<SetupState>({
    runtimeType: "openclaw",
    gatewayUrl: "http://127.0.0.1:18789",
    gatewayToken: "",
    gatewayVersion: "",
    ollamaUrl: "http://127.0.0.1:11434",
    ollamaModel: "",
    ollamaModels: [],
    deliveryChannel: "telegram",
    deliveryTarget: "",
    workspace: "~/clawd",
    userName: "",
    assistantName: DEFAULT_CHIEF_NAME,
    companyName: "",
    anthropicAdminKey: "",
  })

  // Team template state
  const [selectedTemplate, setSelectedTemplate] = useState("startup")

  // Ollama test state
  const [ollamaTesting, setOllamaTesting] = useState(false)
  const [ollamaResult, setOllamaResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Gateway test state
  const [gatewayTesting, setGatewayTesting] = useState(false)
  const [gatewayResult, setGatewayResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Delivery test state
  const [deliveryTesting, setDeliveryTesting] = useState(false)
  const [deliveryResult, setDeliveryResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Workspace scan state
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [workspaceSkipped, setWorkspaceSkipped] = useState(false)

  // Token visibility
  const [showToken, setShowToken] = useState(false)
  const [showAdminKey, setShowAdminKey] = useState(false)
  const [showEnvToken, setShowEnvToken] = useState(false)

  // Saving state
  const [saving, setSaving] = useState(false)
  const [envWritten, setEnvWritten] = useState(false)

  // Health check state
  const [healthChecks, setHealthChecks] = useState<Array<{ name: string; status: string; message: string }>>([])
  const [healthLoading, setHealthLoading] = useState(false)
  const [healthDone, setHealthDone] = useState(false)

  function goTo(nextStep: number) {
    setStep(nextStep)
  }

  function next() {
    goTo(step + 1)
  }

  function back() {
    goTo(step - 1)
  }

  async function testGateway() {
    setGatewayTesting(true)
    setGatewayResult(null)
    try {
      const res = await fetch("/api/setup/test-gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: state.gatewayUrl, token: state.gatewayToken }),
      })
      const data = await res.json() as { ok: boolean; version?: string; error?: string }
      if (data.ok) {
        setState((s) => ({ ...s, gatewayVersion: data.version || "1.0" }))
        setGatewayResult({ ok: true, message: `Connected — OpenClaw v${data.version || "1.0"}` })
      } else {
        setGatewayResult({ ok: false, message: data.error || "Connection failed" })
      }
    } catch {
      setGatewayResult({ ok: false, message: "Network error — check your URL" })
    } finally {
      setGatewayTesting(false)
    }
  }

  async function testOllama() {
    setOllamaTesting(true)
    setOllamaResult(null)
    try {
      const res = await fetch("/api/setup/test-ollama", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: state.ollamaUrl }),
      })
      const data = await res.json() as { ok: boolean; modelCount?: number; models?: string[]; error?: string }
      if (data.ok) {
        setState((s) => ({
          ...s,
          ollamaModels: data.models ?? [],
          ollamaModel: s.ollamaModel || (data.models?.[0] ?? ""),
        }))
        setOllamaResult({ ok: true, message: `Connected — ${data.modelCount} model${data.modelCount !== 1 ? "s" : ""} available` })
      } else {
        setOllamaResult({ ok: false, message: data.error || "Connection failed" })
      }
    } catch {
      setOllamaResult({ ok: false, message: "Network error — is Ollama running?" })
    } finally {
      setOllamaTesting(false)
    }
  }

  async function testDelivery() {
    setDeliveryTesting(true)
    setDeliveryResult(null)
    try {
      const res = await fetch("/api/setup/test-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: state.deliveryChannel,
          target: state.deliveryTarget,
          gatewayUrl: state.gatewayUrl,
          gatewayToken: state.gatewayToken,
        }),
      })
      const data = await res.json() as { ok: boolean; error?: string }
      if (data.ok) {
        setDeliveryResult({ ok: true, message: "Message sent!" })
      } else {
        setDeliveryResult({ ok: false, message: data.error || "Failed to send" })
      }
    } catch {
      setDeliveryResult({ ok: false, message: "Network error" })
    } finally {
      setDeliveryTesting(false)
    }
  }

  async function scanWorkspace() {
    setScanning(true)
    setScanResult(null)
    try {
      const res = await fetch("/api/setup/scan-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: state.workspace }),
      })
      const data = await res.json() as ScanResult
      setScanResult(data)
    } catch {
      setScanResult({ ok: false, found: [], missing: ["Failed to scan — check path"] })
    } finally {
      setScanning(false)
    }
  }

  async function saveAndFinish(demoMode = false) {
    setSaving(true)
    try {
      const res = await fetch("/api/setup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userName: state.userName,
          assistantName: state.assistantName,
          runtimeType: demoMode ? "demo" : state.runtimeType,
          gatewayUrl: state.runtimeType === "openclaw" ? state.gatewayUrl : undefined,
          gatewayToken: state.runtimeType === "openclaw" ? state.gatewayToken : undefined,
          ollamaUrl: state.runtimeType === "ollama" ? state.ollamaUrl : undefined,
          ollamaModel: state.runtimeType === "ollama" ? state.ollamaModel : undefined,
          deliveryTarget: state.deliveryTarget,
          deliveryChannel: state.deliveryChannel,
          workspace: state.workspace,
          companyName: state.companyName,
          teamTemplate: selectedTemplate,
          anthropicAdminKey: state.anthropicAdminKey,
          demoMode,
        }),
      })
      const data = await res.json() as { ok: boolean; envWritten?: boolean }
      setEnvWritten(data.envWritten ?? false)
      goTo(8)
    } catch {
      // Still proceed
      goTo(8)
    } finally {
      setSaving(false)
    }
  }

  async function runHealthChecks() {
    setHealthLoading(true)
    try {
      const res = await fetch("/api/setup/status?health=true")
      const data = await res.json() as { checks?: Array<{ name: string; status: string; message: string }> }
      setHealthChecks(data.checks ?? [])
    } catch {
      setHealthChecks([])
    } finally {
      setHealthLoading(false)
      setHealthDone(true)
    }
  }

  const envLines: string[] = [`AGENT_RUNTIME=${state.runtimeType}`]
  if (state.runtimeType === "openclaw") {
    envLines.push(`OPENCLAW_GATEWAY_URL=${state.gatewayUrl}`)
    envLines.push(`OPENCLAW_GATEWAY_TOKEN=${state.gatewayToken}`)
  } else if (state.runtimeType === "ollama") {
    envLines.push(`OLLAMA_BASE_URL=${state.ollamaUrl}`)
    envLines.push(`OLLAMA_MODEL=${state.ollamaModel}`)
  }
  envLines.push(
    `AGENT_DELIVERY_TARGET=${state.deliveryTarget}`,
    `AGENT_DELIVERY_CHANNEL=${state.deliveryChannel}`,
    `AGENT_WORKSPACE=${state.workspace}`,
    `NEXT_PUBLIC_MC_URL=http://localhost:3000`,
  )
  if (state.anthropicAdminKey) {
    envLines.push(`ANTHROPIC_ADMIN_KEY=${state.anthropicAdminKey}`)
  }
  const envConfig = envLines.join("\n")

  const maskedToken = state.gatewayToken
    ? state.gatewayToken.slice(0, 4) + "•".repeat(Math.max(0, state.gatewayToken.length - 4))
    : "••••••••••••••••••••"

  const maskedAdminKey = state.anthropicAdminKey
    ? state.anthropicAdminKey.slice(0, 12) + "•".repeat(Math.max(0, state.anthropicAdminKey.length - 12))
    : ""

  const envMaskedLines: string[] = [`AGENT_RUNTIME=${state.runtimeType}`]
  if (state.runtimeType === "openclaw") {
    envMaskedLines.push(`OPENCLAW_GATEWAY_URL=${state.gatewayUrl}`)
    envMaskedLines.push(`OPENCLAW_GATEWAY_TOKEN=${showEnvToken ? state.gatewayToken : maskedToken}`)
  } else if (state.runtimeType === "ollama") {
    envMaskedLines.push(`OLLAMA_BASE_URL=${state.ollamaUrl}`)
    envMaskedLines.push(`OLLAMA_MODEL=${state.ollamaModel}`)
  }
  envMaskedLines.push(
    `AGENT_DELIVERY_TARGET=${state.deliveryTarget}`,
    `AGENT_DELIVERY_CHANNEL=${state.deliveryChannel}`,
    `AGENT_WORKSPACE=${state.workspace}`,
    `NEXT_PUBLIC_MC_URL=http://localhost:3000`,
  )
  if (state.anthropicAdminKey) {
    envMaskedLines.push(`ANTHROPIC_ADMIN_KEY=${showEnvToken ? state.anthropicAdminKey : maskedAdminKey}`)
  }
  const envConfigMasked = envMaskedLines.join("\n")

  async function copyEnv() {
    try {
      await navigator.clipboard.writeText(envConfig)
    } catch {
      // Fallback
    }
  }

  const canGoNextGateway = gatewayResult?.ok === true
  const canGoNextDelivery = deliveryResult?.ok === true
  const canGoNextWorkspace = scanResult !== null || workspaceSkipped
  const canGoNextIdentity = state.userName.trim().length > 0

  return (
    <main className="dock-entry">
      <div className="dock-entry-inner">
        <header className="dock-entry-header">
          <p className="dock-wordmark"><span aria-hidden />Dock</p>
          <p className="dock-entry-label">Workspace setup · {String(step).padStart(2, "0")} / 08</p>
          <div className="dock-entry-progress" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={8} aria-valuenow={step}>
            {Array.from({ length: 8 }, (_, i) => <span key={i} data-filled={i < step} />)}
          </div>
        </header>
        <div key={step} className="dock-entry-step">
          {/* ── Step 1: Choose Runtime ──────────────────────────────────── */}
          {step === 1 && (
            <div>
              <h1 className="dock-entry-title">Choose your runtime</h1>
              <p style={{ color: "var(--dock-ink-2)", marginBottom: 32, lineHeight: 1.6 }}>
                How do you want to run your AI agents?
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {([
                  {
                    id: "openclaw" as RuntimeType,
                    title: "OpenClaw",
                    desc: "Full agent runtime with sessions, delivery, and multi-agent orchestration",
                  },
                  {
                    id: "ollama" as RuntimeType,
                    title: "Ollama / Local Models",
                    desc: "Run local LLMs (Llama, Mistral, Codellama) — works with LM Studio & llama.cpp too",
                  },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setState((s) => ({ ...s, runtimeType: opt.id }))}
                    aria-pressed={state.runtimeType === opt.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "16px 20px",
                      borderRadius: 12,
                      border: state.runtimeType === opt.id
                        ? "1px solid var(--dock-ink-2)"
                        : "1px solid rgba(255,255,255,0.08)",
                      backgroundColor: state.runtimeType === opt.id
                        ? "var(--dock-selection)"
                        : "rgba(255,255,255,0.03)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "background-color 150ms, border-color 150ms",
                    }}
                  >
                    <span className="dock-choice-indicator" aria-hidden />
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--dock-ink)", fontSize: 15 }}>{opt.title}</div>
                      <div style={{ color: "var(--dock-ink-2)", fontSize: 13, marginTop: 2 }}>{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>

              <div style={navRowStyle}>
                <button
                  onClick={() => {
                    setState((s) => ({ ...s, runtimeType: "demo" }))
                    saveAndFinish(true)
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--dock-ink-2)",
                    cursor: "pointer",
                    fontSize: 13,
                    padding: "8px 12px",
                  }}
                >
                  Explore without agents
                </button>
                <button
                  onClick={next}
                  style={primaryBtnStyle(false)}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Connect Runtime (OpenClaw or Ollama) ────────────── */}
          {step === 2 && state.runtimeType === "openclaw" && (
            <div>
              <h1 className="dock-entry-title">Connect OpenClaw</h1>
              <p style={{ color: "var(--dock-ink-2)", marginBottom: 32, lineHeight: 1.6 }}>
                Dock runs on OpenClaw — your personal chief-of-staff agent runtime.
                Each user connects their own chief of staff and keeps their own task threads, delivery target,
                and workspace in sync.
              </p>

              <label style={labelStyle}>Gateway URL</label>
              <input
                style={inputStyle}
                type="text"
                value={state.gatewayUrl}
                onChange={(e) => {
                  setState((s) => ({ ...s, gatewayUrl: e.target.value }))
                  setGatewayResult(null)
                }}
                placeholder="http://127.0.0.1:18789"
              />

              <label style={{ ...labelStyle, marginTop: 20 }}>Gateway Token</label>
              <div style={{ position: "relative" }}>
                <input
                  style={{ ...inputStyle, paddingRight: 80 }}
                  type={showToken ? "text" : "password"}
                  value={state.gatewayToken}
                  onChange={(e) => {
                    setState((s) => ({ ...s, gatewayToken: e.target.value }))
                    setGatewayResult(null)
                  }}
                  placeholder="Your gateway token"
                />
                <button
                  onClick={() => setShowToken((v) => !v)}
                  style={{
                    position: "absolute",
                    right: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "var(--dock-ink-2)",
                    cursor: "pointer",
                    fontSize: 13,
                    padding: "4px 8px",
                  }}
                >
                  {showToken ? "Hide" : "Show"}
                </button>
              </div>

              <div style={{ marginTop: 24, display: "flex", gap: 12, alignItems: "center" }}>
                <button
                  onClick={testGateway}
                  disabled={gatewayTesting || !state.gatewayUrl}
                  style={secondaryBtnStyle(gatewayTesting || !state.gatewayUrl)}
                >
                  {gatewayTesting ? (
                    <>
                      <Spinner /> Testing...
                    </>
                  ) : (
                    "Test Connection"
                  )}
                </button>
              </div>

              {gatewayResult && (
                <div
                  style={{
                    marginTop: 16,
                    padding: "10px 14px",
                    borderRadius: 8,
                    backgroundColor: gatewayResult.ok ? "#052e16" : "#2d0a0a",
                    border: `1px solid ${gatewayResult.ok ? "#22c55e44" : "#ef444444"}`,
                    color: gatewayResult.ok ? "#22c55e" : "#ef4444",
                    fontSize: 14,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {gatewayResult.ok ? "✓" : "✗"} {gatewayResult.message}
                </div>
              )}

              <p style={helpTextStyle}>
                Run <code style={codeStyle}>openclaw gateway status</code> to find your URL and
                token.
              </p>

              <div style={navRowStyle}>
                <button onClick={back} style={backBtnStyle}>
                  Back
                </button>
                <button
                  onClick={next}
                  disabled={!canGoNextGateway}
                  style={primaryBtnStyle(!canGoNextGateway)}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 2 && state.runtimeType === "ollama" && (
            <div>
              <h1 className="dock-entry-title">Connect Ollama</h1>
              <p style={{ color: "var(--dock-ink-2)", marginBottom: 32, lineHeight: 1.6 }}>
                Point Dock at your local model server. Works with Ollama, LM Studio, or any OpenAI-compatible endpoint.
              </p>

              <label style={labelStyle}>Ollama URL</label>
              <input
                style={inputStyle}
                type="text"
                value={state.ollamaUrl}
                onChange={(e) => {
                  setState((s) => ({ ...s, ollamaUrl: e.target.value }))
                  setOllamaResult(null)
                }}
                placeholder="http://127.0.0.1:11434"
              />

              <div style={{ marginTop: 24, display: "flex", gap: 12, alignItems: "center" }}>
                <button
                  onClick={testOllama}
                  disabled={ollamaTesting || !state.ollamaUrl}
                  style={secondaryBtnStyle(ollamaTesting || !state.ollamaUrl)}
                >
                  {ollamaTesting ? (
                    <><Spinner /> Testing...</>
                  ) : (
                    "Test Connection"
                  )}
                </button>
              </div>

              {ollamaResult && (
                <div
                  style={{
                    marginTop: 16,
                    padding: "10px 14px",
                    borderRadius: 8,
                    backgroundColor: ollamaResult.ok ? "#052e16" : "#2d0a0a",
                    border: `1px solid ${ollamaResult.ok ? "#22c55e44" : "#ef444444"}`,
                    color: ollamaResult.ok ? "#22c55e" : "#ef4444",
                    fontSize: 14,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {ollamaResult.ok ? "✓" : "✗"} {ollamaResult.message}
                </div>
              )}

              {ollamaResult?.ok && state.ollamaModels.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <label style={labelStyle}>Model</label>
                  <select
                    style={{ ...inputStyle, cursor: "pointer" }}
                    value={state.ollamaModel}
                    onChange={(e) => setState((s) => ({ ...s, ollamaModel: e.target.value }))}
                  >
                    {state.ollamaModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              )}

              <p style={helpTextStyle}>
                Run <code style={codeStyle}>ollama serve</code> to start Ollama, then <code style={codeStyle}>ollama pull llama3.2</code> to download a model.
              </p>

              <div style={navRowStyle}>
                <button onClick={back} style={backBtnStyle}>
                  Back
                </button>
                <button
                  onClick={next}
                  disabled={!ollamaResult?.ok}
                  style={primaryBtnStyle(!ollamaResult?.ok)}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Delivery Channel ─────────────────────────────────── */}
          {step === 3 && (
            <div>
              <h1 className="dock-entry-title">
                Connect your channel
              </h1>
              <p style={{ color: "var(--dock-ink-2)", marginBottom: 32, lineHeight: 1.6 }}>
                When the chief of staff activates a task, Dock sends it to your personal delivery target
                as a live turn. Connect the Telegram inbox you want the chief of staff to use for this workspace.
              </p>

              <label style={labelStyle}>Channel</label>
              <select
                style={{ ...inputStyle, cursor: "pointer" }}
                value={state.deliveryChannel}
                onChange={(e) => {
                  setState((s) => ({ ...s, deliveryChannel: e.target.value }))
                  setDeliveryResult(null)
                }}
              >
                <option value="telegram">Telegram</option>
                <option value="discord">Discord</option>
                <option value="signal">Signal</option>
                <option value="whatsapp">WhatsApp</option>
              </select>

              <label style={{ ...labelStyle, marginTop: 20 }}>Chat ID / Target</label>
              <input
                style={inputStyle}
                type="text"
                value={state.deliveryTarget}
                onChange={(e) => {
                  setState((s) => ({ ...s, deliveryTarget: e.target.value }))
                  setDeliveryResult(null)
                }}
                placeholder={
                  state.deliveryChannel === "telegram"
                    ? "e.g. 264452755"
                    : state.deliveryChannel === "discord"
                    ? "e.g. #general or channel ID"
                    : "Target ID or number"
                }
              />

              <div style={{ marginTop: 24 }}>
                <button
                  onClick={testDelivery}
                  disabled={deliveryTesting || !state.deliveryTarget}
                  style={secondaryBtnStyle(deliveryTesting || !state.deliveryTarget)}
                >
                  {deliveryTesting ? (
                    <>
                      <Spinner /> Sending...
                    </>
                  ) : (
                    "Send Test Message"
                  )}
                </button>
              </div>

              {deliveryResult && (
                <div
                  style={{
                    marginTop: 16,
                    padding: "10px 14px",
                    borderRadius: 8,
                    backgroundColor: deliveryResult.ok ? "#052e16" : "#2d0a0a",
                    border: `1px solid ${deliveryResult.ok ? "#22c55e44" : "#ef444444"}`,
                    color: deliveryResult.ok ? "#22c55e" : "#ef4444",
                    fontSize: 14,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {deliveryResult.ok ? "✓" : "✗"} {deliveryResult.message}
                </div>
              )}

              {state.deliveryChannel === "telegram" && (
                <p style={helpTextStyle}>
                  For Telegram: message{" "}
                  <code style={codeStyle}>@userinfobot</code> to get your chat ID.
                </p>
              )}

              <div style={navRowStyle}>
                <button onClick={back} style={backBtnStyle}>
                  Back
                </button>
                <button
                  onClick={next}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--dock-ink-2)",
                    cursor: "pointer",
                    fontSize: 14,
                    padding: "8px 12px",
                  }}
                >
                  Skip
                </button>
                <button
                  onClick={next}
                  disabled={!canGoNextDelivery}
                  style={primaryBtnStyle(!canGoNextDelivery)}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Workspace ────────────────────────────────────────── */}
          {step === 4 && (
            <div>
              <h1 className="dock-entry-title">Agent workspace</h1>
              <p style={{ color: "var(--dock-ink-2)", marginBottom: 32, lineHeight: 1.6 }}>
                Where do your agent files live? This is where Dock reads memory, Scout
                reports, and agent identities.
              </p>

              <label style={labelStyle}>Workspace path</label>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  type="text"
                  value={state.workspace}
                  onChange={(e) => {
                    setState((s) => ({ ...s, workspace: e.target.value }))
                    setScanResult(null)
                  }}
                  placeholder="~/clawd"
                />
                <button
                  onClick={scanWorkspace}
                  disabled={scanning || !state.workspace}
                  style={{
                    ...secondaryBtnStyle(scanning || !state.workspace),
                    whiteSpace: "nowrap",
                    minWidth: 80,
                  }}
                >
                  {scanning ? <Spinner /> : "Scan →"}
                </button>
              </div>

              {scanResult && (
                <div
                  style={{
                    marginTop: 20,
                    padding: "16px",
                    backgroundColor: "var(--dock-panel)",
                    border: "1px solid var(--dock-line-2)",
                    borderRadius: 10,
                  }}
                >
                  {scanResult.found.map((item) => (
                    <div
                      key={item}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 8,
                        color: "#22c55e",
                        fontSize: 14,
                      }}
                    >
                      <span>✓</span>
                      <span>{item} found</span>
                    </div>
                  ))}
                  {scanResult.missing.map((item) => (
                    <div
                      key={item}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 8,
                        color: "#f59e0b",
                        fontSize: 14,
                      }}
                    >
                      <span>Missing:</span>
                      <span>{item} not found — will use defaults</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={navRowStyle}>
                <button onClick={back} style={backBtnStyle}>
                  Back
                </button>
                <button
                  onClick={() => {
                    setWorkspaceSkipped(true)
                    next()
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--dock-ink-2)",
                    cursor: "pointer",
                    fontSize: 14,
                    padding: "8px 12px",
                  }}
                >
                  Skip
                </button>
                <button
                  onClick={next}
                  disabled={!canGoNextWorkspace}
                  style={primaryBtnStyle(!canGoNextWorkspace)}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ── Step 5: Identity ─────────────────────────────────────────── */}
          {step === 5 && (
            <div>
              <h1 className="dock-entry-title">Make it yours</h1>
              <p style={{ color: "var(--dock-ink-2)", marginBottom: 32, lineHeight: 1.6 }}>
                What should we call you?
              </p>

              <label style={labelStyle}>Your name</label>
              <input
                style={inputStyle}
                type="text"
                value={state.userName}
                onChange={(e) => setState((s) => ({ ...s, userName: e.target.value }))}
                placeholder='e.g. "Alex"'
              />

              <label style={{ ...labelStyle, marginTop: 24 }}>Your assistant&apos;s name</label>
              <input
                style={inputStyle}
                type="text"
                value={state.assistantName}
                onChange={(e) => setState((s) => ({ ...s, assistantName: e.target.value }))}
                placeholder='e.g. "Jarvis", "Max", "Aria"'
              />

              <label style={{ ...labelStyle, marginTop: 24 }}>Company / project name <span style={{ color: "var(--dock-ink-2)", fontWeight: 400 }}>(optional)</span></label>
              <input
                style={inputStyle}
                type="text"
                value={state.companyName}
                onChange={(e) => setState((s) => ({ ...s, companyName: e.target.value }))}
                placeholder='e.g. "Acme Labs"'
              />

              <div style={navRowStyle}>
                <button onClick={back} style={backBtnStyle}>
                  Back
                </button>
                <button
                  onClick={next}
                  disabled={!canGoNextIdentity}
                  style={primaryBtnStyle(!canGoNextIdentity)}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ── Step 6: Team Template ─────────────────────────────────────── */}
          {step === 6 && (
            <div>
              <h1 className="dock-entry-title">Pick your team</h1>
              <p style={{ color: "var(--dock-ink-2)", marginBottom: 24, lineHeight: 1.6 }}>
                Choose a starting template — you can customize agents later.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 340, overflowY: "auto" }}>
                {TEAM_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => setSelectedTemplate(tmpl.id)}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 14,
                      padding: "14px 18px",
                      borderRadius: 12,
                      border: selectedTemplate === tmpl.id
                        ? "2px solid var(--dock-ink-2)"
                        : "1px solid rgba(255,255,255,0.08)",
                      backgroundColor: selectedTemplate === tmpl.id
                        ? "rgba(124,58,237,0.08)"
                        : "rgba(255,255,255,0.03)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "background-color 150ms, border-color 150ms",
                    }}
                  >
                    <span style={{ fontSize: 24, marginTop: 2 }}>{tmpl.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: "var(--dock-ink)", fontSize: 15 }}>{tmpl.name}</div>
                      <div style={{ color: "var(--dock-ink-2)", fontSize: 12, marginTop: 2 }}>{tmpl.description}</div>
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        {tmpl.agents.map((a) => (
                          <span
                            key={a.id}
                            style={{
                              fontSize: 11,
                              padding: "2px 8px",
                              borderRadius: 20,
                              backgroundColor: `${a.accent}18`,
                              color: a.accent,
                              border: `1px solid ${a.accent}30`,
                            }}
                          >
                            {a.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div style={navRowStyle}>
                <button onClick={back} style={backBtnStyle}>
                  Back
                </button>
                <button
                  onClick={next}
                  style={primaryBtnStyle(false)}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ── Step 7: API keys ──────────────────────────────────────────── */}
          {step === 7 && (
            <div>
              <h1 className="dock-entry-title">API keys</h1>
              <p style={{ color: "var(--dock-ink-2)", marginBottom: 32, lineHeight: 1.6 }}>
                Connect your AI provider for accurate cost tracking.
              </p>

              <label style={labelStyle}>Anthropic Admin Key</label>
              <div style={{ position: "relative" }}>
                <input
                  style={{ ...inputStyle, paddingRight: 80 }}
                  type={showAdminKey ? "text" : "password"}
                  value={state.anthropicAdminKey}
                  onChange={(e) => setState((s) => ({ ...s, anthropicAdminKey: e.target.value }))}
                  placeholder="sk-ant-admin..."
                />
                <button
                  onClick={() => setShowAdminKey((v) => !v)}
                  style={{
                    position: "absolute",
                    right: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "var(--dock-ink-2)",
                    cursor: "pointer",
                    fontSize: 13,
                    padding: "4px 8px",
                  }}
                >
                  {showAdminKey ? "Hide" : "Show"}
                </button>
              </div>

              <p style={helpTextStyle}>
                Optional. Get yours at{" "}
                <a
                  href="https://console.anthropic.com/settings/admin-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--dock-ink-2)", textDecoration: "underline" }}
                >
                  console.anthropic.com/settings/admin-keys
                </a>
              </p>

              <div style={navRowStyle}>
                <button onClick={back} style={backBtnStyle}>
                  Back
                </button>
                <button
                  onClick={() => saveAndFinish(false)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--dock-ink-2)",
                    cursor: "pointer",
                    fontSize: 14,
                    padding: "8px 12px",
                  }}
                >
                  Skip
                </button>
                <button
                  onClick={() => saveAndFinish(false)}
                  disabled={saving}
                  style={primaryBtnStyle(saving)}
                >
                  {saving ? (
                    <>
                      <Spinner /> Saving...
                    </>
                  ) : (
                    "Finish →"
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 8: Done + Health Checks ────────────────────────────── */}
          {step === 8 && (
            <div style={{ textAlign: "center" }}>
              <h1 className="dock-entry-title">You&apos;re all set.</h1>
              <p style={{ color: "var(--dock-ink-2)", marginBottom: 24, fontSize: 16 }}>
                {state.userName ? `Welcome aboard, ${state.userName}.` : "Your Dock is ready."}
              </p>

              {/* Env status */}
              {envWritten ? (
                <div
                  style={{
                    padding: "12px 16px",
                    borderRadius: 10,
                    backgroundColor: "#052e16",
                    border: "1px solid #22c55e44",
                    color: "#22c55e",
                    fontSize: 14,
                    marginBottom: 16,
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  ✓ Environment saved to <code style={{ ...codeStyle, color: "#22c55e", backgroundColor: "#0a2a15" }}>.env.local</code>
                </div>
              ) : (
                <div
                  style={{
                    padding: "12px 16px",
                    borderRadius: 10,
                    backgroundColor: "var(--dock-panel)",
                    border: "1px solid var(--dock-line-2)",
                    color: "var(--dock-ink-2)",
                    fontSize: 13,
                    marginBottom: 16,
                    textAlign: "left",
                  }}
                >
                  Running in demo mode — no environment file needed.
                </div>
              )}

              {/* Show config toggle */}
              <details style={{ marginBottom: 16, textAlign: "left" }}>
                <summary style={{ color: "var(--dock-ink-2)", fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
                  Show configuration
                </summary>
                <div
                  style={{
                    backgroundColor: "var(--dock-panel)",
                    border: "1px solid var(--dock-line-2)",
                    borderRadius: 10,
                    padding: "16px 20px",
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 13,
                    lineHeight: 1.8,
                    color: "var(--dock-ink-2)",
                    position: "relative",
                  }}
                >
                  {envConfigMasked.split("\n").map((line, i) => {
                    const [key, ...valParts] = line.split("=")
                    const val = valParts.join("=")
                    return (
                      <div key={i}>
                        <span style={{ color: "var(--dock-ink-2)" }}>{key}</span>
                        <span style={{ color: "var(--dock-ink-2)" }}>=</span>
                        <span style={{ color: "var(--dock-ink)" }}>{val}</span>
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => setShowEnvToken((v) => !v)}
                    style={{ background: "none", border: "1px solid var(--dock-line-2)", borderRadius: 8, padding: "6px 12px", color: "var(--dock-ink-2)", cursor: "pointer", fontSize: 12 }}
                  >
                    {showEnvToken ? "Hide token" : "Show token"}
                  </button>
                  <button
                    onClick={copyEnv}
                    style={{ background: "none", border: "1px solid var(--dock-line-2)", borderRadius: 8, padding: "6px 12px", color: "var(--dock-ink-2)", cursor: "pointer", fontSize: 12 }}
                  >
                    Copy to clipboard
                  </button>
                </div>
              </details>

              {/* Health checks */}
              {!healthDone ? (
                <button
                  onClick={runHealthChecks}
                  disabled={healthLoading}
                  style={{
                    ...secondaryBtnStyle(healthLoading),
                    width: "100%",
                    justifyContent: "center",
                    marginBottom: 16,
                  }}
                >
                  {healthLoading ? <><Spinner /> Running checks...</> : "Run Health Check"}
                </button>
              ) : (
                <div style={{ marginBottom: 16, textAlign: "left" }}>
                  <p style={{ fontSize: 12, color: "var(--dock-ink-2)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    System checks
                  </p>
                  {healthChecks.map((check) => (
                    <div
                      key={check.name}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        borderRadius: 8,
                        marginBottom: 4,
                        backgroundColor: "var(--dock-panel)",
                        border: `1px solid ${check.status === "pass" ? "#22c55e22" : check.status === "warn" ? "#f59e0b22" : "#ef444422"}`,
                      }}
                    >
                      <span style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: check.status === "pass" ? "#22c55e" : check.status === "warn" ? "#f59e0b" : "#ef4444",
                        flexShrink: 0,
                      }} />
                      <div>
                        <span style={{ fontSize: 13, color: "var(--dock-ink)", fontWeight: 500 }}>{check.name}</span>
                        <span style={{ fontSize: 12, color: "var(--dock-ink-2)", marginLeft: 8 }}>{check.message}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {envWritten && (
                <p style={{ fontSize: 12, color: "var(--dock-ink-2)", marginBottom: 16 }}>
                  Restart <code style={codeStyle}>npm run dev</code> to pick up the new environment variables.
                </p>
              )}

              <button
                onClick={() => router.push("/assistant")}
                style={{
                  ...primaryBtnStyle(false),
                  width: "100%",
                  fontSize: 16,
                  padding: "14px 32px",
                }}
              >
                Open Dock
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--dock-ink-2)",
  marginBottom: 8,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  backgroundColor: "var(--dock-panel)",
  border: "1px solid var(--dock-control-line)",
  borderRadius: 8,
  padding: "12px 14px",
  fontSize: 15,
  color: "var(--dock-ink)",
  outline: "none",
  boxSizing: "border-box",
}

const helpTextStyle: React.CSSProperties = {
  marginTop: 16,
  fontSize: 13,
  color: "var(--dock-ink-2)",
  lineHeight: 1.6,
}

const codeStyle: React.CSSProperties = {
  backgroundColor: "var(--dock-selection)",
  padding: "2px 6px",
  borderRadius: 4,
  fontFamily: "var(--font-geist-mono), monospace",
  fontSize: 12,
  color: "var(--dock-ink-2)",
}

const navRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  marginTop: 28,
  alignItems: "center",
  justifyContent: "flex-end",
}

const backBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--dock-ink-2)",
  cursor: "pointer",
  fontSize: 15,
  padding: "10px 0",
  marginRight: "auto",
}

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    backgroundColor: "var(--dock-ink)",
    opacity: disabled ? .45 : 1,
    color: "var(--dock-canvas)",
    border: "none",
    borderRadius: 8,
    padding: "12px 28px",
    fontSize: 15,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    gap: 8,
    transition: "background-color 0.15s",
  }
}

function secondaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    backgroundColor: disabled ? "var(--dock-panel)" : "var(--dock-selection)",
    color: disabled ? "#4a4a5a" : "var(--dock-ink-2)",
    border: `1px solid ${disabled ? "var(--dock-selection)" : "var(--dock-line-2)"}`,
    borderRadius: 8,
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    transition: "background-color 0.15s",
  }
}

function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
      }}
    />
  )
}
