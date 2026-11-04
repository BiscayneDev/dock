import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator, FlatList, Pressable, SafeAreaView, ScrollView, StyleSheet,
  Text, TextInput, View,
} from "react-native"
import { StatusBar } from "expo-status-bar"
import * as SecureStore from "expo-secure-store"
import { Platform } from "react-native"

// SecureStore has no web implementation; the web preview falls back to
// localStorage. Native keeps hardware-backed storage.
const store = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === "web") return window.localStorage.getItem(key)
    return SecureStore.getItemAsync(key)
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === "web") { window.localStorage.removeItem(key); return }
    await SecureStore.deleteItemAsync(key)
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") { window.localStorage.setItem(key, value); return }
    return SecureStore.setItemAsync(key, value)
  },
}

// Narrow mobile release: paired access to durable runs and approval details.
// Sandbox coding stays in the separate experimental foundation branch.

type Run = { id: string; status: string; agentKey?: string; payload?: { prompt?: string }; output?: string | null; error?: string | null; spentCents?: number; budgetCents?: number; proposedAction?: { type?: string } }
type ApprovalCard = {
  runId: string
  status: string
  proposal: string
  target: string
  estimatedLabel: string
  budgetLabel: string
  projectName: string
  model: string
  requiresConfirm: boolean
  canDecide: boolean
  footer: string
}
type Tab = "runs" | "approvals" | "new"

async function api<T>(base: string, token: string, path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "x-dock-mobile-token": token,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export default function App() {
  const [dockUrl, setDockUrl] = useState("")
  const [token, setToken] = useState("")
  const [connected, setConnected] = useState<{ base: string; token: string } | null>(null)
  const [tab, setTab] = useState<Tab>("runs")
  const [selectedRun, setSelectedRun] = useState<string | null>(null)
  const [runSubmissionEnabled, setRunSubmissionEnabled] = useState(false)
  const [runs, setRuns] = useState<Run[]>([])
  const [cards, setCards] = useState<ApprovalCard[]>([])
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  const [newTitle, setNewTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const base = await store.get("dock:url")
      const saved = await store.get("dock:token")
      if (base && saved) setConnected({ base, token: saved })
    })()
  }, [])

  const connect = useCallback(async () => {
    const base = dockUrl.trim().replace(/\/$/, "")
    const code = token.trim()
    if (!base || !code) return
    // Tokens cross the network on every call: refuse cleartext, except local dev.
    try {
      const u = new URL(base)
      const local = u.hostname === "localhost" || u.hostname === "127.0.0.1"
      if (u.protocol !== "https:" && !local) {
        setError("Refusing a non-HTTPS Dock URL - the mobile token would be exposed.")
        return
      }
    } catch {
      setError("That does not look like a URL.")
      return
    }
    setBusy(true)
    setError(null)
    // Pairing: exchange the short-lived code from the Dock web UI for a
    // device-scoped credential. No persistent token is ever typed in.
    const paired = await api<{ deviceToken: string }>(base, "-", "/api/mobile/pair/exchange", {
      method: "POST",
      body: JSON.stringify({ code, platform: "ios" }),
    })
    if (!paired?.deviceToken) {
      setBusy(false)
      setError("Pairing failed - codes are single-use and expire after 5 minutes.")
      return
    }
    // Authenticated connectivity check: a wrong or revoked credential fails
    // loudly here instead of silently "connecting".
    const status = await api<{ ok: boolean }>(base, paired.deviceToken, "/api/mobile/status")
    setBusy(false)
    if (!status?.ok) {
      setError("Paired, but the credential was rejected by that Dock. Pair again from the Dock web UI.")
      return
    }
    await store.set("dock:url", base)
    await store.set("dock:token", paired.deviceToken)
    setConnected({ base, token: paired.deviceToken })
    // Notifications are opt-in from the connected screen, never an auth surprise.
  }, [dockUrl, token])

  const refresh = useCallback(async () => {
    if (!connected) return
    const [runData, cardData, status] = await Promise.all([
      api<{ runs: Run[] }>(connected.base, connected.token, "/api/runs"),
      api<{ cards: ApprovalCard[] }>(connected.base, connected.token, "/api/mobile/approvals"),
      api<{ runSubmissionEnabled?: boolean }>(connected.base, connected.token, "/api/mobile/status"),
    ])
    if (runData) { setRuns(runData.runs); setError(null) }
    else setError("Dock could not refresh runs. Showing the last loaded results. Decisions are unavailable.")
    setRunSubmissionEnabled(status?.runSubmissionEnabled === true)
    setCards(runData && cardData ? cardData.cards : [])
  }, [connected])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 30000)
    return () => clearInterval(t)
  }, [refresh])

  const queueRun = useCallback(async () => {
    if (!connected || !newTitle.trim() || !runSubmissionEnabled) return
    setBusy(true); setError(null)
    const result = await api<{ id: string }>(connected.base, connected.token, "/api/runs", {
      method: "POST", body: JSON.stringify({ prompt: newTitle.trim(), target: "cloud", budget_cents: 10 }),
    })
    setBusy(false)
    if (!result?.id) {
      setError("Run submission was not confirmed. Your text is kept. Refresh Runs before resubmitting to avoid a duplicate.")
      return
    }
    setNewTitle(""); setSelectedRun(result.id); setTab("runs"); await refresh()
  }, [connected, newTitle, runSubmissionEnabled, refresh])

  const decide = useCallback(async (runId: string, decision: "approve" | "reject") => {
    if (!connected) return
    setConfirmed((prev) => ({ ...prev, [runId]: false }))
    const result = await api(connected.base, connected.token, `/api/runs/${encodeURIComponent(runId)}/${decision}`, { method: "POST" })
    if (!result) { setError("Decision was not confirmed. Refresh before trying again."); return }
    await refresh()
  }, [connected, refresh])

  if (!connected) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <Text style={styles.h1}>Dock</Text>
        <Text style={styles.sub}>Connect to your Dock.</Text>
        <TextInput style={styles.input} placeholder="Dock URL (https://your-dock...)" placeholderTextColor="#52525b"
          autoCapitalize="none" autoCorrect={false} value={dockUrl} onChangeText={setDockUrl} />
        <TextInput style={styles.input} placeholder="6-digit pairing code (from Dock web)" placeholderTextColor="#52525b"
          autoCapitalize="none" keyboardType="number-pad" value={token} onChangeText={setToken} />
        {error ? <Text style={styles.bad}>{error}</Text> : null}
        <Pressable style={styles.button} onPress={connect} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Connect</Text>}
        </Pressable>
      </SafeAreaView>
    )
  }

  if (selectedRun) {
    const run = runs.find((r) => r.id === selectedRun)
    return <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <Pressable onPress={() => setSelectedRun(null)}><Text style={styles.back}>‹ Runs</Text></Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.bad}>{error}</Text> : null}
      <ScrollView>
        <Text style={styles.h1}>{run?.payload?.prompt || "Run"}</Text>
        <Text style={styles.sub}>{run?.status || "Waiting for Dock to return this run"}</Text>
        <Text style={styles.sub}>Text generation only. This is not a sandbox coding run or a verified external action.</Text>
        {run?.output ? <Text selectable style={styles.taskTitle}>{run.output}</Text> : null}
        {run?.error ? <Text style={styles.bad}>{run.error}</Text> : null}
        {!run?.output && !run?.error ? <Text style={styles.sub}>No result yet. Dock stores the result when the worker finishes.</Text> : null}
        <Pressable onPress={refresh}><Text style={styles.back}>Refresh run</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  }

  const pendingCards = cards.filter((card) => card.status === "pending" && card.canDecide)

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      {error ? <Text accessibilityRole="alert" style={styles.bad}>{error}</Text> : null}
      <View style={styles.row}>
        <Pressable onPress={refresh}><Text style={styles.back}>Refresh</Text></Pressable>
        <Pressable onPress={async () => {
          await store.remove("dock:token"); await store.remove("dock:url");
          setConnected(null); setRuns([]); setCards([]); setSelectedRun(null); setToken(""); setError(null)
        }}><Text style={styles.back}>Disconnect this app</Text></Pressable>
      </View>
      {tab === "runs" && <FlatList
        data={runs} keyExtractor={(run) => run.id}
        ListHeaderComponent={<Text style={styles.h1}>Runs</Text>}
        ListEmptyComponent={<Text style={styles.sub}>No runs loaded. New runs stay off until Dock execution and spending are approved.</Text>}
        renderItem={({ item: run }) => <Pressable style={styles.task} onPress={() => setSelectedRun(run.id)}>
          <Text style={styles.taskTitle}>{run.payload?.prompt || run.id}</Text>
          <Text style={styles.sub}>{run.status}{run.output ? " · result ready" : ""}</Text>
        </Pressable>}
      />}
      {tab === "approvals" && (
        <FlatList
          data={pendingCards}
          keyExtractor={(card) => card.runId}
          ListEmptyComponent={<Text style={styles.sub}>Nothing waiting on you.</Text>}
          renderItem={({ item: card }) => {
            // Never approve blind: without the material details the server
            // gave no readable proposal/target, so there is nothing safe to
            // approve and the button stays disabled.
            const detailsKnown = card.proposal !== "unknown" && card.target !== "unknown"
            const needsConfirm = card.requiresConfirm && !confirmed[card.runId]
            return (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{card.proposal}</Text>
                <Text style={styles.sub}>To: {card.target}</Text>
                <Text style={styles.sub}>Estimated: {card.estimatedLabel} · Budget: {card.budgetLabel}</Text>
                <Text style={styles.sub}>{card.projectName} · {card.model}</Text>
                <Text style={styles.sub}>{card.footer}</Text>
                <View style={styles.row}>
                  <Pressable
                    style={[styles.button, styles.approve, !detailsKnown && styles.buttonDisabled]}
                    disabled={!detailsKnown}
                    onPress={() => {
                      if (needsConfirm) {
                        setConfirmed((prev) => ({ ...prev, [card.runId]: true }))
                        return
                      }
                      decide(card.runId, "approve")
                    }}
                  >
                    <Text style={styles.buttonText}>
                      {!detailsKnown ? "Details unavailable" : needsConfirm ? `Confirm ${card.estimatedLabel}` : "Approve"}
                    </Text>
                  </Pressable>
                  <Pressable style={[styles.button, styles.reject]} onPress={() => decide(card.runId, "reject")}>
                    <Text style={styles.buttonText}>Reject</Text>
                  </Pressable>
                </View>
              </View>
            )
          }}
        />
      )}
      {tab === "new" && (
        <ScrollView>
          <Text style={styles.h1}>New task</Text>
          <TextInput style={styles.input} placeholder="What should Dock do?" placeholderTextColor="#52525b"
            value={newTitle} onChangeText={setNewTitle} />
          <Text style={styles.sub}>Text-only cloud run. No code execution, browser, or external actions. The server must enable mobile runs after execution and spending review.</Text>
          <Text style={styles.sub}>Budget field: $0.10. Current worker checks an estimate, not an enforced provider charge ceiling. Submission stays disabled by default.</Text>
          {!runSubmissionEnabled ? <Text style={styles.bad}>Mobile run submission is not enabled on this Dock.</Text> : null}
          <Pressable style={[styles.button, !runSubmissionEnabled && styles.buttonDisabled]}
            onPress={queueRun} disabled={busy || !newTitle.trim() || !runSubmissionEnabled}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Submit text run</Text>}
          </Pressable>
        </ScrollView>
      )}
      <View style={styles.tabs}>
        {(["runs", "approvals", "new"] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={styles.tabItem}>
            <Text style={tab === t ? styles.tabActive : styles.tabInactive}>
              {t === "approvals" && pendingCards.length > 0 ? `Approvals (${pendingCards.length})` : t[0].toUpperCase() + t.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#07070c", padding: 16 },
  h1: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 4 },
  sub: { color: "#a1a1aa", fontSize: 13, marginBottom: 12 },
  input: { backgroundColor: "#0a0a0f", borderColor: "#1a1a2e", borderWidth: 1, borderRadius: 8, color: "#fff", padding: 12, marginBottom: 10 },
  messageInput: { flex: 1, marginBottom: 0, marginRight: 8 },
  button: { backgroundColor: "#6366f1", borderRadius: 8, padding: 12, alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#fff", fontWeight: "600" },
  back: { color: "#818cf8", marginBottom: 8 },
  section: { marginBottom: 18 },
  column: { color: "#71717a", fontSize: 12, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
  task: { backgroundColor: "#0a0a0f", borderColor: "#1a1a2e", borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 6 },
  repoSelected: { borderColor: "#6366f1" },
  taskTitle: { color: "#e4e4e7", fontSize: 15 },
  card: { backgroundColor: "#0a0a0f", borderColor: "#1a1a2e", borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
  cardTitle: { color: "#fff", fontWeight: "600", fontSize: 13 },
  pill: { color: "#22c55e", backgroundColor: "rgba(34,197,94,0.12)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, fontSize: 11 },
  mono: { color: "#a1a1aa", fontFamily: "Menlo", fontSize: 12, marginBottom: 6 },
  stat: { color: "#71717a", fontFamily: "Menlo", fontSize: 11, marginBottom: 6 },
  ok: { color: "#22c55e", fontSize: 12, marginBottom: 4 },
  bad: { color: "#ef4444", fontSize: 12, marginBottom: 4 },
  note: { color: "#52525b", fontSize: 11 },
  approve: { backgroundColor: "#16a34a", flex: 1, marginRight: 6 },
  reject: { backgroundColor: "#b91c1c", flex: 1, marginLeft: 6 },
  buttonDisabled: { opacity: 0.4 },
  demoBadge: { color: "#f59e0b", fontSize: 11, fontWeight: "700", marginBottom: 8 },
  tabs: { flexDirection: "row", borderTopColor: "#1a1a2e", borderTopWidth: 1, paddingTop: 10 },
  tabItem: { flex: 1, alignItems: "center" },
  tabActive: { color: "#fff", fontWeight: "700" },
  tabInactive: { color: "#52525b" },
})
