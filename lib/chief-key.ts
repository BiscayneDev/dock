/**
 * Chief of staff identity on the file-backed and fallback paths. This file is the only place the chief's runtime
 * key appears in code. Workspaces resolve the real chief from the agents table (lib/briefs.ts pickChief), and the
 * display name comes from the agent's stored display_name. Nothing else in the codebase names the chief.
 */
export const CHIEF_RUNTIME_KEY = "vic"
export const CHIEF_ROLE_LABEL = "Chief of staff"
export const DEFAULT_CHIEF_NAME = "Chief"
