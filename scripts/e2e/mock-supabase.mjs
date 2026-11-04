// Protocol-compatible local stand-in for Supabase (GoTrue + PostgREST subset)
// so the REAL Dock Next.js API routes can run end-to-end without a cloud project.
// Implements only what Dock's mobile path uses: auth getUser, select with
// eq/in/order/limit/count/head/maybeSingle, insert, update. Fictional seed data.
import http from "node:http"

const now = () => new Date().toISOString()
const tables = {
  workspaces: [{ id: "33333333-3333-4333-8333-333333333333", owner_id: "44444444-4444-4444-8444-444444444444", created_at: now() }],
  users: [{ id: "44444444-4444-4444-8444-444444444444", email: "demo@example.com" }],
  profiles: [{ user_id: "44444444-4444-4444-8444-444444444444" }],
  devices: [],
  agents: [],
  conversations: [],
  projects: [],
  task_runs: [
    { id: "11111111-1111-4111-8111-111111111111", workspace_id: "33333333-3333-4333-8333-333333333333", owner_id: "44444444-4444-4444-8444-444444444444", agent_key: "baron",
      prompt: "Fictional: pay $480.00 contractor invoice INV-2041", status: "awaiting_approval",
      target: "cloud", model: null, model_reason: null, budget_cents: 100, task_id: null,
      project_id: null, conversation_id: null, proposed_action: { type: "pay_invoice" },
      result: null, error: null, created_at: now(), updated_at: now() },
    { id: "55555555-5555-4555-8555-555555555555", workspace_id: "33333333-3333-4333-8333-333333333333", owner_id: "44444444-4444-4444-8444-444444444444", agent_key: "baron",
      prompt: "Fictional: legacy run without recorded proposal details", status: "awaiting_approval",
      target: "cloud", model: null, model_reason: null, budget_cents: 100, task_id: null,
      project_id: null, conversation_id: null, proposed_action: null,
      result: null, error: null, created_at: now(), updated_at: now() },
    { id: "22222222-2222-4222-8222-222222222222", workspace_id: "33333333-3333-4333-8333-333333333333", owner_id: "44444444-4444-4444-8444-444444444444", agent_key: "scout",
      prompt: "Fictional: summarize Chateau competitor notes", status: "succeeded",
      target: "cloud", model: null, model_reason: null, budget_cents: 100, task_id: null,
      project_id: null, conversation_id: null, proposed_action: null,
      result: { summary: "Fictional summary" }, error: null, created_at: now(), updated_at: now() },
  ],
  mobile_pairings: [],
  mobile_pairing_failures: [],
  mobile_devices: [],
  task_run_events: [
    { id: 1, run_id: "11111111-1111-4111-8111-111111111111", kind: "approval_requested",
      data: { actionId: "act-1", proposal: "Fictional: pay contractor invoice INV-2041",
              target: "Fictional Vendor LLC", amountCents: 48000, estimatedCents: 48000,
              model: "demo", budgetCents: 100 }, created_at: now() },
    { id: 2, run_id: "55555555-5555-4555-8555-555555555555", kind: "approval_requested",
      data: { actionId: "act-2" }, created_at: now() },
  ],
}
let nextEventId = 2

function match(row, filters) {
  return filters.every(([col, op, val]) => {
    if (op === "eq") return String(row[col]) === val
    if (op === "in") return val.includes(String(row[col]))
    if (op === "is") return ((row[col] ?? null) === null) === (val === "null")
    return true
  })
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x")
  res.setHeader("Content-Type", "application/json")
  if (u.pathname === "/auth/v1/user") {
    res.end(JSON.stringify({ id: "44444444-4444-4444-8444-444444444444", aud: "authenticated", email: "demo@example.com", created_at: now() }))
    return
  }
  const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/exchange_mobile_pairing$/)
  if (rpc && req.method === "POST") {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      const p = JSON.parse(body || "{}")
      const failures = tables.mobile_pairing_failures.filter(
        (f) => f.workspace_id === p.p_workspace_id && Date.now() - new Date(f.failed_at).getTime() < p.p_window_ms,
      )
      let outcome
      if (failures.length >= p.p_max_failures) outcome = "rate_limited"
      else {
        const row = tables.mobile_pairings
          .filter((x) => x.workspace_id === p.p_workspace_id && x.code_hash === p.p_code_hash)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
        if (!row || row.used || new Date(row.expires_at).getTime() < Date.now()) {
          tables.mobile_pairing_failures.push({ id: Date.now(), workspace_id: p.p_workspace_id, failed_at: now() })
          outcome = "invalid"
        } else { row.used = true; outcome = "ok" }
      }
      res.end(JSON.stringify(outcome))
    })
    return
  }
  const m = u.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)
  if (!m || !(m[1] in tables)) { res.statusCode = 404; res.end(JSON.stringify({ message: "not found" })); return }
  const table = tables[m[1]]
  const filters = [], inFilters = []
  let order = null, limit = null, headCount = false
  for (const [k, v] of u.searchParams) {
    if (k === "select") { if (v.includes("count=exact") && v.includes("head=true")) headCount = true; continue }
    if (k === "order") { order = v; continue }
    if (k === "limit") { limit = Number(v); continue }
    const eq = v.match(/^eq\.(.*)$/), isin = v.match(/^in\.\((.*)\)$/), is = v.match(/^is\.(.*)$/)
    if (eq) filters.push([k, "eq", eq[1]])
    else if (isin) filters.push([k, "in", isin[1].split(",")])
    else if (is) filters.push([k, "is", is[1]])
  }
  const wantsObject = (req.headers.accept || "").includes("vnd.pgrst.object+json")

  if (req.method === "GET" || req.method === "HEAD") {
    let rows = table.filter((r) => match(r, filters))
    if (order) {
      const [col, dir] = order.split(".")
      rows = [...rows].sort((a, b) => (String(a[col] ?? "") < String(b[col] ?? "") ? -1 : 1) * (dir === "desc" ? -1 : 1))
    }
    const total = rows.length
    if (limit) rows = rows.slice(0, limit)
    if (headCount || req.method === "HEAD") {
      res.setHeader("content-range", `0-0/${total}`)
      res.statusCode = 200; res.end(""); return
    }
    if (wantsObject) {
      if (rows.length === 0) {
        res.statusCode = 406
        res.end(JSON.stringify({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }))
        return
      }
      res.end(JSON.stringify(rows[0])); return
    }
    res.end(JSON.stringify(rows)); return
  }

  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    const payload = body ? JSON.parse(body) : {}
    const preferRep = (req.headers.prefer || "").includes("return=representation")
    if (req.method === "POST") {
      const items = (Array.isArray(payload) ? payload : [payload]).map((p) => ({
        id: p.id ?? (m[1] === "task_run_events" ? nextEventId++ : `id-${Math.random().toString(36).slice(2, 10)}`),
        created_at: now(), ...p,
      }))
      table.push(...items)
      if (!preferRep) { res.statusCode = 201; res.end(""); return }
      res.statusCode = 201
      res.end(wantsObject ? JSON.stringify(items[0]) : JSON.stringify(items)); return
    }
    if (req.method === "PATCH") {
      const updated = []
      for (const row of table) if (match(row, filters)) { Object.assign(row, payload, { updated_at: now() }); updated.push(row) }
      res.end(preferRep ? JSON.stringify(updated) : ""); return
    }
    res.statusCode = 405; res.end("{}")
  })
})
server.listen(4599, "127.0.0.1", () => console.log("mock supabase on 4599"))
