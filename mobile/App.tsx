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
import * as Notifications from "expo-notifications"

// Dock mobile: thin native client for Dock's HTTP APIs. Dock stays the board
// and the harness; this app is how the owner works tasks, isolated-run reviews,
// approvals and messages from the phone. Authenticates with the scoped
// DOCK_MOBILE_TOKEN (never the superuser agent token), stored in the Keychain.

type Task = { id: string; title: string; column: string; assignee?: string; priority?: string; description?: string }
type WorktreeReview = {
  worktree: { path: string | null; branch: string | null; baseRef: string } | null
  diff: { aheadBy: number; stat: string; commits: string } | null
  verification?: { ok: boolean; problems: string[] } | null
}
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
type ThreadMessage = { id: string; from: string; content: string; taskId?: string; timestamp: string }
type Tab = "runs" | "board" | "approvals" | "new"

const COLUMNS = ["backlog", "planning", "in-progress", "in-review", "done"]

// Demo mode (web preview only, ?demo=board|approvals|task|new): fictional data,
// clearly badged, never touches a network. Used to preview the views.
const DEMO_TASKS: Task[] = [
  { id: "task-demo1", title: "Reconcile October Paybox ledger", column: "in-progress", assignee: "baron", priority: "high", description: "Fictional demo task" },
  { id: "task-demo2", title: "Draft Chateau launch brief", column: "planning", assignee: "scout", priority: "medium" },
  { id: "task-demo3", title: "Weekly standup summary", column: "done", assignee: "chief" },
]
const DEMO_REVIEW: WorktreeReview = {
  worktree: { path: "/demo/.dock-worktrees/paybox/task-demo1", branch: "dock/task-task-demo1", baseRef: "main" },
  diff: {
    aheadBy: 2,
    stat: [
      " ledger/reconcile.ts | 84 ++++++++",
      " ledger/report.ts    |  12 +--",
      " 2 files changed, 90 insertions(+), 6 deletions(-)",
    ].join("\n"),
    commits: ["a1b2c3d reconcile payouts", "e4f5g6h add report rollup"].join("\n"),
  },
  verification: { ok: true, problems: [] },
}
const DEMO_RUNS: Run[] = []
const DEMO_CARDS: ApprovalCard[] = [
  {
    runId: "run-demo1", status: "pending",
    proposal: "Fictional: pay contractor invoice INV-2041",
    target: "Fictional Vendor LLC",
    estimatedLabel: "$480.00", budgetLabel: "$1.00",
    projectName: "Paybox", model: "demo",
    requiresConfirm: true, canDecide: true,
    footer: "Approving lets the agent continue. Money moves only through the payment step.",
  },
]

async function demoApi<T>(path: string): Promise<T | null> {
  if (path === "/api/tasks") return DEMO_TASKS as T
  if (path === "/api/runs") return { runs: DEMO_RUNS } as T
  if (path === "/api/mobile/approvals") return { cards: DEMO_CARDS } as T
  if (path === "/api/repos") return { repos: ["/demo/shipyard/paybox"] } as T
  if (path.includes("/worktree")) return DEMO_REVIEW as T
  return null
}

async function api<T>(base: string, token: string, path: string, init?: RequestInit): Promise<T | null> {
  if (base === "demo") return demoApi<T>(path)
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
  const [tasks, setTasks] = useState<Task[]>([])
  const [selected, setSelected] = useState<Task | null>(null)
  const [thread, setThread] = useState<ThreadMessage[]>([])
  const [review, setReview] = useState<WorktreeReview | null>(null)
  const [selectedRun, setSelectedRun] = useState<string | null>(null)
  const [runSubmissionEnabled, setRunSubmissionEnabled] = useState(false)
  const [runs, setRuns] = useState<Run[]>([])
  const [cards, setCards] = useState<ApprovalCard[]>([])
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  const [repos, setRepos] = useState<string[]>([])
  const [newTitle, setNewTitle] = useState("")
  const [newRepo, setNewRepo] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      // Web preview: ?demo=board|approvals|task|new renders the views on fictional data.
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const demo = new URLSearchParams(window.location.search).get("demo")
        if (demo) {
          setConnected({ base: "demo", token: "demo" })
          setTab("board")
          if (demo === "approvals") setTab("approvals")
          if (demo === "new") setTab("new")
          if (demo === "task") setSelected(DEMO_TASKS[0])
          return
        }
      }
      const base = await store.get("dock:url")
      const saved = await store.get("dock:token")
      if (base && saved) setConnected({ base, token: saved })
    })()
  }, [])

  // Register for push and hand the Expo token to Dock (notify pipeline fans out).
  const registerPush = useCallback(async (base: string, tok: string) => {
    if (Platform.OS === "web") return // push registration is native-only
    const perm = await Notifications.requestPermissionsAsync().catch(() => null)
    if (!perm?.granted) { setError("Notifications are not enabled. You can keep using the board."); return }
    const pushToken = await Notifications.getExpoPushTokenAsync({ projectId: "5615ef1b-3373-4ace-9784-ebe9438e3586" }).catch(() => null)
    if (pushToken) {
      await store.set("dock:pushToken", pushToken.data)
      const saved = await api(base, tok, "/api/mobile/push-token", {
        method: "POST",
        body: JSON.stringify({ token: pushToken.data, platform: "ios" }),
      })
      setError(saved ? null : "Push registration was not confirmed by Dock.")
    } else { setError("This build cannot register push. A signed native build and APNs setup may be required.") }
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
  }, [dockUrl, token, registerPush])

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
    if (tab !== "board" && !selected) return
    const list = await api<Task[] | { tasks: Task[] }>(connected.base, connected.token, "/api/tasks")
    if (!list) { setCards([]); setError("Dock could not refresh. Showing the last loaded board. Check your connection or pair again."); return }
    setTasks(Array.isArray(list) ? list : list.tasks)
    const repoData = await api<{ repos: string[] }>(connected.base, connected.token, "/api/repos")
    setRepos(repoData?.repos ?? [])
  }, [connected, tab, selected])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 30000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    if (!selected || !connected) return
    setThread([])
    let active = true
    const load = async () => {
      const [reviewData, messageData] = await Promise.all([
        api<WorktreeReview>(connected.base, connected.token, `/api/tasks/${encodeURIComponent(selected.id)}/worktree`),
        api<ThreadMessage[]>(connected.base, connected.token, "/api/messages?canonical=1&limit=200"),
      ])
      if (!active) return
      setReview(reviewData)
      if (messageData) setThread(messageData.filter((m) => m.taskId === selected.id).reverse())
    }
    load()
    const timer = setInterval(load, 30000)
    return () => { active = false; clearInterval(timer) }
  }, [selected, connected])

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

  const sendMessage = useCallback(async () => {
    if (!connected || !selected || !message.trim()) return
    const result = await api(connected.base, connected.token, "/api/messages", {
      method: "POST",
      body: JSON.stringify({
        from: "owner",
        to: selected.assignee || "unassigned",
        content: message.trim(),
        type: "question",
        taskId: selected.id,
        taskTitle: selected.title,
      }),
    })
    if (!result) { setError("Message was not confirmed. Your text is still here. Check the thread before resending."); return }
    setError(null)
    setMessage("")
    const messages = await api<ThreadMessage[]>(connected.base, connected.token, "/api/messages?canonical=1&limit=200")
    if (messages) setThread(messages.filter((m) => m.taskId === selected.id).reverse())
  }, [connected, selected, message])

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

  const demo = connected.base === "demo"
  const demoBadge = demo ? <Text style={styles.demoBadge}>DEMO - fictional data</Text> : null

  if (selectedRun) {
    const run = runs.find((r) => r.id === selectedRun)
    return <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <Pressable onPress={() => setSelectedRun(null)}><Text style={styles.back}>‹ Runs</Text></Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.bad}>{error}</Text> : null}
      <ScrollView>
        <Text style={styles.h1}>{run?.payload?.prompt || "Run"}</Text>
        <Text style={styles.sub}>{run?.status || "Waiting for Dock to return this run"}</Text>
        <Text style={styles.note}>Text generation only. This is not a sandbox coding run or a verified external action.</Text>
        {run?.output ? <Text selectable style={styles.taskTitle}>{run.output}</Text> : null}
        {run?.error ? <Text style={styles.bad}>{run.error}</Text> : null}
        {!run?.output && !run?.error ? <Text style={styles.sub}>No result yet. Dock stores the result when the worker finishes.</Text> : null}
        <Pressable onPress={refresh}><Text style={styles.back}>Refresh run</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  }

  if (selected) {
    const r = review
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <Pressable onPress={() => { setSelected(null); setReview(null) }}>
          <Text style={styles.back}>‹ Board</Text>
        </Pressable>
        <ScrollView>
          {error ? <Text accessibilityRole="alert" style={styles.bad}>{error}</Text> : null}
          {demoBadge}
          <Text style={styles.h1}>{selected.title}</Text>
          <Text style={styles.sub}>{selected.column}{selected.assignee ? ` · ${selected.assignee}` : ""}</Text>
          {r?.worktree?.branch ? (
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>Isolated run</Text>
                <Text style={styles.pill}>{r.diff ? `${r.diff.aheadBy} commit${r.diff.aheadBy === 1 ? "" : "s"}` : "no commits yet"}</Text>
              </View>
              <Text style={styles.mono}>Branch {r.worktree.branch} from {r.worktree.baseRef}</Text>
              {r.diff?.stat ? <Text style={styles.stat}>{r.diff.stat}</Text> : null}
              {r.verification ? (
                <Text style={r.verification.ok ? styles.ok : styles.bad}>
                  {r.verification.ok ? "Worktree verified: contained, on its task branch." : `Problem: ${r.verification.problems.join("; ")}`}
                </Text>
              ) : null}
              <Text style={styles.note}>Review the diff in the worktree, then merge yourself. The agent does not push or merge.</Text>
            </View>
          ) : (
            <Text style={styles.sub}>{r ? "No isolated run for this task." : "Loading…"}</Text>
          )}
          <Text style={styles.cardTitle}>Messages and results</Text>
          {thread.length === 0 ? <Text style={styles.sub}>No result messages loaded yet.</Text> : thread.map((m) => (
            <View key={m.id} style={styles.card}>
              <Text style={styles.sub}>{m.from}</Text>
              <Text style={styles.taskTitle}>{m.content}</Text>
            </View>
          ))}
          <View style={styles.row}>
            <TextInput style={[styles.input, styles.messageInput]} placeholder="Message the agent…"
              placeholderTextColor="#52525b" value={message} onChangeText={setMessage} />
            <Pressable style={styles.button} onPress={sendMessage}><Text style={styles.buttonText}>Send</Text></Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    )
  }

  const pendingCards = cards.filter((card) => card.status === "pending" && card.canDecide)

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      {demoBadge}
      {error ? <Text accessibilityRole="alert" style={styles.bad}>{error}</Text> : null}
      {Platform.OS !== "web" ? <Pressable onPress={() => registerPush(connected.base, connected.token)}><Text style={styles.back}>Enable task notifications</Text></Pressable> : null}
      <View style={styles.row}>
        <Pressable onPress={refresh}><Text style={styles.back}>Refresh</Text></Pressable>
        <Pressable onPress={async () => {
          await store.remove("dock:token"); await store.remove("dock:url");
          setConnected(null); setTasks([]); setCards([]); setSelected(null); setToken(""); setError(null)
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
      {tab === "board" && (
        <FlatList
          data={COLUMNS.map((c) => ({ column: c, tasks: tasks.filter((t) => t.column === c) }))}
          keyExtractor={(s) => s.column}
          renderItem={({ item: section }: { item: { column: string; tasks: Task[] } }) => (
            <View style={styles.section}>
              <Text style={styles.column}>{section.column} · {section.tasks.length}</Text>
              {section.tasks.map((t: Task) => (
                <Pressable key={t.id} style={styles.task} onPress={() => setSelected(t)}>
                  <Text style={styles.taskTitle}>{t.title}</Text>
                </Pressable>
              ))}
            </View>
          )}
        />
      )}
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
          <Text style={styles.note}>Text-only cloud run. No code execution, browser, or external actions. The server must enable mobile runs after execution and spending review.</Text>
          <Text style={styles.note}>Budget field: $0.10. Current worker checks an estimate, not an enforced provider charge ceiling. Submission stays disabled by default.</Text>
          {!runSubmissionEnabled ? <Text style={styles.bad}>Mobile run submission is not enabled on this Dock.</Text> : null}
          <Pressable style={[styles.button, !runSubmissionEnabled && styles.buttonDisabled]}
            onPress={queueRun} disabled={busy || !newTitle.trim() || !runSubmissionEnabled}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Submit text run</Text>}
          </Pressable>
        </ScrollView>
      )}
      <View style={styles.tabs}>
        {(["runs", "board", "approvals", "new"] as Tab[]).map((t) => (
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
