import test from "node:test";
import assert from "node:assert/strict";
import { resolveRunMode } from "../lib/agent-mode.ts";
import { TEAM_TEMPLATES } from "../lib/agent-templates.ts";
import { modeForColumn } from "../lib/tool-permissions.ts";
import { templateAgentExplore } from "../lib/agent-templates.ts";

test("explore flag on agent overrides column mapping", () => {
  assert.deepEqual(resolveRunMode({ explore: true }, "In Progress"), "explore");
});

test("valid payload.mode is respected", () => {
  for (const mode of ["plan", "build", "explore"]) {
    assert.deepEqual(resolveRunMode({ mode }, "In Progress"), mode);
  }
});

test("invalid payload.mode falls back to column mapping", () => {
  assert.deepEqual(resolveRunMode({ mode: "yolo" }, "In Progress"), "build");
  assert.deepEqual(resolveRunMode({ mode: 42 }, "Backlog"), "plan");
});

test("no explore flag, no mode -> modeForColumn", () => {
  for (const col of ["Backlog", "Planned", "Plan Review"]) {
    assert.deepEqual(resolveRunMode({}, col), "plan");
  }
  for (const col of ["In Progress", "Review", "Testing"]) {
    assert.deepEqual(resolveRunMode({}, col), "build");
  }
  assert.deepEqual(resolveRunMode({}, "Unknown"), modeForColumn("Unknown"));
});

test("payload.mode beats explore flag", () => {
  assert.deepEqual(resolveRunMode({ mode: "build", explore: true }, "Backlog"), "build");
});

test("Scout agents are marked explore", () => {
  for (const team of TEAM_TEMPLATES) {
    for (const agent of team.agents) {
      if (agent.role === "Researcher" || agent.role === "Field Researcher") {
        assert.equal(agent.explore, true, `${team.id}/${agent.id} should be explore`);
      }
    }
  }
});

test("templateAgentExplore resolves the template default", () => {
  assert.equal(templateAgentExplore("researcher"), true);
  assert.equal(templateAgentExplore("scout"), true);
  assert.equal(templateAgentExplore("chief"), false);
  assert.equal(templateAgentExplore("engineer"), false);
  assert.equal(templateAgentExplore("nobody"), false);
});
