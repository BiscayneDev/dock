// Container confinement: runtime detection, mount restriction, argv shape.
// Run: node --test node/dock-node/test/isolation.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { detectContainerRuntime, isTaskWorktreePath, containerRunArgs, confinedCommand } from "../src/isolation.mjs"

const WT = "/home/demo/projects/.dock-worktrees/dock/task-1"

test("detects the first available runtime", () => {
  assert.equal(detectContainerRuntime(() => false), null)
  assert.equal(detectContainerRuntime((n) => n === "podman"), "podman")
  assert.equal(detectContainerRuntime((n) => n === "container"), "container")
  assert.equal(detectContainerRuntime(() => true), "docker")
})

test("only Dock task worktrees may be mounted", () => {
  assert.equal(isTaskWorktreePath(WT), true)
  assert.equal(isTaskWorktreePath("/home/demo/projects/dock"), false)
  assert.equal(isTaskWorktreePath("/home/demo/.dock-worktrees/dock/task-1/deeper"), false)
  assert.equal(isTaskWorktreePath("relative/.dock-worktrees/dock/task-1"), false)
  assert.equal(isTaskWorktreePath("/etc"), false)
})

test("argv confines: only the worktree, no network, no privileges", () => {
  const argv = containerRunArgs({ runtime: "docker", worktreePath: WT, command: ["npm", "test"], envFlags: ["-e", "CI=1"] })
  const joined = argv.join(" ")
  assert.ok(joined.includes(`-v ${WT}:/work`), joined)
  assert.ok(joined.includes("--network none"), joined)
  assert.ok(joined.includes("--read-only"), joined)
  assert.ok(joined.includes("--cap-drop ALL"), joined)
  assert.ok(joined.includes("--user"), joined)
  assert.ok(!joined.includes("/home/demo/projects/dock:"), "main checkout is not mounted")
})

test("refuses non-worktree mounts and empty commands", () => {
  assert.throws(() => containerRunArgs({ runtime: "docker", worktreePath: "/etc", command: ["ls"] }), /non-task-worktree/)
  assert.throws(() => containerRunArgs({ runtime: "docker", worktreePath: WT, command: [] }), /non-empty/)
  assert.throws(() => containerRunArgs({ runtime: "docker", worktreePath: WT, command: ["a", ""] }), /non-empty/)
})

test("confinedCommand returns null without a runtime - never falls back to host", () => {
  assert.equal(confinedCommand({ worktreePath: WT, command: ["ls"], whichFn: () => false }), null)
  const ok = confinedCommand({ worktreePath: WT, command: ["ls"], whichFn: () => true })
  assert.equal(ok.runtime, "docker")
  assert.ok(ok.argv.length > 0)
})
