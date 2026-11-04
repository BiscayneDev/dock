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
type Run = { id: string; status: string; agentKey?: string; prompt?: string; proposedAction?: { type?: string } }
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
type Tab = "board" | "approvals" | "new"

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
  const [tab, setTab] = useState<Tab>("board")
  const [tasks, setTasks] = useState<Task[]>([])
  const [selected, setSelected] = useState<Task | null>(null)
  const [review, setReview] = useState<WorktreeReview | null>(null)
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
      if (typeof window !== "undefined") {
        const demo = new URLSearchParams(window.location.search).get("demo")
        if (demo) {
          setConnected({ base: "demo", token: "demo" })
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
    if (!perm?.granted) return
    const pushToken = await Notifications.getExpoPushTokenAsync().catch(() => null)
    if (pushToken) {
      await store.set("dock:pushToken", pushToken.data)
      await api(base, tok, "/api/mobile/push-token", {
        method: "POST",
        body: JSON.stringify({ token: pushToken.data, platform: "ios" }),
      })
    }
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
    registerPush(base, paired.deviceToken)
  }, [dockUrl, token, registerPush])

  const refresh = useCallback(async () => {
    if (!connected) return
    const list = await api<Task[] | { tasks: Task[] }>(connected.base, connected.token, "/api/tasks")
    setTasks(Array.isArray(list) ? list : list?.tasks ?? [])
    const runData = await api<{ runs: Run[] }>(connected.base, connected.token, "/api/runs")
    const cardData = await api<{ cards: ApprovalCard[] }>(connected.base, connected.token, "/api/mobile/approvals")
    setCards(cardData?.cards ?? [])
    setRuns(runData?.runs ?? [])
    const repoData = await api<{ repos: string[] }>(connected.base, connected.token, "/api/repos")
    setRepos(repoData?.repos ?? [])
  }, [connected])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 30000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    if (!selected || !connected) return
    api<WorktreeReview>(connected.base, connected.token, `/api/tasks/${encodeURIComponent(selected.id)}/worktree`).then(setReview)
  }, [selected, connected])

  const createAndActivate = useCallback(async () => {
    if (!connected || !newTitle.trim()) return
    setBusy(true)
    const created = await api<Task>(connected.base, connected.token, "/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: newTitle.trim(), column: "in-progress" }),
    })
    if (created?.id) {
      await api(connected.base, connected.token, "/api/tasks/activate", {
        method: "POST",
        body: JSON.stringify({
          taskId: created.id,
          title: created.title,
          assignee: "builder",
          priority: "medium",
          ...(newRepo ? { repoPath: newRepo } : {}),
        }),
      })
      setNewTitle("")
      setTab("board")
      await refresh()
    }
    setBusy(false)
  }, [connected, newTitle, newRepo, refresh])

  const decide = useCallback(async (runId: string, decision: "approve" | "reject") => {
    if (!connected) return
    setConfirmed((prev) => ({ ...prev, [runId]: false }))
    await api(connected.base, connected.token, `/api/runs/${encodeURIComponent(runId)}/${decision}`, { method: "POST" })
    await refresh()
  }, [connected, refresh])

  const sendMessage = useCallback(async () => {
    if (!connected || !selected || !message.trim()) return
    await api(connected.base, connected.token, "/api/messages", {
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
    setMessage("")
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

  if (selected) {
    const r = review
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <Pressable onPress={() => { setSelected(null); setReview(null) }}>
          <Text style={styles.back}>‹ Board</Text>
        </Pressable>
        <ScrollView>
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
          <Text style={styles.sub}>Run in an isolated worktree of:</Text>
          {repos.map((repo) => (
            <Pressable key={repo} style={[styles.task, newRepo === repo && styles.repoSelected]} onPress={() => setNewRepo(newRepo === repo ? null : repo)}>
              <Text style={styles.mono}>{repo}</Text>
            </Pressable>
          ))}
          {repos.length === 0 ? <Text style={styles.note}>No registered repos - register one in Dock first (POST /api/repos).</Text> : null}
          <Pressable
            style={[styles.button, (repos.length > 0 && !newRepo) && styles.buttonDisabled]}
            onPress={createAndActivate}
            disabled={busy || !newTitle.trim() || (repos.length > 0 && !newRepo)}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create + activate (isolated)</Text>}
          </Pressable>
          {repos.length > 0 && !newRepo ? (
            <Text style={styles.note}>Pick a repo: coding tasks always run isolated, never on the host checkout.</Text>
          ) : null}
        </ScrollView>
      )}
      <View style={styles.tabs}>
        {(["board", "approvals", "new"] as Tab[]).map((t) => (
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
