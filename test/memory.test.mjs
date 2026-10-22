// Shipyard Memory for Dock: owner and project isolation, owner-only delete, prompt block, keyword fallback.
// Run: node --test test/memory.test.mjs   (Node 23.6+ strips TypeScript types natively)
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  remember,
  recall,
  forget,
  memoryPromptBlock,
  extractFacts,
  tokens,
} from "../lib/memory-core.ts"

let seq = 0
function memoryRepo() {
  const rows = []
  return {
    rows,
    async insert(row) {
      seq += 1
      const stored = {
        id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
        ownerId: row.ownerId,
        workspaceId: row.workspaceId,
        projectId: row.projectId,
        projectName: row.projectId ? `project-${row.projectId.slice(0, 4)}` : null,
        scope: row.scope,
        type: row.type,
        content: row.content,
        conversationId: row.conversationId,
        embeddingModel: row.embeddingModel,
        createdAt: new Date(Date.UTC(2026, 9, 22, 12, 0, seq)).toISOString(),
        embedding: row.embedding,
      }
      rows.push(stored)
      return stored
    },
    async listRecent(ownerId, limit) {
      return rows
        .filter((r) => r.ownerId === ownerId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, limit)
    },
    async delete(ownerId, id) {
      const i = rows.findIndex((r) => r.id === id && r.ownerId === ownerId)
      if (i < 0) return false
      rows.splice(i, 1)
      return true
    },
  }
}

const noEmbed = async () => null
function deps(repo, extra = {}) {
  return { repo, embed: noEmbed, embeddingModel: "test-model", ...extra }
}

const A = "owner-a"
const B = "owner-b"
const WS_A = "ws-a"
const WS_B = "ws-b"
const P1 = "11111111-1111-4111-8111-111111111111"
const P2 = "22222222-2222-4222-8222-222222222222"

test("remember then recall returns only the owner's items", async () => {
  const repo = memoryRepo()
  const d = deps(repo)
  await remember(d, { scope: "fact", ownerId: A, workspaceId: WS_A, projectId: null, content: "Prefers morning meetings" })
  await remember(d, { scope: "fact", ownerId: B, workspaceId: WS_B, projectId: null, content: "Prefers morning calls too" })

  const hitsA = await recall(d, { ownerId: A, query: "morning", projectId: null })
  assert.equal(hitsA.length, 1)
  assert.equal(hitsA[0].content, "Prefers morning meetings")
  assert.equal(hitsA[0].scope, "fact")

  const hitsB = await recall(d, { ownerId: B, query: "morning", projectId: null })
  assert.deepEqual(hitsB.map((h) => h.content), ["Prefers morning calls too"])
})

test("project knowledge never leaks into another project or to no-project chats", async () => {
  const repo = memoryRepo()
  const d = deps(repo)
  await remember(d, { scope: "project", ownerId: A, workspaceId: WS_A, projectId: P1, content: "Launch date is March 3" })
  await remember(d, { scope: "project", ownerId: A, workspaceId: WS_A, projectId: P2, content: "Launch budget is 5k" })
  await remember(d, { scope: "fact", ownerId: A, workspaceId: WS_A, projectId: null, content: "Launch reviews happen Fridays" })

  const inP1 = await recall(d, { ownerId: A, query: "launch", projectId: P1 })
  assert.deepEqual(inP1.map((h) => h.content).sort(), ["Launch date is March 3", "Launch reviews happen Fridays"].sort())
  assert.ok(!inP1.some((h) => h.content.includes("budget")))

  const noProject = await recall(d, { ownerId: A, query: "launch", projectId: null })
  assert.deepEqual(noProject.map((h) => h.content), ["Launch reviews happen Fridays"])
})

test("project scope requires a project id", async () => {
  const d = deps(memoryRepo())
  await assert.rejects(remember(d, { scope: "project", ownerId: A, workspaceId: WS_A, projectId: null, content: "x" }), /requires a projectId/)
})

test("delete is owner-only", async () => {
  const repo = memoryRepo()
  const d = deps(repo)
  const row = await remember(d, { scope: "fact", ownerId: A, workspaceId: WS_A, projectId: null, content: "Lives in Miami" })
  assert.equal(await forget(d, B, row.id), false, "another owner cannot delete")
  assert.equal(repo.rows.length, 1)
  assert.equal(await forget(d, A, row.id), true, "owner can delete")
  assert.equal(repo.rows.length, 0)
  assert.equal(await forget(d, A, row.id), false, "second delete is a no-op")
})

test("prompt block is skipped when empty and included when present", () => {
  assert.equal(memoryPromptBlock([], null), null)
  const conversationOnly = [{ id: "x", scope: "conversation", type: "conversation", content: "User: hi", projectId: null, projectName: null, score: 1, via: "recent" }]
  assert.equal(memoryPromptBlock(conversationOnly, null), null, "conversation turns are not put in the prompt")

  const hits = [
    { id: "a", scope: "fact", type: "fact", content: "Works Mon-Thu", projectId: null, projectName: null, score: 1, via: "keyword" },
    { id: "b", scope: "project", type: "fact", content: "Pilot starts Nov 1", projectId: P1, projectName: "Pilot", score: 1, via: "keyword" },
    { id: "c", scope: "project", type: "fact", content: "Other project detail", projectId: P2, projectName: "Other", score: 1, via: "keyword" },
  ]
  const block = memoryPromptBlock(hits, P1)
  assert.match(block, /^What you remember/)
  assert.match(block, /- Works Mon-Thu/)
  assert.match(block, /- \(project\) Pilot starts Nov 1/)
  assert.ok(!block.includes("Other project detail"), "project P2 detail is not in P1's prompt")
})

test("keyword fallback works with no embedding provider", async () => {
  const repo = memoryRepo()
  const d = deps(repo, { embed: async () => null })
  const row = await remember(d, { scope: "fact", ownerId: A, workspaceId: WS_A, projectId: null, content: "Allergic to peanuts" })
  assert.equal(row.embeddingModel, null, "stored without a vector")
  assert.equal(repo.rows[0].embedding, null)
  const hits = await recall(d, { ownerId: A, query: "what about peanuts?", projectId: null })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].via, "keyword")
  assert.deepEqual(await recall(d, { ownerId: A, query: "tulips", projectId: null }), [])
  // Empty query returns the newest items (used for the prompt fallback).
  const recent = await recall(d, { ownerId: A, query: "", projectId: null })
  assert.equal(recent[0].via, "recent")
})

test("vector recall is used when an embedding exists and tags the model", async () => {
  const repo = memoryRepo()
  const d = deps(repo, { embed: async () => [0.1, 0.2] })
  const row = await remember(d, { scope: "fact", ownerId: A, workspaceId: WS_A, projectId: null, content: "Vegetarian" })
  assert.equal(row.embeddingModel, "test-model")
  const hits = await recall(
    { ...d, repo: { ...repo, vectorMatch: async () => [{ row, similarity: 0.9 }] } },
    { ownerId: A, query: "food preferences", projectId: null },
  )
  assert.equal(hits[0].via, "vector")
})

test("extraction stores valid facts, drops invalid ones, and downgrades project scope without a project", async () => {
  const repo = memoryRepo()
  const reply = JSON.stringify({
    facts: [
      { content: "Has a dog named Rex", type: "fact", scope: "fact" },
      { content: "Has a dog named Rex", type: "fact", scope: "fact" },
      { content: "Wants weekly reviews", type: "preference", scope: "project" },
      { content: "bad type", type: "rumour", scope: "fact" },
      { content: "   ", type: "fact", scope: "fact" },
    ],
  })
  const d = deps(repo, { complete: async () => `here you go ${reply}` })
  const stored = await extractFacts(d, {
    ownerId: A, workspaceId: WS_A, projectId: null, conversationId: null,
    userText: "I have a dog named Rex and want weekly reviews", assistantText: "Noted.",
  })
  assert.equal(stored, 2)
  assert.deepEqual(repo.rows.map((r) => [r.scope, r.content]).sort(), [["fact", "Has a dog named Rex"], ["fact", "Wants weekly reviews"]].sort())
})

test("extraction never throws and reports failures", async () => {
  const errors = []
  const d = deps(memoryRepo(), { complete: async () => { throw new Error("model down") }, onError: (m) => errors.push(m) })
  const stored = await extractFacts(d, { ownerId: A, workspaceId: WS_A, projectId: null, conversationId: null, userText: "a", assistantText: "b" })
  assert.equal(stored, 0)
  assert.deepEqual(errors, ["fact extraction failed"])
})

test("tokens drop stopwords and short words", () => {
  assert.deepEqual(tokens("What about the Peanuts, ok?").sort(), ["peanuts"])
})
