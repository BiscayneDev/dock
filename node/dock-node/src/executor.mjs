import { ApiError } from "./api.mjs"
import { isMoneyAction } from "./money.mjs"

// Executes one claimed home run. Money actions are never executed here: the run is reported to the approval
// gate (complete with awaiting_approval) and the model is not called. Everything else is one model call through
// Dock (POST /api/devices/infer), which applies the owner's budget and meters the spend.

export async function executeRun(run, { api, localTools = null, log = () => {} }) {
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

  await api.event(run.id, "started", { agentKey: run.agentKey })

  if (localTools) {
    const kind = localTools.available ? `local tools available: ${localTools.tool}` : localTools.message
    await api.event(run.id, "local_tools", { available: localTools.available, tool: localTools.tool, message: kind })
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
