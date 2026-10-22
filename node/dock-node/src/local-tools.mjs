import { execFileSync } from "node:child_process"

// Optional local tools adapter. Off unless the daemon is started with --local-tools. Detects a cua-driver CLI on PATH.
// It reports what it found; it does not drive the desktop. Computer use is a later task (P4).

export const LOCAL_TOOL_NAME = "cua-driver"

export function defaultWhich(name) {
  try {
    const out = execFileSync("which", [name], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
    return out || null
  } catch {
    return null
  }
}

export function detectLocalTools({ enabled, which = defaultWhich }) {
  if (!enabled) return null
  const path = which(LOCAL_TOOL_NAME)
  if (path) return { available: true, tool: LOCAL_TOOL_NAME, path }
  return { available: false, tool: LOCAL_TOOL_NAME, message: "no local desktop tools" }
}
