import test from "node:test";
import assert from "node:assert/strict";
import { permissionsFor, modeForColumn } from "../lib/tool-permissions.ts";

const TOOLS = ["read", "write", "edit", "bash", "grep", "glob", "webfetch", "diagnostics", "memory"];

test("plan mode permissions", () => {
  const perms = Object.fromEntries(permissionsFor("plan").map(p => [p.tool, p]));
  assert.deepEqual(TOOLS.sort(), Object.keys(perms).sort());
  for (const t of ["read", "grep", "glob", "webfetch"]) assert.deepEqual(perms[t], { tool: t, allowed: true, ask: false });
  for (const t of ["write", "edit", "diagnostics"]) assert.deepEqual(perms[t], { tool: t, allowed: false, ask: false });
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
  for (const t of ["write", "edit", "webfetch", "diagnostics", "memory"]) {
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
