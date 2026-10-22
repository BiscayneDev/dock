import test from "node:test";
import assert from "node:assert/strict";
import { resolveRunMode } from "../lib/agent-mode.ts";
import { TEAM_TEMPLATES, templateAgentExplore, profile, skillInjectionBlock } from "../lib/agent-templates.ts";
import { modeForColumn } from "../lib/tool-permissions.ts";

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

test("profile() maps template agents to the unified shape", () => {
  const p = profile("researcher");
  assert.ok(p);
  assert.equal(p.key, "researcher");
  assert.equal(p.mode, "explore");
  assert.equal(p.explore, true);
  assert.ok(Array.isArray(p.skills) && p.skills.length > 0);
  assert.equal(typeof p.budgetCents, "number");

  const eng = profile("engineer");
  assert.equal(eng.mode, "build");
  assert.equal(eng.explore, undefined);
  assert.equal(eng.budgetCents, 10000);

  assert.equal(profile("nobody"), null);
});

test("profile() covers every template agent id", () => {
  for (const team of TEAM_TEMPLATES) {
    for (const agent of team.agents) {
      assert.ok(profile(agent.id), `${team.id}/${agent.id} should map to a profile`);
    }
  }
});

function fakeMatch(skills, query, n) {
  return skills.filter((s) => query.toLowerCase().includes(s.name.toLowerCase())).slice(0, n);
}

test("skillInjectionBlock: matches top skills, capped and bounded", () => {
  const skills = [
    { name: "React", description: "Build UIs in React", tags: ["react"] },
    { name: "CSS", description: "Style things", tags: ["css"] },
    { name: "Finance", description: "Money stuff", tags: ["money"] },
  ];
  const out = skillInjectionBlock(skills, "please build a React thing", fakeMatch);
  assert.ok(out.includes("React"));
  assert.ok(!out.includes("Finance"));
  assert.ok(out.length <= 400);
});

test("skillInjectionBlock: empty inputs yield null", () => {
  assert.equal(skillInjectionBlock([], "hi", fakeMatch), null);
  assert.equal(skillInjectionBlock([{ name: "A", description: "d", tags: [] }], "  ", fakeMatch), null);
});

test("skillInjectionBlock: truncates over-400-char output", () => {
  const skills = [{ name: "Big", description: "x".repeat(500), tags: [] }];
  const out = skillInjectionBlock(skills, "big", fakeMatch);
  assert.ok(out.length <= 400);
  assert.ok(out.endsWith("..."));
});
