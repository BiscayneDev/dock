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

test("chief: the flagged chief wins, then the first roster entry, and no name is assumed", async () => {
  const { pickChief } = await import("../lib/briefs.ts")
  const roster = [
    { key: "scout", displayName: "Scout", isChief: false },
    { key: "ops-lead", displayName: "Quinn", isChief: true },
  ]
  assert.equal(pickChief(roster).key, "ops-lead")
  assert.equal(pickChief([{ key: "scout", displayName: "Scout", isChief: false }]).key, "scout")
  assert.equal(pickChief([]), null)
})

// ── Monthly spend cap ──
import { monthStartIso, validateCapCents, checkMonthlyCap, MAX_MONTHLY_CAP_CENTS } from "../lib/briefs.ts"

test("cap window: resets at the start of the UTC month", () => {
  assert.equal(monthStartIso(new Date("2026-10-22T10:00:00Z")), "2026-10-01T00:00:00.000Z")
  assert.equal(monthStartIso(new Date("2026-10-31T23:59:59Z")), "2026-10-01T00:00:00.000Z")
  assert.equal(monthStartIso(new Date("2026-11-01T00:00:00Z")), "2026-11-01T00:00:00.000Z")
})

test("cap validation: null clears; whole cents from 0 to the ceiling only", () => {
  assert.equal(validateCapCents(null), null)
  assert.equal(validateCapCents(0), 0)
  assert.equal(validateCapCents(MAX_MONTHLY_CAP_CENTS), MAX_MONTHLY_CAP_CENTS)
  assert.equal(typeof validateCapCents(-1), "string")
  assert.equal(typeof validateCapCents(1.5), "string")
  assert.equal(typeof validateCapCents("500"), "string")
  assert.equal(typeof validateCapCents(MAX_MONTHLY_CAP_CENTS + 1), "string")
})

test("cap check: no cap always passes; spent plus reserved must fit under the cap", () => {
  assert.equal(checkMonthlyCap({ capCents: null, spentCents: 999999, reservedCents: 999999 }).ok, true)
  assert.equal(checkMonthlyCap({ capCents: 1000, spentCents: 400, reservedCents: 600 }).ok, true, "exactly at the cap passes")
  const over = checkMonthlyCap({ capCents: 1000, spentCents: 400, reservedCents: 601 })
  assert.equal(over.ok, false)
  assert.equal(over.remainingCents, -1)
})
