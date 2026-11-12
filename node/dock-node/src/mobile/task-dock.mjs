// Wraps the Dock client used by the ACP bridge so every phone turn is a tracked task.
// Turns spend model budget, so handoffs are noRetry: one attempt, then lookup by request id.
// Task state changes here are bookkeeping; they approve nothing and start nothing.
import { taskBoard, reachability } from './taskboard.mjs';
import { verifyReceipt } from './receipt.mjs';
// Durability: the default board is in memory. A turn is NOT tracked across a server restart
// unless the caller passes a board over fileTaskStore (or a future server-side store).
// Recovery lookups must be backend-authenticated and scoped: the receipt has to name the same
// owner, session and request, and carry a digest the backend computed. The task cannot supply it.
export function taskBackedDock({ dock, board = taskBoard(), agentId = 'dock', ownerId = undefined, workspaceId = undefined, receiptKey = undefined, status = undefined, health = undefined, now = () => Date.now() }) {
    // Completion only counts as a backend-signed receipt (Ed25519 public key held here) for this exact scope.
    const scoped = (r, sessionId, requestId) => receiptKey && ownerId ? verifyReceipt(receiptKey, r, { ownerId, workspaceId, sessionId, requestId }, { now: now() }) : null;
    const proof = {};
    const line = t => `${t.state === 'waiting_on_you' ? 'WAITING ON YOU' : t.state.replace(/_/g, ' ').toUpperCase()}: ${t.id.slice(0, 8)}${t.waitingOn ? ' - ' + t.waitingOn : ''}`;
    return {
        board,
        open: x => dock.open(x),
        load: id => dock.load(id),
        async turn({ sessionId, requestId, text, signal }) {
            if (text.trim() === '/tasks') { const items = board.inbox(); const r = health ? reachability(await health(), now()) : { state: 'not_checked' };
                const head = `AGENT ${agentId}: ${r.state.replace(/_/g, ' ')}${r.lastContactAt ? ' (last contact ' + r.lastContactAt + ')' : ''}`;
                return { text: head + '\n' + (items.length ? items.map(line).join('\n') : 'Nothing waiting on you.') }; }
            const id = requestId;
            try { board.create({ id, brief: text.slice(0, 500), agentId, review: 'none' }); board.transition(id, 'delegated'); } catch (e) { if (e.message !== 'Task exists') throw e; }
            const h = board.enqueue(id, 'turn', text, { noRetry: true });
            let reply;
            await board.deliver(h.key, {
                send: async () => { reply = await dock.turn({ sessionId, requestId, text, signal }); },
                lookup: status && ownerId && receiptKey ? async () => { const r = scoped(await status({ ownerId, sessionId, requestId }), sessionId, requestId); if (r?.status === 'complete') { proof[id] = r.replyDigest; return true; } return r?.status === 'failed' ? false : undefined; } : undefined
            });
            if (h.status === 'delivered') {
                const t = board.get(id); if (t.state === 'blocked') board.transition(id, 'delegated', { actor: 'system' });
                if (t.state === 'delegated') board.transition(id, 'running');
                board.transition(id, 'done', { actor: 'agent', evidence: [`backend receipt ${reply ? 'reply' : 'digest'} for request ${requestId}${proof[id] ? ' ' + proof[id] : ''}`] });
                if (reply) return reply;
            }
            if (h.status === 'delivered') return { text: 'Dock already completed this request. Open the session to read the reply.' };
            if (h.status === 'uncertain' || h.status === 'failed') { try { board.transition(id, h.status === 'failed' ? 'failed' : 'blocked', { actor: 'system' }); } catch { } }
            throw Error(h.status === 'uncertain' ? 'Dock turn status uncertain; not replaying' : 'Dock turn failed; not retried');
        }
    };
}
