// Server-side receipt issuer. Signs only from the owner-scoped turn ledger (store.turnStatus throws
// unless the session belongs to this device/owner/workspace). Never signs a pending or failed turn,
// and the digest comes from the stored reply, not from any caller. Undeployed: no route is enabled
// without MOBILE_RECEIPT_SIGNING_KEY, which is not provisioned anywhere.
import { signReceipt, replyDigest } from './receipt.mjs';
export async function issueTurnReceipt({ principal, sessionId, requestId, store, privateKey, now = () => Date.now() }) {
    if (!privateKey) throw Error('Receipt signing not configured');
    const turn = await store.turnStatus(sessionId, requestId);
    if (!turn) return { status: 'unknown' };
    if (turn.status !== 'complete') return { status: turn.status };
    const text = turn.reply?.text;
    if (typeof text !== 'string') throw Error('Completed turn has no reply');
    return signReceipt(privateKey, { ownerId: principal.ownerId, workspaceId: principal.workspaceId, sessionId, requestId, status: 'complete', replyDigest: replyDigest(text), issuedAt: new Date(now()).toISOString() });
}
// Async durable ledger over the DRAFT 0023 rpc functions. Interface is db.rpc only.
export function taskLedger({ db, principal }) {
    const call = async (fn, a) => { const { data, error } = await db.rpc(fn, a); if (error) throw Error(error.message); return data; };
    return {
        open: ({ id, sessionId, agentKey, review, brief }) => call('mobile_task_open', { p_task: id, p_owner: principal.ownerId, p_workspace: principal.workspaceId, p_session: sessionId, p_agent: agentKey, p_review: review, p_brief: brief }),
        claimAttempt: (id, key) => call('mobile_task_attempt', { p_task: id, p_owner: principal.ownerId, p_key: key, p_no_retry: true }),
        finish: (id, key, status, digest) => call('mobile_task_finish', { p_task: id, p_owner: principal.ownerId, p_key: key, p_status: status, p_digest: digest ?? null }),
        transition: (id, next, actor, evidence = [], waiting = null) => call('mobile_task_transition', { p_task: id, p_owner: principal.ownerId, p_next: next, p_actor: actor, p_evidence: evidence, p_waiting: waiting })
    };
}
// Execution receipts. The only writer of result_recorded_at is the controller-side
// mobile_execution_result function, which binds execution + instance + run before recording.
// The issuer signs only a recorded result that belongs to this owner/workspace, and binds the
// receipt to the execution id, instance and run, so a result for another run cannot be substituted.
export async function issueExecutionReceipt({ principal, executionId, readExecution, privateKey, now = () => Date.now() }) {
    if (!privateKey) throw Error('Receipt signing not configured');
    const e = await readExecution(executionId);
    if (!e || e.ownerId !== principal.ownerId || e.workspaceId !== principal.workspaceId) return { status: 'unknown' };
    if (!e.resultRecordedAt || typeof e.result !== 'string' || !e.instanceId || !e.runId) return { status: 'pending' };
    return signReceipt(privateKey, { ownerId: e.ownerId, workspaceId: e.workspaceId, sessionId: e.sessionId, requestId: executionId, executionId, status: e.success ? 'complete' : 'failed', replyDigest: e.success ? replyDigest(e.result) : null, issuedAt: new Date(now()).toISOString(), instanceId: e.instanceId, runId: e.runId });
}
