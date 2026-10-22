/**
 * Runtime key of the chief of staff on the file-backed and fallback paths. The one place the literal lives.
 * Workspaces resolve the real chief from the agents table (see lib/briefs.ts pickChief); only signed-out and
 * legacy file paths use this constant.
 */
export const CHIEF_RUNTIME_KEY = "vic"
