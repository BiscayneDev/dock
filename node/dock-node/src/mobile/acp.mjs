// Dock as a local ACP command for the existing T3 app. No local tools, shell,
// workspace reads, MCP execution, model credentials or Agent37 management key.
import { randomUUID } from 'node:crypto';
export function createDockAcp({ dock, emit, journal = undefined }) {
    const sessions = new Map(), active = new Map();
    const fail = (code, message) => Object.assign(new Error(message), { code });
    async function handle(request) {
        const { method, params = {} } = request;
        if (method === 'initialize')
            return { protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: { image: false, audio: false, embeddedContext: false } }, agentInfo: { name: 'dock', title: 'Dock', version: '0.1.0' }, authMethods: [] };
        if (method === 'session/new') {
            // cwd and mcpServers deliberately ignored: the phone host is a control plane,
            // not a shared task workspace. Dock owns project/agent grants on the backend.
            const session = await dock.open({ requestId: randomUUID() });
            sessions.set(session.sessionId, session);
            return { sessionId: session.sessionId };
        }
        if (method === 'session/load') {
            const session = await dock.load(params.sessionId);
            sessions.set(session.sessionId, session);
            for (const message of session.messages ?? [])
                await emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: session.sessionId, update: { sessionUpdate: message.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk', content: { type: 'text', text: message.content } } } });
            return {};
        }
        const session = sessions.get(params.sessionId);
        if (!session)
            throw fail(-32602, 'Unknown session');
        if (method === 'session/cancel') {
            active.get(params.sessionId)?.abort();
            return;
        }
        if (method !== 'session/prompt')
            throw fail(-32601, 'Unsupported method');
        if (active.has(params.sessionId))
            throw fail(-32000, 'Session already has an active turn');
        if (!Array.isArray(params.prompt) || params.prompt.some(x => x.type !== 'text' || typeof x.text !== 'string'))
            throw fail(-32602, 'Only text messages supported');
        const text = params.prompt.map(x => x.text).join('\n');
        if (!text.trim() || text.length > 32000)
            throw fail(-32602, 'Invalid message');
        const controller = new AbortController();
        active.set(params.sessionId, controller);
        try {
            // Each turn has an opaque request ID recorded by backend. Transport never replays a write.
            const requestId = randomUUID();
            let reply;
            await journal?.record({ sessionId: params.sessionId, requestId, status: 'sending' });
            try {
                reply = await dock.turn({ sessionId: params.sessionId, requestId, text, signal: controller.signal });
            }
            catch (e) {
                if (controller.signal.aborted)
                    return { stopReason: 'cancelled' };
                await journal?.record({ sessionId: params.sessionId, requestId, status: 'uncertain' });
                await emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Dock turn status is uncertain. Do not repeat the task. Request ID: ' + requestId } } } });
                throw e;
            }
            if (controller.signal.aborted)
                return { stopReason: 'cancelled' };
            await journal?.record({ sessionId: params.sessionId, requestId, status: 'complete' });
            if (typeof reply.text !== 'string' || reply.text.length > 200000)
                throw fail(-32603, 'Invalid Dock reply');
            await emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: reply.text + (reply.proposals?.length ? '\n\n' + reply.proposals.map((p, i) => 'Task proposal ' + (i + 1) + ': ' + p.goal + '\nAssignments: ' + p.assignments.map(a => a.agentKey + ': ' + a.prompt).join('; ') + '\nBudget cap: $' + (p.budgetCents / 100).toFixed(2) + '\nRisks: ' + (p.riskFlags.map(r=>({spends_money:'Spends money',contacts_people:'Contacts people',publishes_externally:'Publishes externally',deletes_data:'Deletes data'}[r]??r)).join(', ') || 'none declared') + '\nNot started. Review in Dock before approving.').join('\n\n') : '') } } } });
            return { stopReason: 'end_turn' };
        }
        finally {
            active.delete(params.sessionId);
        }
    }
    return { handle };
}
export function dockMobileClient({ url, token, fetchImpl = fetch }) {
    const base = new URL(url);
    if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname))
        throw Error('HTTPS Dock endpoint required');
    async function call(path, body, signal) { const r = await fetchImpl(new URL(path, base), { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...body ? { 'content-type': 'application/json' } : {} }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) }); if (!r.ok)
        throw Error(`Dock request refused (${r.status})`); return r.json(); }
    return { open: x => call('/api/mobile/sessions', x), load: id => call(`/api/mobile/sessions/${encodeURIComponent(id)}`), turn: ({ signal, ...x }) => call(`/api/mobile/sessions/${encodeURIComponent(x.sessionId)}/turns`, x, signal) };
}
