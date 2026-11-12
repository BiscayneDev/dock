import { createHash } from 'node:crypto';
// Production adapters supply durable store + canonical Dock inference/memory.
// Mobile session/role binding comes from paired device DB rows, never prompt.
// tasks: optional server-side task ledger (default off). The server is the trusted writer here: it
// records the task after its own durable turn completion, so no client or task supplies completion.
// Ledger failures never change the turn result; they are reported through onTaskError.
export function mobileConversationService({ store, context, answer, recordTurn, planSpecialist = undefined, tasks = /** @type {any} */ (undefined), onTaskError = () => { } }) {
    const track = async fn => { if (!tasks) return; try { await fn(); } catch (e) { onTaskError(e); } };
    const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
    async function get(principal, id) { const s = await store.session(id); if (!s || s.deviceId !== principal.deviceId || s.ownerId !== principal.ownerId || s.workspaceId !== principal.workspaceId)
        throw Error('Session not owned'); return s; }
    return {
        async open(principal, requestId) { return store.open(principal, requestId); },
        async load(principal, id) { const s = await get(principal, id); return { sessionId: s.id, messages: await store.messages(s) }; },
        async turn(principal, { sessionId, requestId, text }, signal) {
            const s = await get(principal, sessionId);
            if (!text?.trim() || text.length > 32000)
                throw Error('Invalid turn');
            const fingerprint = hash({ sessionId, text }), receipt = await store.claim(s, requestId, fingerprint);
            if (receipt.status === 'complete')
                return receipt.result;
            if (receipt.status !== 'claimed')
                throw Error('Turn pending or conflicted; read status, do not replay inference');
            await track(async () => { await tasks.open({ id: requestId, sessionId, agentKey: s.agentId, review: 'none', brief: text.slice(0, 500) }); await tasks.transition(requestId, 'delegated', 'system'); await tasks.claimAttempt(requestId, 'turn'); await tasks.transition(requestId, 'running', 'agent'); });
            try {
                const shared = await context({ ...principal, projectId: s.projectId, repoKeys: s.repoKeys, agentId: s.agentId }, text);
                const history = await store.messages(s);
                const answerResult = await answer({ principal, session: s, text, history, context: shared, signal, planSpecialist: planSpecialist ? request => planSpecialist({ principal, session: s, request }) : undefined });
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
