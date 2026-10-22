// Project briefs and ledger rules (central thread v1).
// Run: node --test test/briefs.test.mjs   (Node 23.6+ strips TypeScript types natively)
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  stripBriefBlocks,
  parseBriefBlocks,
  parseMention,
  validateBrief,
  canApprove,
  canCancel,
  outcomeForRun,
  composeRunPrompt,
  detectRiskFlags,
} from "../lib/briefs.ts"

const MAX = 2000
const fence = (json) => "```brief\n" + json + "\n```"

test("parse: a valid brief block becomes a proposal and is removed from the visible text", () => {
  const text = `On it, I'll draft the page.\n\n${fence(
    JSON.stringify({ goal: "Draft landing page", deliverables: ["index.html"], budget_cents: 150 }),
  )}`
  const parsed = parseBriefBlocks(text, MAX)
  assert.equal(parsed.proposals.length, 1)
  assert.equal(parsed.proposals[0].goal, "Draft landing page")
  assert.equal(parsed.proposals[0].budgetCents, 150)
  assert.equal(parsed.text, "On it, I'll draft the page.")
  assert.deepEqual(parsed.rejected, [])
})

test("parse: budget is clamped to the server cap, never raised", () => {
  const p = validateBrief({ goal: "x", deliverables: ["y"], budget_cents: 999999 }, 500)
  assert.equal(p.budgetCents, 500)
})

test("parse: missing budget gets the default", () => {
  const p = validateBrief({ goal: "x", deliverables: ["y"] }, MAX)
  assert.equal(p.budgetCents, 100)
})

test("parse: invalid JSON, no goal, no deliverables and bad budget are rejected with a reason", () => {
  const text = [
    fence("{not json"),
    fence(JSON.stringify({ deliverables: ["y"] })),
    fence(JSON.stringify({ goal: "x", deliverables: [] })),
    fence(JSON.stringify({ goal: "x", deliverables: ["y"], budget_cents: -5 })),
  ].join("\n")
  const parsed = parseBriefBlocks(text, MAX)
  assert.equal(parsed.proposals.length, 0)
  assert.equal(parsed.rejected.length, 4)
})

test("parse: unknown risk flags are ignored, detected risks are added", () => {
  const p = validateBrief(
    { goal: "Email the list about the launch", deliverables: ["draft"], risk_flags: ["bogus", "deletes_data"] },
    MAX,
  )
  assert.ok(p.riskFlags.includes("deletes_data"))
  assert.ok(p.riskFlags.includes("contacts_people"))
  assert.ok(p.riskFlags.includes("publishes_externally"))
  assert.ok(!p.riskFlags.includes("bogus"))
})

test("strip: an unfinished brief block while streaming is hidden", () => {
  assert.equal(stripBriefBlocks("Sure.\n```brief\n{\"goal\": \"wr"), "Sure.")
})

test("strip: plain text with no block is unchanged", () => {
  assert.equal(stripBriefBlocks("What's the price?"), "What's the price?")
})

test("mention: a leading @agent routes to that agent and strips the token", () => {
  const roster = [
    { key: "scout", displayName: "Scout" },
    { key: "vic", displayName: "Vic" },
    { key: "deal-flow", displayName: "Deal Flow" },
  ]
  assert.deepEqual(parseMention("@scout find three competitors", roster), {
    agentKey: "scout",
    text: "find three competitors",
  })
  assert.deepEqual(parseMention("@DealFlow, price this", roster), { agentKey: "deal-flow", text: "price this" })
})

test("mention: unknown or mid-sentence mentions do not route", () => {
  const roster = [{ key: "scout", displayName: "Scout" }]
  assert.deepEqual(parseMention("@nobody do it", roster), { agentKey: null, text: "@nobody do it" })
  assert.deepEqual(parseMention("ask @scout", roster), { agentKey: null, text: "ask @scout" })
})

test("state: only proposed briefs can be approved or cancelled", () => {
  assert.equal(canApprove("proposed"), true)
  assert.equal(canCancel("proposed"), true)
  for (const s of ["approved", "running", "succeeded", "failed", "cancelled"]) {
    assert.equal(canApprove(s), false, `${s} must not approve`)
    assert.equal(canCancel(s), false, `${s} must not cancel`)
  }
})

test("outcome: succeeded maps to succeeded + run_succeeded; failed and cancelled map to failed + run_failed", () => {
  assert.deepEqual(outcomeForRun("succeeded"), { briefState: "succeeded", ledgerKind: "run_succeeded" })
  assert.deepEqual(outcomeForRun("failed"), { briefState: "failed", ledgerKind: "run_failed" })
  assert.deepEqual(outcomeForRun("cancelled"), { briefState: "failed", ledgerKind: "run_failed" })
})

test("run prompt: carries goal, deliverables, budget and the approved risks", () => {
  const prompt = composeRunPrompt({
    goal: "Ship pricing page",
    context: "Usage-based pricing.",
    deliverables: ["page.tsx", "copy.md"],
    budgetCents: 250,
    riskFlags: ["spends_money"],
  })
  assert.match(prompt, /Goal: Ship pricing page/)
  assert.match(prompt, /1\. page\.tsx/)
  assert.match(prompt, /2\.50 USD/)
  assert.match(prompt, /spends money/)
})

test("risk detection: plain analysis has no flags", () => {
  assert.deepEqual(detectRiskFlags("Compare three pricing models and summarise"), [])
})
