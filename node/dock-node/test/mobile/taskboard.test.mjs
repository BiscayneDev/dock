import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskBoard, reachability } from '../../src/mobile/taskboard.mjs';
const mk = () => { const b = taskBoard(); b.create({ id: 't1', brief: 'Fix fictional widget', agentId: 'agent-a' }); return b; };
test('configured is not reachable; stale and failed tests are visible', () => {
    const now = Date.parse('2026-01-01T00:10:00Z');
    assert.equal(reachability({ configured: true }, now).state, 'configured_untested');
    assert.equal(reachability({ configured: true, lastContactAt: '2026-01-01T00:09:00Z' }, now).state, 'reachable');
    assert.equal(reachability({ configured: true, lastContactAt: '2026-01-01T00:00:00Z' }, now).state, 'stale');
    assert.equal(reachability({ configured: true, lastContactAt: '2026-01-01T00:09:00Z', lastTestOk: false }, now).state, 'unreachable');
});
test('review needs proof; only the owner closes; waiting needs a stated decision', () => {
    const b = mk(); b.transition('t1', 'delegated'); b.transition('t1', 'running');
    assert.throws(() => b.transition('t1', 'ready_for_review'), /Proof/);
    assert.throws(() => b.transition('t1', 'waiting_on_you'), /decide/);
    b.transition('t1', 'ready_for_review', { evidence: ['fictional test log'] });
    assert.throws(() => b.transition('t1', 'done', { actor: 'agent' }), /owner/);
    assert.equal(b.transition('t1', 'done', { actor: 'owner' }).state, 'done');
    assert.throws(() => b.transition('t1', 'running'), /Cannot/);
});
test('inbox ranks what waits on the owner first', () => {
    const b = mk(); b.create({ id: 't2', brief: 'x', agentId: 'a' });
    b.transition('t1', 'delegated'); b.transition('t1', 'blocked');
    b.transition('t2', 'delegated'); b.transition('t2', 'running'); b.transition('t2', 'waiting_on_you', { waitingOn: 'pick option' });
    assert.deepEqual(b.inbox().map(x => x.id), ['t2', 't1']);
});
test('rollback adds a version and keeps history', () => {
    const b = mk(); b.edit('t1', 'v2 brief', 'agent-a'); const t = b.rollback('t1', 1, 'owner');
    assert.equal(t.versions.length, 3); assert.equal(t.versions[2].brief, 'Fix fictional widget'); assert.equal(t.events.length, 2);
});
test('handoff dedupes by key and delivers once', async () => {
    const b = mk(); let sends = 0; const a = b.enqueue('t1', 'k', 'hello'), c = b.enqueue('t1', 'k', 'hello');
    assert.equal(a, c);
    await b.deliver(a.key, { send: async () => { sends++; } }); await b.deliver(a.key, { send: async () => { sends++; } });
    assert.equal(sends, 1); assert.equal(a.status, 'delivered');
});
test('uncertain send after disconnect is looked up, not resent', async () => {
    const b = mk(); b.transition('t1', 'delegated'); const o = b.enqueue('t1', 'k', 'm'); let sends = 0;
    await b.deliver(o.key, { send: async () => { sends++; throw Error('timeout'); } });
    assert.equal(o.status, 'uncertain'); assert.equal(sends, 1);
    await b.deliver(o.key, { send: async () => { sends++; }, lookup: async () => undefined });
    assert.equal(sends, 1, 'cannot tell, must not resend');
    await b.deliver(o.key, { send: async () => { sends++; }, lookup: async () => true });
    assert.equal(o.status, 'delivered'); assert.equal(sends, 1);
});
test('provably unsent retries are bounded and failure blocks the task visibly', async () => {
    const b = mk(); b.transition('t1', 'delegated'); const o = b.enqueue('t1', 'k', 'm'); let sends = 0;
    await b.deliver(o.key, { send: async () => { sends++; throw Object.assign(Error('refused'), { definitelyNotSent: true }); } });
    assert.equal(sends, 3); assert.equal(o.status, 'failed');
    assert.equal(b.inbox()[0].state, 'blocked');
});
test('definitely-unsent retry can succeed', async () => {
    const b = mk(); const o = b.enqueue('t1', 'k', 'm'); let n = 0;
    await b.deliver(o.key, { send: async () => { if (++n < 2) throw Object.assign(Error('x'), { definitelyNotSent: true }); } });
    assert.equal(o.status, 'delivered'); assert.equal(n, 2);
});
test('routine task closes on proof without the owner; owner-review task waits', () => {
    const b = taskBoard(); b.create({ id: 'r', brief: 'x', agentId: 'a', review: 'none' }); b.create({ id: 'p', brief: 'x', agentId: 'a' });
    for (const id of ['r', 'p']) { b.transition(id, 'delegated'); b.transition(id, 'running'); }
    assert.throws(() => b.transition('r', 'done', { actor: 'agent' }), /Proof/);
    assert.equal(b.transition('r', 'done', { actor: 'agent', evidence: ['fictional passing check'] }).state, 'done');
    assert.throws(() => b.transition('p', 'done', { actor: 'agent', evidence: ['e'] }), /owner/);
});
test('state changes carry no authority; payment-style handoffs never auto-retry', async () => {
    const b = mk(); b.transition('t1', 'delegated'); const o = b.enqueue('t1', 'pay', 'm', { noRetry: true }); let n = 0;
    await b.deliver(o.key, { send: async () => { n++; throw Object.assign(Error('x'), { definitelyNotSent: true }); } });
    assert.equal(n, 1); assert.equal(o.status, 'failed'); assert.equal(b.inbox()[0].state, 'blocked');
    assert.equal(typeof b.approve, 'undefined'); assert.equal(typeof b.spend, 'undefined');
});
test('each task gets its own worktree and task-scoped private memory; context binds once', () => {
    const b = taskBoard(); b.create({ id: 'A1', brief: 'x', agentId: 'a' }); b.create({ id: 'B2', brief: 'x', agentId: 'b' });
    const a = b.bindContext('A1', { repoKeys: ['dock'], agentKey: 'coder' }), c = b.bindContext('B2', { repoKeys: ['dock'], agentKey: 'coder' });
    assert.notEqual(a.worktree, c.worktree); assert.equal(a.beaconScope.taskId, 'A1'); assert.equal(a.beaconScope.sharedWrites, 'owner-promotion-only');
    assert.throws(() => b.bindContext('A1', { repoKeys: ['dock'], agentKey: 'x' }), /already bound/);
    assert.throws(() => b.bindContext('B2', { repoKeys: [], agentKey: 'x' }));
    b.create({ id: 'bad', brief: 'x', agentId: 'a' }); assert.throws(() => b.bindContext('bad', { repoKeys: ['../etc'], agentKey: 'x' }), /Repo keys/);
});
