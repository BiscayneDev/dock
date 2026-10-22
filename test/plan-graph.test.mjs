import test from "node:test";
import assert from "node:assert/strict";
import { parsePlanGraph, topoOrder, PLAN_GRAPH_INSTRUCTION } from "../lib/plan-graph.ts";

function block(nodes) {
  return `Some prose plan here.\n\n\`\`\`plan\n${JSON.stringify({ nodes })}\n\`\`\`\n`;
}

const LINEAR = [
  { id: "n1", title: "First", dependsOn: [] },
  { id: "n2", title: "Second", dependsOn: ["n1"], agentKey: "engineer", estimateCents: 500 },
];

test("parsePlanGraph: valid block parses nodes", () => {
  const nodes = parsePlanGraph(block(LINEAR));
  assert.equal(nodes.length, 2);
  assert.deepEqual(nodes[1], { id: "n2", title: "Second", dependsOn: ["n1"], agentKey: "engineer", estimateCents: 500 });
});

test("parsePlanGraph: missing block throws", () => {
  assert.throws(() => parsePlanGraph("just prose, no fence"), /no ```plan fenced block/);
});

test("parsePlanGraph: bad json throws", () => {
  assert.throws(() => parsePlanGraph("```plan\n{not json}\n```"), /not valid JSON/);
});

test("parsePlanGraph: unknown dependsOn ref throws", () => {
  const text = block([{ id: "a", title: "A", dependsOn: ["ghost"] }]);
  assert.throws(() => parsePlanGraph(text), /unknown dependsOn reference "ghost"/);
});

test("parsePlanGraph: empty id/title and bad dependsOn throw", () => {
  assert.throws(() => parsePlanGraph(block([{ id: "", title: "A", dependsOn: [] }])), /"id" must be a non-empty string/);
  assert.throws(() => parsePlanGraph(block([{ id: "a", title: "", dependsOn: [] }])), /"title" must be/);
  assert.throws(() => parsePlanGraph(block([{ id: "a", title: "A", dependsOn: [1] }])), /"dependsOn" must be an array of strings/);
  assert.throws(() => parsePlanGraph('```plan\n{"nodes": "nope"}\n```'), /"nodes" array/);
});

test("topoOrder: linear order preserved", () => {
  const [a, b] = topoOrder(parsePlanGraph(block(LINEAR)));
  assert.equal(a.id, "n1");
  assert.equal(b.id, "n2");
});

test("topoOrder: diamond respects dependencies", () => {
  const nodes = [
    { id: "a", title: "A", dependsOn: [] },
    { id: "b", title: "B", dependsOn: ["a"] },
    { id: "c", title: "C", dependsOn: ["a"] },
    { id: "d", title: "D", dependsOn: ["b", "c"] },
  ];
  const order = topoOrder(nodes).map((n) => n.id);
  assert.deepEqual(order, ["a", "b", "c", "d"]);
});

test("topoOrder: cycle throws", () => {
  const nodes = [
    { id: "a", title: "A", dependsOn: ["b"] },
    { id: "b", title: "B", dependsOn: ["a"] },
  ];
  assert.throws(() => topoOrder(nodes), /cycle/);
});

test("topoOrder: unknown dep inside graph throws", () => {
  assert.throws(() => topoOrder([{ id: "a", title: "A", dependsOn: ["zz"] }]), /unknown node/);
});

test("PLAN_GRAPH_INSTRUCTION mentions the plan fence", () => {
  assert.match(PLAN_GRAPH_INSTRUCTION, /```plan/);
  assert.match(PLAN_GRAPH_INSTRUCTION, /dependsOn/);
});
