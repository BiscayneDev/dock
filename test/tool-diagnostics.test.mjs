import test from "node:test"
import assert from "node:assert/strict"

// Import the TS lib directly — node --test runs these as .mjs, so we eval the
// compiled-equivalent logic by transpiling on the fly is overkill; instead use
// tsx-free approach: the lib is type-annotation-only TS, strip types via a
// tiny regex-free loader is fragile. Simplest: duplicate-free dynamic import
// via node's experimental strip-types if available, else fallback.
// Node 25 strips TS types natively, so the .ts lib imports directly.
const mod = await import("../lib/tool-diagnostics.ts")

const { parseTscOutput, parseEslintOutput, formatDiags } = mod

test("parseTscOutput parses typical lines", () => {
  const text = [
    "lib/foo.ts(12,5): error TS2345: Argument of type 'x' is not assignable.",
    "app/page.tsx(3): error TS2307: Cannot find module 'y'.",
    "lib/warn.ts(7,2): warning TS6133: 'a' is declared but never used.",
  ].join("\n")
  const diags = parseTscOutput(text)
  assert.equal(diags.length, 3)
  assert.deepEqual(diags[0], {
    file: "lib/foo.ts",
    line: 12,
    column: 5,
    message: "Argument of type 'x' is not assignable.",
    severity: "error",
  })
  assert.equal(diags[1].column, undefined)
  assert.equal(diags[1].file, "app/page.tsx")
  assert.equal(diags[2].severity, "warning")
})

test("parseTscOutput: no errors -> empty, malformed ignored", () => {
  assert.deepEqual(parseTscOutput(""), [])
  const text = [
    "All checks passed.",
    "this is not a diag",
    "error without location",
    "path.ts(): error TS9999: broken",
  ].join("\n")
  assert.deepEqual(parseTscOutput(text), [])
})

const eslintJson = JSON.stringify([
  {
    filePath: "/proj/app/page.tsx",
    messages: [
      { line: 4, column: 10, message: "Unexpected var.", ruleId: "no-var", severity: 2 },
      { line: 9, message: "Prefer const.", ruleId: "prefer-const", severity: 1 },
    ],
  },
  { filePath: "/proj/lib/ok.ts", messages: [] },
])

test("parseEslintOutput parses typical JSON", () => {
  const diags = parseEslintOutput(eslintJson)
  assert.equal(diags.length, 2)
  assert.equal(diags[0].file, "/proj/app/page.tsx")
  assert.equal(diags[0].line, 4)
  assert.equal(diags[0].column, 10)
  assert.equal(diags[0].severity, "error")
  assert.match(diags[0].message, /^no-var: /)
  assert.equal(diags[1].severity, "warning")
  assert.equal(diags[1].column, undefined)
})

test("parseEslintOutput: empty results / bad JSON", () => {
  assert.deepEqual(parseEslintOutput("[]"), [])
  assert.deepEqual(parseEslintOutput("not json"), [])
  assert.deepEqual(parseEslintOutput(JSON.stringify({ x: 1 })), [])
})

test("formatDiags caps and notes overflow", () => {
  const diags = Array.from({ length: 55 }, (_, i) => ({
    file: `f${i}.ts`,
    line: i + 1,
    column: 1,
    message: `msg ${i}`,
    severity: "error",
  }))
  const out = formatDiags(diags, 40)
  const lines = out.split("\n")
  assert.equal(lines.length, 41)
  assert.match(lines[40], /^\.\.\. and 15 more$/)
  assert.match(lines[0], /^ERROR f0\.ts:1:1 msg 0$/)
})
