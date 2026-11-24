export type RunMode = "plan" | "build" | "explore";

export interface ToolPermission {
  tool: string;
  allowed: boolean;
  ask: boolean;
}

type Rule = [boolean, boolean]; // [allowed, ask]

const PERMISSIONS: Record<RunMode, Record<string, Rule>> = {
  plan: {
    read: [true, false],
    grep: [true, false],
    glob: [true, false],
    webfetch: [true, false],
    memory: [true, false],
    write: [false, false],
    edit: [false, false],
    bash: [false, true],
    diagnostics: [false, false],
    flag_knowledge: [false, false],
  },
  build: {
    read: [true, false],
    write: [true, false],
    edit: [true, false],
    bash: [true, false],
    grep: [true, false],
    glob: [true, false],
    webfetch: [true, false],
    diagnostics: [true, false],
    memory: [true, false],
    // flag_knowledge records an observation about the knowledge base (a write), so it belongs to
    // the executing mode only. Plan mode forbids mutations and explore mode is read-only research;
    // both deny it rather than asking, because a flag is never a deliverable decision.
    flag_knowledge: [true, false],
  },
  explore: {
    read: [true, false],
    grep: [true, false],
    glob: [true, false],
    write: [false, false],
    edit: [false, false],
    bash: [false, true],
    webfetch: [false, false],
    diagnostics: [false, false],
    memory: [false, false],
    flag_knowledge: [false, false],
  },
};

export function permissionsFor(mode: RunMode): ToolPermission[] {
  return Object.entries(PERMISSIONS[mode]).map(([tool, [allowed, ask]]) => ({
    tool,
    allowed,
    ask,
  }));
}

// ── Deny-by-default policy (WS5) ────────────────────────────────────────────────
//
// `evaluateToolPolicy` is the ordered decision used before a tool call runs:
// deny -> ask -> allow. Order matters and is strict:
//   1. A tool unknown to this mode is always denied (fail closed), even if an
//      allow rule names it.
//   2. Any deny rule wins. Default denies are a floor: workspace/managed deny
//      rules EXTEND them, and an allow rule can never lift a denied tool.
//   3. Ask wins over allow.
//   4. Allow wins over the mode's default.
//   5. Otherwise the mode matrix decides; anything not explicitly allowed or
//      asked there is denied.
//
// Managed/workspace rules (passed as `deny`/`ask`/`allow`) extend the agent
// defaults above; they cannot weaken them. `bash` is the one tool whose default
// is "ask" rather than allow/deny, so a workspace `allow: ["bash"]` can promote
// it to allow while `deny: ["bash"]` still shuts it down.

export type ToolPolicyDecision = "allow" | "ask" | "deny";

export interface ToolPolicyInput {
  mode: RunMode;
  tool: string;
  /** Managed/workspace deny rules. Unioned with DEFAULT_TOOL_DENY for the mode. */
  deny?: readonly string[];
  /** Managed/workspace ask rules. Lose to any deny, win over allow. */
  ask?: readonly string[];
  /** Managed/workspace allow rules. Cannot lift a default or explicit deny. */
  allow?: readonly string[];
}

/**
 * Tools denied by default in each mode. Mirrors the `[false, false]` entries of
 * PERMISSIONS; kept explicit (not derived) so the security floor is auditable
 * in one place. Build mode has no default denies: it is the executing mode.
 */
export const DEFAULT_TOOL_DENY: Record<RunMode, readonly string[]> = {
  plan: ["write", "edit", "diagnostics", "flag_knowledge"],
  build: [],
  explore: ["write", "edit", "webfetch", "diagnostics", "memory", "flag_knowledge"],
};

function knownTool(mode: RunMode, tool: string): boolean {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS[mode] ?? {}, tool);
}

/** Strict ordered evaluation: deny -> ask -> allow, unknown tools denied. */
export function evaluateToolPolicy(input: ToolPolicyInput): ToolPolicyDecision {
  const { mode, tool } = input;
  // Fail closed on malformed input: unknown mode or non-string/empty tool.
  if (typeof tool !== "string" || tool.length === 0) return "deny";
  if (!Object.prototype.hasOwnProperty.call(PERMISSIONS, mode)) return "deny";
  if (!knownTool(mode, tool)) return "deny";

  const denied = new Set<string>([...DEFAULT_TOOL_DENY[mode], ...(input.deny ?? [])]);
  if (denied.has(tool)) return "deny";

  const asked = new Set<string>(input.ask ?? []);
  if (asked.has(tool)) return "ask";

  const allowed = new Set<string>(input.allow ?? []);
  if (allowed.has(tool)) return "allow";

  const [, ask] = PERMISSIONS[mode][tool];
  if (ask) return "ask";
  // Only [true, false] entries remain; everything else stays denied.
  return PERMISSIONS[mode][tool][0] ? "allow" : "deny";
}

const COLUMN_MODES: Record<string, RunMode> = {
  Backlog: "plan",
  Planned: "plan",
  "Plan Review": "plan",
  "In Progress": "build",
  Review: "build",
  Testing: "build",
};

export function modeForColumn(column: string): RunMode {
  return COLUMN_MODES[column] ?? "plan";
}

/** System-prompt suffix that gates plan mode: no file writes, no command execution. */
export const PLAN_MODE_INSTRUCTION =
  "PLAN MODE: you may not modify files or execute commands; produce a plan only";

/** System-prompt suffix that gates explore mode: read-only research, no mutations. */
export const EXPLORE_MODE_INSTRUCTION =
  "READ-ONLY RESEARCH MODE: you may not modify files or execute commands. Gather and report findings only.";
