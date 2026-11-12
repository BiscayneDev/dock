import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDockAcp } from '../../src/mobile/acp.mjs';
import { taskBackedDock } from '../../src/mobile/task-dock.mjs';
const setup = (turn, status) => { const out = []; const dock = taskBackedDock({ dock: { open: async () => ({ sessionId: 's1' }), turn }, status }); const acp = createDockAcp({ dock, emit: async m => out.push(m) }); return { dock, acp, out }; };
const prompt = (acp, text) => acp.handle({ method: 'session/prompt', params: { sessionId: 's1', prompt: [{ type: 'text', text }] } });
test('phone turn through ACP becomes a task closed on recorded reply', async () => {
    const { acp, dock } = setup(async () => ({ text: 'fictional reply' }));
    await acp.handle({ method: 'session/new', params: {} });
    assert.equal((await prompt(acp, 'do a thing')).stopReason, 'end_turn');
    assert.deepEqual(dock.board.inbox(), []);
});
test('uncertain turn: no replay, task shows as blocked, /tasks costs no model call', async () => {
    let calls = 0; const { acp, dock, out } = setup(async () => { calls++; throw Error('disconnect'); });
    await acp.handle({ method: 'session/new', params: {} });
    await assert.rejects(prompt(acp, 'spend something'));
    assert.equal(calls, 1);
    assert.ok(out.some(m => /uncertain/.test(m.params.update.content.text)));
    assert.equal(dock.board.inbox()[0].state, 'blocked');
    await prompt(acp, '/tasks'); assert.equal(calls, 1);
    assert.match(out.at(-1).params.update.content.text, /BLOCKED/);
});
import { generateKeyPairSync } from 'node:crypto';
import { signReceipt, replyDigest } from '../../src/mobile/receipt.mjs';
const keys = generateKeyPairSync('ed25519'), other = generateKeyPairSync('ed25519');
const NOW = Date.parse('2026-01-01T00:00:00Z'), iso = new Date(NOW).toISOString();
const scope = { ownerId: 'o1', workspaceId: 'w1' };
const mkRecover = (statusFn) => { let calls = 0; const dock = taskBackedDock({ ...scope, receiptKey: keys.publicKey, now: () => NOW, dock: { turn: async () => { calls++; throw Error('disconnect'); } }, status: statusFn }); return { dock, calls: () => calls }; };
const good = (q, over = {}, key = keys.privateKey) => signReceipt(key, { ...scope, sessionId: q.sessionId, requestId: q.requestId, status: 'complete', replyDigest: replyDigest('fictional'), issuedAt: iso, ...over });
test('same request id after a disconnect resolves by signed receipt, with no second model call', async () => {
    let done = false; const { dock, calls } = mkRecover(async q => done ? good(q) : { status: 'pending' });
    await assert.rejects(dock.turn({ sessionId: 's', requestId: 'r1', text: 'x' }));
    await assert.rejects(dock.turn({ sessionId: 's', requestId: 'r1', text: 'x' }), /uncertain/);
    done = true;
    assert.match((await dock.turn({ sessionId: 's', requestId: 'r1', text: 'x' })).text, /already completed/);
    assert.equal(calls(), 1); assert.equal(dock.board.get('r1').state, 'done'); assert.deepEqual(dock.board.inbox(), []);
});
test('forged, tampered, unsigned, wrong-scope, stale or future receipts are ignored', async () => {
    const cases = [q => good(q, {}, other.privateKey), q => ({ ...good(q), replyDigest: 'c'.repeat(64) }), q => ({ ...good(q), sig: undefined }),
        q => good(q, { ownerId: 'other' }), q => good(q, { workspaceId: 'other' }), q => good(q, { sessionId: 'other' }), q => good(q, { requestId: 'other' }),
        q => good(q, { issuedAt: new Date(NOW - 2 * 86400_000).toISOString() }), q => good(q, { issuedAt: new Date(NOW + 3600_000).toISOString() }),
        q => good(q, { replyDigest: 'self-claimed' }), q => ({ status: 'complete', ownerId: 'o1', workspaceId: 'w1', sessionId: q.sessionId, requestId: q.requestId, replyDigest: 'b'.repeat(64) })];
    for (const c of cases) {
        const { dock, calls } = mkRecover(async q => c(q));
        await assert.rejects(dock.turn({ sessionId: 's', requestId: 'r', text: 'x' }));
        await assert.rejects(dock.turn({ sessionId: 's', requestId: 'r', text: 'x' }), /uncertain/);
        assert.equal(dock.board.get('r').state, 'blocked'); assert.equal(calls(), 1);
    }
});
test('without owner binding or a receipt public key no lookup is trusted', async () => {
    for (const extra of [{ receiptKey: keys.publicKey }, { ownerId: 'o1' }]) {
        const dock = taskBackedDock({ ...extra, dock: { turn: async () => { throw Error('x'); } }, status: async q => good(q) });
        await assert.rejects(dock.turn({ sessionId: 's', requestId: 'r', text: 'x' })); await assert.rejects(dock.turn({ sessionId: 's', requestId: 'r', text: 'x' }), /uncertain/);
    }
});
test('/tasks shows whether the agent is actually reachable, not just configured', async () => {
    const at = Date.parse('2026-01-01T00:10:00Z'); const mk = h => taskBackedDock({ dock: {}, health: async () => h, now: () => at });
    assert.match((await mk({ configured: true }).turn({ requestId: 'a', text: '/tasks' })).text, /configured untested/);
    assert.match((await mk({ configured: true, lastContactAt: '2026-01-01T00:09:00Z' }).turn({ requestId: 'a', text: '/tasks' })).text, /reachable/);
    assert.match((await mk({ configured: true, lastContactAt: '2026-01-01T00:09:00Z', lastTestOk: false }).turn({ requestId: 'a', text: '/tasks' })).text, /unreachable/);
});
import { probeAgent, reachability } from '../../src/mobile/taskboard.mjs';
test('reachability comes from a real probe: ok, timeout and error are distinguished, config alone is not enough', async () => {
    const t = Date.parse('2026-01-01T00:00:00Z');
    assert.equal(reachability(await probeAgent({ ping: async () => 1, now: () => t }), t).state, 'reachable');
    assert.equal(reachability(await probeAgent({ ping: () => new Promise(() => { }), timeoutMs: 20, now: () => t }), t).state, 'unreachable');
    assert.equal(reachability(await probeAgent({ ping: async () => { throw Error('x'); }, now: () => t }), t).state, 'unreachable');
    assert.equal(reachability(await probeAgent({ configured: false, ping: async () => 1 }), t).state, 'not_configured');
    assert.equal(reachability({ configured: true }, t).state, 'configured_untested');
    assert.equal(reachability(await probeAgent({ ping: async () => 1, now: () => t }), t + 10 * 60_000).state, 'stale');
});
test('each phone task gets its own worktree and task-scoped Beacon scope when repos are granted; no execution starts', async () => {
    const turns = [];
    const dock = taskBackedDock({ dock: { open: async () => ({ sessionId: 's1' }), turn: async x => (turns.push(x), { text: 'ok' }) }, repoKeys: ['fictional-repo'], agentId: 'chief' });
    await dock.open({}); await dock.turn({ sessionId: 's1', requestId: 'aaaaaaaa-1111-4111-8111-111111111111', text: 'a' }); await dock.turn({ sessionId: 's1', requestId: 'bbbbbbbb-2222-4222-8222-222222222222', text: 'b' });
    const a = dock.board.get('aaaaaaaa-1111-4111-8111-111111111111').context, b = dock.board.get('bbbbbbbb-2222-4222-8222-222222222222').context;
    assert.notEqual(a.worktree, b.worktree); assert.equal(a.beaconScope.sharedWrites, 'owner-promotion-only'); assert.equal(a.beaconScope.taskId, 'aaaaaaaa-1111-4111-8111-111111111111'); assert.equal(turns.length, 2);
});
