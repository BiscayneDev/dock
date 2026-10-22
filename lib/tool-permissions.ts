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
  },
};

export function permissionsFor(mode: RunMode): ToolPermission[] {
  return Object.entries(PERMISSIONS[mode]).map(([tool, [allowed, ask]]) => ({
    tool,
    allowed,
    ask,
  }));
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
