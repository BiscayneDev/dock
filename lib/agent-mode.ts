/**
 * Import-free run-mode resolution (no @/ imports so it is directly
 * node-testable and usable from any runtime context).
 */

export type RunMode = "plan" | "build" | "explore";

// DRIFT WARNING: lib/tool-permissions.ts also exports a modeForColumn. This file's
// resolveRunMode (and modeForColumn) is canonical; update both together if modes change.

const RUN_MODES: readonly RunMode[] = ["plan", "build", "explore"];

const COLUMN_MODES: Record<string, RunMode> = {
  Backlog: "plan",
  Planned: "plan",
  "Plan Review": "plan",
  "In Progress": "build",
  Review: "build",
  Testing: "build",
};

function modeForColumn(column: string): RunMode {
  return COLUMN_MODES[column] ?? "plan";
}

/**
 * Resolve the RunMode for a run.
 *
 * Precedence:
 * 1. An explicitly valid `payload.mode` wins.
 * 2. An agent flagged `explore: true` forces the read-only explore mode,
 *    overriding whatever the task's column would normally imply.
 * 3. Otherwise fall back to the column mapping.
 */
export function resolveRunMode(
  payload: { mode?: unknown; explore?: boolean },
  column?: string,
): RunMode {
  if (typeof payload.mode === "string" && (RUN_MODES as readonly string[]).includes(payload.mode)) {
    return payload.mode as RunMode;
  }
  if (payload.explore === true) return "explore";
  return modeForColumn(column ?? "");
}
