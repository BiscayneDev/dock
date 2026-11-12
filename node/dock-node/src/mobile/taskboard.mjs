// A state change is bookkeeping only: it never grants execution, spend or approval.
// Task-centered state for the phone surface. Pure logic over an injected store,
// so it is testable without hosts, models or network. The task owns the work:
// brief, accountable agent, current result, proof and what waits on the owner.
const STATES = ['queued', 'delegated', 'running', 'blocked', 'waiting_on_you', 'ready_for_review', 'done', 'failed'];
const NEXT = {
    queued: ['delegated', 'failed'],
    delegated: ['running', 'blocked', 'failed'],
    running: ['blocked', 'waiting_on_you', 'ready_for_review', 'done', 'failed'],
    blocked: ['delegated', 'waiting_on_you', 'failed'],
    waiting_on_you: ['delegated', 'running', 'failed'],
    ready_for_review: ['done', 'delegated', 'failed'],
    done: [],
    failed: ['delegated']
};
export const taskStates = STATES;
export function memoryTaskStore() { const tasks = new Map(), outbox = new Map(); return { tasks, outbox }; }
// A configured agent is not a working agent. Reachable needs a recent verified contact.
export function reachability(agent, now = Date.now(), maxAgeMs = 5 * 60_000) {
    if (!agent?.configured) return { state: 'not_configured' };
    if (!agent.lastContactAt) return { state: 'configured_untested' };
    if (agent.lastTestOk === false) return { state: 'unreachable', lastContactAt: agent.lastContactAt };
    const age = now - Date.parse(agent.lastContactAt);
    return { state: age <= maxAgeMs ? 'reachable' : 'stale', lastContactAt: agent.lastContactAt };
}
export function taskBoard({ store = memoryTaskStore(), now = () => Date.now(), maxAttempts = 3 } = {}) {
    const get = id => { const t = store.tasks.get(id); if (!t) throw Error('Unknown task'); return t; };
    const log = (t, actor, kind, detail) => t.events.push({ at: new Date(now()).toISOString(), actor, kind, ...detail });
    return {
        create({ id, brief, agentId, review = 'owner' }) {
            if (!['owner', 'none'].includes(review)) throw Error('Unknown review policy');
            if (!id || !brief || !agentId) throw Error('id, brief and accountable agent required');
            if (store.tasks.has(id)) throw Error('Task exists');
            const t = { id, agentId, review, state: 'queued', versions: [{ v: 1, brief, actor: 'owner' }], result: null, evidence: [], waitingOn: null, events: [] };
            store.tasks.set(id, t); return t;
        },
        transition(id, next, { actor = 'agent', evidence, waitingOn } = {}) {
            const t = get(id);
            if (!NEXT[t.state].includes(next)) throw Error(`Cannot move ${t.state} to ${next}`);
            if (next === 'ready_for_review') { if (!evidence?.length) throw Error('Proof required before review'); t.evidence.push(...evidence); }
            if (next === 'done') {
                // Routine work closes on proof. Only a task whose review policy requires the owner waits for the owner.
                if (t.review === 'owner' && actor !== 'owner') throw Error('Review policy requires the owner to close this task');
                if (evidence?.length) t.evidence.push(...evidence);
                if (!t.evidence.length) throw Error('Proof required before closing');
            }
            if (next === 'waiting_on_you') { if (!waitingOn) throw Error('Say what the owner must decide'); t.waitingOn = waitingOn; }
            else if (t.waitingOn) t.waitingOn = null;
            log(t, actor, 'state', { from: t.state, to: next }); t.state = next; return t;
        },
        // Owner-visible next action across tasks, most urgent first.
        inbox() { const rank = { waiting_on_you: 0, ready_for_review: 1, blocked: 2, failed: 3 }; return [...store.tasks.values()].filter(t => t.state in rank).sort((a, b) => rank[a.state] - rank[b.state]).map(t => ({ id: t.id, state: t.state, waitingOn: t.waitingOn })); },
        // Versioned brief. Rollback adds a version; it cannot undo sent mail, spend or deploys.
        edit(id, brief, actor) { const t = get(id); t.versions.push({ v: t.versions.length + 1, brief, actor }); log(t, actor, 'edit', { v: t.versions.length }); return t; },
        rollback(id, v, actor) { const t = get(id); const old = t.versions.find(x => x.v === v); if (!old) throw Error('Unknown version'); return this.edit(id, old.brief, actor); },
        // Durable handoff: one intent per idempotency key; an uncertain send is looked up, never resent.
        enqueue(id, key, message, { noRetry = false } = {}) {
            const t = get(id); const k = `${id}:${key}`;
            if (!store.outbox.has(k)) store.outbox.set(k, { key: k, taskId: id, agentId: t.agentId, message, noRetry, status: 'pending', attempts: 0 });
            return store.outbox.get(k);
        },
        async deliver(k, { send, lookup }) {
            const o = store.outbox.get(k); if (!o) throw Error('Unknown handoff');
            if (o.status === 'delivered' || o.status === 'failed') return o;
            if (o.status === 'uncertain') {
                const hit = await lookup(o.key);
                if (hit === true) { o.status = 'delivered'; return o; }
                if (hit !== false) return o; // still cannot tell: do not resend
            }
            // noRetry (payments and other effects): exactly one attempt, never automatic. A failure is surfaced to the owner.
            const limit = o.noRetry ? 1 : maxAttempts;
            while (o.attempts < limit) {
                o.attempts++; o.status = 'uncertain'; // recorded before the send so a crash cannot repeat it blindly
                try { await send(o.message, o.key); o.status = 'delivered'; return o; }
                catch (e) { if (e?.definitelyNotSent) { o.status = 'pending'; continue; } return o; }
            }
            o.status = 'failed'; const t = get(o.taskId); if (NEXT[t.state].includes('blocked')) this.transition(t.id, 'blocked', { actor: 'system' });
            return o;
        }
    };
}
