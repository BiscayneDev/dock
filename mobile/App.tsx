import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator, FlatList, Pressable, SafeAreaView, StyleSheet,
  Text, TextInput, View,
} from "react-native"
import { StatusBar } from "expo-status-bar"
import * as SecureStore from "expo-secure-store"
import * as Notifications from "expo-notifications"

// Dock mobile: thin native client for Dock's HTTP APIs. Dock stays the board
// and the harness; this app is how the owner sees tasks, isolated-run reviews
// and (next) approvals from the phone.

type Task = { id: string; title: string; column: string; assignee?: string; priority?: string; description?: string }
type WorktreeReview = {
  worktree: { path: string | null; branch: string | null; baseRef: string } | null
  diff: { aheadBy: number; stat: string; commits: string } | null
  verification?: { ok: boolean; problems: string[] } | null
}

const COLUMNS = ["backlog", "planning", "in-progress", "in-review", "done"]

async function api<T>(base: string, token: string, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}`, "x-dock-agent-token": token },
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
  const [tasks, setTasks] = useState<Task[]>([])
  const [selected, setSelected] = useState<Task | null>(null)
  const [review, setReview] = useState<WorktreeReview | null>(null)
  const [loading, setLoading] = useState(false)

  // Restore the saved connection and register for push on launch.
  useEffect(() => {
    ;(async () => {
      const base = await SecureStore.getItemAsync("dock:url")
      const saved = await SecureStore.getItemAsync("dock:token")
      if (base && saved) setConnected({ base, token: saved })
      const perm = await Notifications.requestPermissionsAsync()
      if (perm.granted) {
        // Stored for now; Dock's notify pipeline sends to Expo Push Service next.
        await Notifications.getExpoPushTokenAsync().then((t) => SecureStore.setItemAsync("dock:pushToken", t.data)).catch(() => null)
      }
    })()
  }, [])

  const connect = useCallback(async () => {
    const base = dockUrl.trim().replace(/\/$/, "")
    if (!base || !token.trim()) return
    setLoading(true)
    const ok = await api<Task[]>(base, token.trim(), "/api/tasks")
    setLoading(false)
    if (!ok) return
    await SecureStore.setItemAsync("dock:url", base)
    await SecureStore.setItemAsync("dock:token", token.trim())
    setConnected({ base, token: token.trim() })
  }, [dockUrl, token])

  const refresh = useCallback(async () => {
    if (!connected) return
    const list = await api<Task[] | { tasks: Task[] }>(connected.base, connected.token, "/api/tasks")
    const arr = Array.isArray(list) ? list : list?.tasks ?? []
    setTasks(arr)
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

  if (!connected) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <Text style={styles.h1}>Dock</Text>
        <Text style={styles.sub}>Connect to your Dock.</Text>
        <TextInput style={styles.input} placeholder="Dock URL (https://your-dock...)" placeholderTextColor="#52525b"
          autoCapitalize="none" autoCorrect={false} value={dockUrl} onChangeText={setDockUrl} />
        <TextInput style={styles.input} placeholder="Agent token" placeholderTextColor="#52525b"
          autoCapitalize="none" secureTextEntry value={token} onChangeText={setToken} />
        <Pressable style={styles.button} onPress={connect} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Connect</Text>}
        </Pressable>
      </SafeAreaView>
    )
  }

  if (selected) {
    const r = review
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <Pressable onPress={() => { setSelected(null); setReview(null) }}>
          <Text style={styles.back}>‹ Board</Text>
        </Pressable>
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
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <Text style={styles.h1}>Dock</Text>
      <FlatList
        data={COLUMNS.map((c) => ({ column: c, tasks: tasks.filter((t) => t.column === c) }))}
        keyExtractor={(s) => s.column}
        renderItem={({ item: section }) => (
          <View style={styles.section}>
            <Text style={styles.column}>{section.column} · {section.tasks.length}</Text>
            {section.tasks.map((t) => (
              <Pressable key={t.id} style={styles.task} onPress={() => setSelected(t)}>
                <Text style={styles.taskTitle}>{t.title}</Text>
              </Pressable>
            ))}
          </View>
        )}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#07070c", padding: 16 },
  h1: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 4 },
  sub: { color: "#a1a1aa", fontSize: 13, marginBottom: 12 },
  input: { backgroundColor: "#0a0a0f", borderColor: "#1a1a2e", borderWidth: 1, borderRadius: 8, color: "#fff", padding: 12, marginBottom: 10 },
  button: { backgroundColor: "#6366f1", borderRadius: 8, padding: 14, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "600" },
  back: { color: "#818cf8", marginBottom: 8 },
  section: { marginBottom: 18 },
  column: { color: "#71717a", fontSize: 12, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
  task: { backgroundColor: "#0a0a0f", borderColor: "#1a1a2e", borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 6 },
  taskTitle: { color: "#e4e4e7", fontSize: 15 },
  card: { backgroundColor: "#0a0a0f", borderColor: "#1a1a2e", borderWidth: 1, borderRadius: 10, padding: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardTitle: { color: "#fff", fontWeight: "600", fontSize: 13 },
  pill: { color: "#22c55e", backgroundColor: "rgba(34,197,94,0.12)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, fontSize: 11 },
  mono: { color: "#a1a1aa", fontFamily: "Menlo", fontSize: 12, marginBottom: 6 },
  stat: { color: "#71717a", fontFamily: "Menlo", fontSize: 11, marginBottom: 6 },
  ok: { color: "#22c55e", fontSize: 12, marginBottom: 4 },
  bad: { color: "#ef4444", fontSize: 12, marginBottom: 4 },
  note: { color: "#52525b", fontSize: 11 },
})
