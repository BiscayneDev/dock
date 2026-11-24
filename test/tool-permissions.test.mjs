import test from "node:test";
import assert from "node:assert/strict";
import { permissionsFor, modeForColumn, evaluateToolPolicy, DEFAULT_TOOL_DENY } from "../lib/tool-permissions.ts";

const TOOLS = ["read", "write", "edit", "bash", "grep", "glob", "webfetch", "diagnostics", "memory", "flag_knowledge"];

test("plan mode permissions", () => {
  const perms = Object.fromEntries(permissionsFor("plan").map(p => [p.tool, p]));
  assert.deepEqual(TOOLS.sort(), Object.keys(perms).sort());
  for (const t of ["read", "grep", "glob", "webfetch"]) assert.deepEqual(perms[t], { tool: t, allowed: true, ask: false });
  for (const t of ["write", "edit", "diagnostics", "flag_knowledge"]) assert.deepEqual(perms[t], { tool: t, allowed: false, ask: false });
  assert.deepEqual(perms.bash, { tool: "bash", allowed: false, ask: true });
  assert.deepEqual(perms.memory, { tool: "memory", allowed: true, ask: false });
});

test("build mode permissions", () => {
  const perms = Object.fromEntries(permissionsFor("build").map(p => [p.tool, p]));
  for (const t of TOOLS) assert.deepEqual(perms[t], { tool: t, allowed: true, ask: false });
});

test("explore mode permissions", () => {
  const perms = Object.fromEntries(permissionsFor("explore").map(p => [p.tool, p]));
  for (const t of ["read", "grep", "glob"]) assert.deepEqual(perms[t], { tool: t, allowed: true, ask: false });
  assert.deepEqual(perms.bash, { tool: "bash", allowed: false, ask: true });
  for (const t of ["write", "edit", "webfetch", "diagnostics", "memory", "flag_knowledge"]) {
    assert.deepEqual(perms[t], { tool: t, allowed: false, ask: false }, t);
  }
});

test("modeForColumn mappings", () => {
  for (const c of ["Backlog", "Planned", "Plan Review"]) assert.equal(modeForColumn(c), "plan", c);
  for (const c of ["In Progress", "Review", "Testing"]) assert.equal(modeForColumn(c), "build", c);
});

test("modeForColumn unknown column defaults to plan", () => {
  assert.equal(modeForColumn("Done"), "plan");
  assert.equal(modeForColumn(""), "plan");
  assert.equal(modeForColumn("Weird Column"), "plan");
});

import { EXPLORE_MODE_INSTRUCTION } from "../lib/tool-permissions.ts";

test("EXPLORE_MODE_INSTRUCTION exists and is non-trivial", () => {
  assert.equal(typeof EXPLORE_MODE_INSTRUCTION, "string");
  assert.ok(EXPLORE_MODE_INSTRUCTION.length > 20, "non-trivial length");
  assert.match(EXPLORE_MODE_INSTRUCTION, /READ-ONLY|research/i);
});

// ── Deny-by-default policy (WS5) ────────────────────────────────────────────────

test("policy ordering: deny beats ask beats allow", () => {
  const base = { mode: "build", tool: "read" };
  assert.equal(evaluateToolPolicy({ ...base, deny: ["read"], ask: ["read"], allow: ["read"] }), "deny");
  assert.equal(evaluateToolPolicy({ ...base, ask: ["read"], allow: ["read"] }), "ask");
  assert.equal(evaluateToolPolicy({ ...base, allow: ["read"] }), "allow");
  // bash defaults to ask in plan; allow promotes it, deny still wins.
  assert.equal(evaluateToolPolicy({ mode: "plan", tool: "bash" }), "ask");
  assert.equal(evaluateToolPolicy({ mode: "plan", tool: "bash", allow: ["bash"] }), "allow");
  assert.equal(evaluateToolPolicy({ mode: "plan", tool: "bash", deny: ["bash"], allow: ["bash"] }), "deny");
});

test("unknown tools are denied in every mode, even when explicitly allowed", () => {
  for (const mode of ["plan", "build", "explore"]) {
    assert.equal(evaluateToolPolicy({ mode, tool: "teleport" }), "deny", mode);
    assert.equal(evaluateToolPolicy({ mode, tool: "teleport", allow: ["teleport"], ask: ["teleport"] }), "deny", mode);
    assert.equal(evaluateToolPolicy({ mode, tool: "" }), "deny", mode);
  }
});

test("default denies are a floor: allow cannot lift them, workspace deny extends them", () => {
  for (const mode of ["plan", "build", "explore"]) {
    for (const tool of DEFAULT_TOOL_DENY[mode]) {
      assert.equal(evaluateToolPolicy({ mode, tool, allow: [tool] }), "deny", `${mode}:${tool}`);
    }
  }
  assert.equal(evaluateToolPolicy({ mode: "build", tool: "write", deny: ["write"] }), "deny");
  assert.equal(evaluateToolPolicy({ mode: "build", tool: "write" }), "allow");
});

test("evaluateToolPolicy matches permissionsFor defaults in all three modes", () => {
  for (const mode of ["plan", "build", "explore"]) {
    for (const p of permissionsFor(mode)) {
      const expected = p.allowed ? "allow" : p.ask ? "ask" : "deny";
      assert.equal(evaluateToolPolicy({ mode, tool: p.tool }), expected, `${mode}:${p.tool}`);
    }
  }
});

test("policy fails closed on malformed input", () => {
  assert.equal(evaluateToolPolicy({ mode: "nope", tool: "read" }), "deny");
  assert.equal(evaluateToolPolicy({ mode: "build", tool: 42 }), "deny");
});
