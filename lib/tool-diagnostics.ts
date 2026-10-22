// Diagnostics tool library: parse tsc / eslint output into compact Diag lists.
// Pure and import-free so it runs under node --test and can be mirrored in
// node/dock-node/src/local-tools.mjs (keep the tsc regex in sync there).

export type DiagSeverity = "error" | "warning"

export type Diag = {
  file: string
  line: number
  column?: number
  message: string
  severity: DiagSeverity
}

// Matches: path/file.ts(12,5): error TS2345: msg   (column optional-ish but tsc always emits it)
// group 5 = error code (TSxxxx), group 6 = message
const TSC_LINE = /^([^(()\n]+)\((\d+)(?:,(\d+))?\):\s+(error|warning)\s+((?:TS\d+):\s+)?(.*)$/

export function parseTscOutput(text: string): Diag[] {
  const diags: Diag[] = []
  for (const raw of text.split(/\r?\n/)) {
    const m = TSC_LINE.exec(raw.trim())
    if (!m) continue
    const severity = m[4] === "warning" ? "warning" : "error"
    const col = m[3] ? Number.parseInt(m[3], 10) : undefined
    diags.push({
      file: m[1].trim(),
      line: Number.parseInt(m[2], 10),
      ...(col !== undefined ? { column: col } : {}),
      message: m[6].trim(),
      severity,
    })
  }
  return diags
}

type EslintMessage = {
  line?: number
  column?: number
  message?: string
  severity?: number
  ruleId?: string | null
}

type EslintResult = {
  filePath?: string
  messages?: EslintMessage[]
}

export function parseEslintOutput(text: string): Diag[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const diags: Diag[] = []
  for (const result of parsed as EslintResult[]) {
    const file = result?.filePath ?? "unknown"
    for (const msg of result?.messages ?? []) {
      diags.push({
        file,
        line: typeof msg.line === "number" ? msg.line : 1,
        ...(typeof msg.column === "number" ? { column: msg.column } : {}),
        message: [msg.ruleId ? `${msg.ruleId}: ` : "", msg.message ?? ""].join("").trim(),
        severity: msg.severity === 1 ? "warning" : "error",
      })
    }
  }
  return diags
}

// Compact capped block so an agent prompt stays small.
export function formatDiags(diags: Diag[], max = 40): string {
  const shown = diags.slice(0, max)
  const lines = shown.map((d) => {
    const col = d.column !== undefined ? `:${d.column}` : ""
    return `${d.severity.toUpperCase()} ${d.file}:${d.line}${col} ${d.message}`
  })
  if (diags.length > max) {
    lines.push(`... and ${diags.length - max} more`)
  }
  return lines.join("\n")
}
