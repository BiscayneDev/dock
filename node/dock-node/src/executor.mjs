import { ApiError } from "./api.mjs"
import { runIsolatedAgentTask } from "./isolated-agent.mjs"
import { runDiagnosticsTool, shouldRunDiagnostics } from "./local-tools.mjs"
import { isMoneyAction } from "./money.mjs"

// Executes one claimed home run. Money actions are never executed here: the run is reported to the approval
// gate (complete with awaiting_approval) and the model is not called. Everything else is one model call through
// Dock (POST /api/devices/infer), which applies the owner's budget and meters the spend.

export async function executeRun(run, { api, localTools = null, diagnostics = false, log = () => {}, runDiagnostics, isolatedRunner = runIsolatedAgentTask }) {
  const action = run.proposedAction ?? null

  if (isMoneyAction(action)) {
    log(`run ${run.id}: refusing money action ${action.type} on the home node; sending to approval`)
    await api.event(run.id, "action_refused", { actionId: action.id, type: action.type }).catch(() => null)
    try {
      await api.complete(run.id, { status: "awaiting_approval" })
      return { outcome: "awaiting_approval" }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) throw err
      // The owner already decided on this action. It runs only on the cloud executor, so fail it here.
      await api
        .complete(run.id, { status: "failed", error: "approved money action cannot run on the home node" })
        .catch(() => null)
      return { outcome: "refused" }
    }
  }

  // Isolated coding task: run confined on this home host (fresh container, no
  // network, host-held inference key, host-finalized branch). The cloud emits
  // run.isolatedTask = { taskRef, worktreePath, brief } for these. Any failure
  // - including "no container runtime here" - fails the run closed; it never
  // falls back to unconfined execution.
  if (run.isolatedTask) {
    await api.event(run.id, "started", { agentKey: run.agentKey, isolated: true })
    try {
      if (process.env.DOCK_ISOLATED_RUNTIME !== "on") throw new Error("experimental isolated runtime disabled; refusing launch")
      const result = await isolatedRunner({
        repoKey: run.isolatedTask.repoKey,
        baseRef: run.isolatedTask.baseRef,
        taskRef: run.isolatedTask.taskRef,
        infer: (body) => api.inferCoding(run.id, body),
        brief: run.isolatedTask.brief,
        log,
      })
      await api.complete(run.id, {
        status: result.outcome === "review_required" ? "succeeded" : "failed",
        ...(result.outcome === "review_required" ? { output: `Review required (not merged or deployed): ${result.summary}` } : { error: String(result.summary ?? "isolated task failed").slice(0, 500) }),
      })
      return { outcome: result.outcome, artifactPath: result.artifactPath ?? null }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) throw err
      const message = err instanceof Error ? err.message : "isolated task failed"
      await api.complete(run.id, { status: "failed", error: message.slice(0, 500) }).catch(() => null)
      return { outcome: "failed", error: message }
    }
  }

  await api.event(run.id, "started", { agentKey: run.agentKey })

  if (localTools) {
    const kind = localTools.available ? `local tools available: ${localTools.tool}` : localTools.message
    await api.event(run.id, "local_tools", { available: localTools.available, tool: localTools.tool, message: kind })
  }

  // Optional pre-infer compile diagnostics: only when the daemon opted in and the run asked for them.
  if (shouldRunDiagnostics({ enabled: diagnostics || localTools != null, wantDiagnostics: run.wantDiagnostics === true })) {
    try {
      const report = await (runDiagnostics ?? runDiagnosticsTool)()
      await api.event(run.id, "diagnostics", { total: report.total, report: report.report })
    } catch (err) {
      // Diagnostics are best-effort: a broken tsc must not fail the run.
      log(`run ${run.id}: diagnostics failed: ${err instanceof Error ? err.message : "unknown error"}`)
    }
  }

  try {
    const result = await api.infer(run.id)
    const output = typeof result.text === "string" ? result.text : ""
    await api.complete(run.id, { status: "succeeded", output })
    return { outcome: "succeeded", costCents: result.costCents ?? null }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw err
    const message = err instanceof Error ? err.message : "run failed"
    await api.complete(run.id, { status: "failed", error: message.slice(0, 500) }).catch(() => null)
    return { outcome: "failed", error: message }
  }
}
