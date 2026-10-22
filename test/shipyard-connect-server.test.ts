import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  startShipyardConnect, finishShipyardConnect, routeKeyForWorkspace, disconnectShipyard, connectionView,
} from "../lib/shipyard-connect-server.ts";
import { encryptSecret, pkceChallenge, decryptSecret } from "../lib/shipyard-connect.ts";

const ENC = randomBytes(32).toString("base64");
const ENV = {
  SHIPYARD_CONNECT_ENC_KEY: ENC,
  SHIPYARD_CLIENT_SECRET: "client-secret-test-value-0123456789abcdef",
  SHIPYARD_INFERENCE_ORIGIN: "https://gw.example",
} as NodeJS.ProcessEnv;
const REDIRECT = "https://dock.example/api/connect/shipyard/callback";
const WS = "11111111-2222-3333-4444-555555555555";
const OWNER = "owner-user-1";

// Minimal chainable fake of the supabase-js calls the connect code makes.
function fakeAdmin(seed: { states?: any[]; connections?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    workspace_shipyard_connect_states: [...(seed.states ?? [])],
    workspace_shipyard_connections: [...(seed.connections ?? [])],
  };
  const match = (row: any, filters: Array<[string, string, unknown]>) =>
    filters.every(([op, col, val]) => (op === "eq" ? row[col] === val : op === "is" ? (row[col] ?? null) === val : true));
  const from = (table: string) => {
    const rows = tables[table]!;
    let filters: Array<[string, string, unknown]> = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: any;
    let returning = false;
    const run = () => {
      if (op === "insert") {
        const row = { id: `id-${rows.length + 1}`, revoked_at: null, ...payload };
        rows.push(row);
        return { data: [row], error: null };
      }
      const hit = rows.filter((r) => match(r, filters));
      if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); return { data: hit, error: null }; }
      if (op === "delete") { for (const r of hit) rows.splice(rows.indexOf(r), 1); return { data: hit, error: null }; }
      return { data: hit, error: null };
    };
    const b: any = {
      select() { if (op === "select") { /* plain select */ } else returning = true; return b; },
      insert(p: any) { op = "insert"; payload = p; return b; },
      update(p: any) { op = "update"; payload = p; return b; },
      delete() { op = "delete"; return b; },
      eq(c: string, v: unknown) { filters.push(["eq", c, v]); return b; },
      is(c: string, v: unknown) { filters.push(["is", c, v]); return b; },
      maybeSingle() { return Promise.resolve({ data: run().data[0] ?? null, error: null }); },
      then(res: any, rej: any) { return Promise.resolve(run()).then(res, rej); },
    };
    void returning;
    return b;
  };
  return { from, tables } as any;
}

function gatewayOk(extra: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const f = (async (url: string, init: any) => {
    calls.push({ url: String(url), body: init.body as URLSearchParams });
    return new Response(JSON.stringify({ access_token: "sk-shipyard-TESTKEY", key_id: "key_1", scope: "chat:write route:preview", budget_usd: 10, ...extra }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test("start: stores a sealed verifier and returns an authorize URL with only the challenge", async () => {
  const admin = fakeAdmin();
  const r = await startShipyardConnect(admin, { userId: OWNER, workspaceId: WS, redirectUri: REDIRECT }, ENV);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const u = new URL(r.url);
  assert.equal(u.origin, "https://gw.example");
  assert.equal(u.pathname, "/oauth/authorize");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("workspace"), WS);
  assert.equal(u.searchParams.get("redirect_uri"), REDIRECT);
  const row = admin.tables.workspace_shipyard_connect_states[0];
  assert.equal(row.owner, OWNER);
  assert.ok(!JSON.stringify(admin.tables).includes("code_verifier"));
  const verifier = decryptSecret(row.verifier_sealed, ENC);
  assert.equal(pkceChallenge(verifier), u.searchParams.get("code_challenge"));
});

test("finish: happy path exchanges with verifier + client secret, seals the key, never returns it", async () => {
  const admin = fakeAdmin();
  const s = await startShipyardConnect(admin, { userId: OWNER, workspaceId: WS, redirectUri: REDIRECT }, ENV);
  const state = new URL((s as any).url).searchParams.get("state")!;
  const gw = gatewayOk();
  const r = await finishShipyardConnect(admin, { userId: OWNER, state, code: "the-code", redirectUri: REDIRECT }, ENV, gw.f);
  assert.deepEqual(r, { ok: true, workspaceId: WS });
  assert.equal(gw.calls.length, 1);
  assert.equal(gw.calls[0]!.url, "https://gw.example/oauth/token");
  assert.equal(gw.calls[0]!.body.get("client_secret"), ENV.SHIPYARD_CLIENT_SECRET);
  assert.ok(gw.calls[0]!.body.get("code_verifier"));
  const conn = admin.tables.workspace_shipyard_connections[0];
  assert.equal(conn.key_id, "key_1");
  assert.equal(conn.budget_usd, 10);
  assert.ok(!JSON.stringify(admin.tables.workspace_shipyard_connections).includes("sk-shipyard-TESTKEY"), "stored sealed, not plain");
  assert.equal(decryptSecret(conn.encrypted_key, ENC), "sk-shipyard-TESTKEY");
  assert.equal(JSON.stringify(r).includes("sk-shipyard"), false);
});

test("finish: replayed state, expired state, other user, denial and failed exchange are all refused", async () => {
  const admin = fakeAdmin();
  const s = await startShipyardConnect(admin, { userId: OWNER, workspaceId: WS, redirectUri: REDIRECT }, ENV);
  const state = new URL((s as any).url).searchParams.get("state")!;
  const gw = gatewayOk();
  assert.deepEqual(await finishShipyardConnect(admin, { userId: "someone-else", state, code: "c", redirectUri: REDIRECT }, ENV, gw.f), { ok: false, error: "user_mismatch" }, "state row is consumed even on mismatch");

  const s2 = await startShipyardConnect(fakeAdmin(), { userId: OWNER, workspaceId: WS, redirectUri: REDIRECT }, ENV);
  assert.equal(await finishShipyardConnect(fakeAdmin(), { userId: OWNER, state: "x".repeat(20), code: "c", redirectUri: REDIRECT }, ENV, gw.f).then((r) => r.ok), false, "unknown state");

  const adminExp = fakeAdmin();
  const s3 = await startShipyardConnect(adminExp, { userId: OWNER, workspaceId: WS, redirectUri: REDIRECT, now: 1000 }, ENV);
  const st3 = new URL((s3 as any).url).searchParams.get("state")!;
  assert.deepEqual(await finishShipyardConnect(adminExp, { userId: OWNER, state: st3, code: "c", redirectUri: REDIRECT, now: 1000 + 11 * 60_000 }, ENV, gw.f), { ok: false, error: "state_expired" });

  assert.deepEqual(await finishShipyardConnect(fakeAdmin(), { userId: OWNER, state: null, code: null, error: "access_denied", redirectUri: REDIRECT }, ENV, gw.f), { ok: false, error: "denied" });

  const adminBad = fakeAdmin();
  const s4 = await startShipyardConnect(adminBad, { userId: OWNER, workspaceId: WS, redirectUri: REDIRECT }, ENV);
  const st4 = new URL((s4 as any).url).searchParams.get("state")!;
  const bad = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
  assert.deepEqual(await finishShipyardConnect(adminBad, { userId: OWNER, state: st4, code: "c", redirectUri: REDIRECT }, ENV, bad), { ok: false, error: "exchange_failed" });
  assert.equal(adminBad.tables.workspace_shipyard_connections.length, 0, "no connection stored on failure");
});

test("route key: the workspace connection wins; global only when none exists; error when the sealed key cannot be opened", async () => {
  const sealed = encryptSecret("sk-shipyard-WORKSPACE", ENC);
  const conn = { id: "c1", workspace_id: WS, owner: OWNER, key_id: "k", encrypted_key: sealed, revoked_at: null };
  const withConn = fakeAdmin({ connections: [conn] });
  const env = { ...ENV, SHIPYARD_ROUTE_KEY: "sk-shipyard-GLOBAL" } as NodeJS.ProcessEnv;
  assert.deepEqual(await routeKeyForWorkspace(withConn, WS, env), { source: "connection", key: "sk-shipyard-WORKSPACE" });
  assert.deepEqual(await routeKeyForWorkspace(fakeAdmin(), WS, env), { source: "global", key: "sk-shipyard-GLOBAL" });
  assert.deepEqual(await routeKeyForWorkspace(fakeAdmin(), WS, { ...ENV } as NodeJS.ProcessEnv), { source: "none" });
  const broken = fakeAdmin({ connections: [{ ...conn, encrypted_key: "v1.bad.bad.bad" }] });
  assert.deepEqual(await routeKeyForWorkspace(broken, WS, env), { source: "error" }, "no silent fallback to the global key");
  const revoked = fakeAdmin({ connections: [{ ...conn, revoked_at: "2026-01-01" }] });
  assert.deepEqual(await routeKeyForWorkspace(revoked, WS, env), { source: "global", key: "sk-shipyard-GLOBAL" });
});

test("disconnect: revokes at the gateway with the key, then retires the local key", async () => {
  const sealed = encryptSecret("sk-shipyard-TOREVOKE", ENC);
  const admin = fakeAdmin({ connections: [{ id: "c1", workspace_id: WS, owner: OWNER, key_id: "k", encrypted_key: sealed, revoked_at: null, scopes: ["chat:write"], budget_usd: 10, created_at: "t" }] });
  const gw = gatewayOk();
  const r = await disconnectShipyard(admin, { workspaceId: WS }, ENV, gw.f);
  assert.deepEqual(r, { ok: true, gatewayRevoked: true });
  assert.equal(gw.calls[0]!.url, "https://gw.example/oauth/revoke");
  assert.equal(gw.calls[0]!.body.get("token"), "sk-shipyard-TOREVOKE");
  const row = admin.tables.workspace_shipyard_connections[0];
  assert.equal(row.encrypted_key, "");
  assert.ok(row.revoked_at);
  assert.deepEqual(await connectionView(fakeAdmin({ connections: [row] }), WS), { connected: false });
});
