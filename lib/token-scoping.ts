/**
 * Import-free decision for DOCK_AGENT_TOKEN machine-client requests.
 *
 * Agent tokens are a per-instance superuser credential intended for
 * single-tenant (single-workspace) deployments. When a deployment has more
 * than one workspace, token requests must fail closed instead of silently
 * binding to (or reading across) the first workspace.
 */

export type TokenScopeDecision = "bind" | "reject";

export function tokenScoping(workspaceCount: number): TokenScopeDecision {
  if (!Number.isFinite(workspaceCount)) return "reject"; // unknown count fails closed
  return workspaceCount > 1 ? "reject" : "bind";
}
