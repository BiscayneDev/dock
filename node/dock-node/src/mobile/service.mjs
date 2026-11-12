import { createHash } from 'node:crypto';
// Production adapters supply durable store + canonical Dock inference/memory.
// Mobile session/role binding comes from paired device DB rows, never prompt.
// tasks: optional server-side task ledger (default off). The server is the trusted writer here: it
// records the task after its own durable turn completion, so no client or task supplies completion.
// Flag-on: the claim is authoritative (fail closed before the model), the turn is not cancelled by client
// disconnect, and the recorded result is recoverable by the same request id. Display transitions are best-effort.
export function mobileConversationService({ store, context, answer, recordTurn, planSpecialist = undefined, tasks = /** @type {any} */ (undefined), queue = false, onTaskError = () => { } }) {
    const track = async fn => { if (!tasks) return; try { await fn(); } catch (e) { onTaskError(e); } };
    const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
    async function get(principal, id) { const s = await store.session(id); if (!s || s.deviceId !== principal.deviceId || s.ownerId !== principal.ownerId || s.workspaceId !== principal.workspaceId)
        throw Error('Session not owned'); return s; }
    // Queue mode: the stored ack is only the first answer. Reads the task's own status (owner + session scoped,
    // pure read) so a reconnect says queued / working / result and never repeats "Queued" after completion.
    const queuedView = async (s, requestId, ack) => {
        let st = null; try { st = await tasks.jobStatus(requestId, s.id); } catch (e) { onTaskError(e); }
        if (!st) return ack;
        const text = { queued: 'Queued. No worker has picked it up yet.', working: 'Working on it.', done: st.summary, failed: 'It did not finish. Nothing was retried automatically.', uncertain: 'It started, then stopped before reporting back. It was not run again.' }[st.status] ?? ack.text;
        return { ...ack, text, queued: st.status === 'queued' || st.status === 'working', taskStatus: st.status, evidence: st.status === 'done' ? st.evidence : undefined };
    };
    return {
        async open(principal, requestId) { return store.open(principal, requestId); },
        async load(principal, id) { const s = await get(principal, id); return { sessionId: s.id, messages: await store.messages(s) }; },
        async turn(principal, { sessionId, requestId, text }, signal) {
            const s = await get(principal, sessionId);
            if (!text?.trim() || text.length > 32000)
                throw Error('Invalid turn');
            const fingerprint = hash({ sessionId, text }), receipt = await store.claim(s, requestId, fingerprint);
            if (receipt.status === 'complete')
                return queue && tasks ? await queuedView(s, requestId, receipt.result) : receipt.result;
            if (receipt.status !== 'claimed' && queue && tasks) {
                const v = await queuedView(s, requestId, { text: 'Queued.', queued: true, sessionId: s.id, requestId, proposals: [] }); // crash between enqueue and ack
                if (v.taskStatus) return v;
            }
            if (receipt.status !== 'claimed')
                throw Error('Turn pending or conflicted; read status, do not replay inference');
            if (tasks && !queue) {
                // Flag-on: the durable claim is authoritative and fails closed BEFORE any model dispatch.
                // Only display transitions below are best-effort.
                try {
                    await tasks.open({ id: requestId, sessionId, agentKey: s.agentId, review: 'none', brief: text.slice(0, 500) });
                    if (await tasks.claimAttempt(requestId, 'turn') !== true)
                        throw Error('Task attempt already claimed');
                }
                catch (e) {
                    onTaskError(e);
                    await store.fail(s, requestId, fingerprint).catch(() => { });
                    throw Error('Task claim not recorded; nothing was sent to the model');
                }
                await track(async () => { await tasks.transition(requestId, 'delegated', 'system'); await tasks.transition(requestId, 'running', 'agent'); });
            }
            if (queue && tasks) {
                // Durable queue mode: nothing is sent to a model here. A separate lease-fenced worker runs the job.
                try { await tasks.open({ id: requestId, sessionId, agentKey: s.agentId, review: 'none', brief: text.slice(0, 500) }); if (await tasks.enqueue(requestId, text, { repoKeys: s.repoKeys ?? [], worktree: 'wt-' + requestId.toLowerCase(), beaconScope: { agentKey: s.agentId, taskId: requestId, sharedWrites: 'owner-promotion-only' } }) !== true) throw Error('not queued'); }
                catch (e) { onTaskError(e); await store.fail(s, requestId, fingerprint).catch(() => { }); throw Error('Task not queued; nothing was started'); }
                const ack = { text: 'Queued. The result will appear in your tasks.', queued: true, sessionId: s.id, requestId, proposals: [] };
                // Close the turn-store claim with the acknowledgement so the session is not blocked and a retry returns it.
                await store.complete(s, requestId, fingerprint, { user: text, assistant: ack.text, reply: ack, proposals: [], agentId: s.agentId });
                return ack;
            }
            try {
                const shared = await context({ ...principal, projectId: s.projectId, repoKeys: s.repoKeys, agentId: s.agentId }, text);
                const history = await store.messages(s);
                const answerResult = await answer({ principal, session: s, text, history, context: shared, signal: tasks ? undefined : signal, planSpecialist: planSpecialist ? request => planSpecialist({ principal, session: s, request }) : undefined });
                const result = typeof answerResult === 'string' ? answerResult : answerResult?.text;
                const proposals = typeof answerResult === 'string' ? [] : answerResult?.proposals ?? [];
                if (!Array.isArray(proposals) || proposals.length > 4)
                    throw Error('Invalid proposals');
                if (typeof result !== 'string' || !result.trim() || result.length > 200000)
                    throw Error('Invalid reply');
                const reply = { text: result, contextVersion: shared.version, sessionId: s.id, requestId, proposals };
                await store.complete(s, requestId, fingerprint, { user: text, assistant: result, reply, proposals, agentId: s.agentId });
                // Canonical existing Dock memory, not a second mobile memory store. No
                // automatic promotion of graph source text or specialist scratch state.
                await recordTurn({ userId: principal.ownerId, workspaceId: principal.workspaceId }, s.conversationId, s.projectId, { userText: text, assistantText: result });
                await track(async () => { await tasks.finish(requestId, 'turn', 'delivered', createHash('sha256').update(result).digest('hex'), result.replace(/\s+/g, ' ').slice(0, 300)); await tasks.transition(requestId, 'done', 'agent', ['server recorded completed turn ' + requestId]); });
                return reply;
            }
            catch (e) {
                await track(() => tasks.transition(requestId, 'failed', 'system'));
                await store.fail(s, requestId, fingerprint).catch(() => { });
                throw e;
            }
        }
    };
}
