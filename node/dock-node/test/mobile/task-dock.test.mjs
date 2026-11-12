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
test('same request id after a disconnect resolves by lookup, with no second model call', async () => {
    let calls = 0, done = false;
    const D = 'a'.repeat(64);
    const dock = taskBackedDock({ ownerId: 'o1', dock: { turn: async () => { calls++; throw Error('disconnect'); } }, status: async q => ({ status: done ? 'complete' : 'pending', ownerId: 'o1', sessionId: q.sessionId, requestId: q.requestId, replyDigest: D }) });
    await assert.rejects(dock.turn({ sessionId: 's', requestId: 'r1', text: 'x' }));
    await assert.rejects(dock.turn({ sessionId: 's', requestId: 'r1', text: 'x' }), /uncertain/); // still pending: stays put
    done = true;
    const r = await dock.turn({ sessionId: 's', requestId: 'r1', text: 'x' });
    assert.match(r.text, /already completed/); assert.equal(calls, 1);
    assert.equal(dock.board.get('r1').state, 'done'); assert.deepEqual(dock.board.inbox(), []);
});
test('recovery receipt for another owner, session or request, or without a backend digest, is ignored', async () => {
    for (const bad of [{ ownerId: 'other' }, { sessionId: 'other' }, { requestId: 'other' }, { replyDigest: 'self-claimed' }, { replyDigest: undefined }]) {
        let calls = 0; const dock = taskBackedDock({ ownerId: 'o1', dock: { turn: async () => { calls++; throw Error('x'); } }, status: async q => ({ status: 'complete', ownerId: 'o1', sessionId: q.sessionId, requestId: q.requestId, replyDigest: 'b'.repeat(64), ...bad }) });
        await assert.rejects(dock.turn({ sessionId: 's', requestId: 'r', text: 'x' }));
        await assert.rejects(dock.turn({ sessionId: 's', requestId: 'r', text: 'x' }), /uncertain/);
        assert.equal(dock.board.get('r').state, 'blocked'); assert.equal(calls, 1);
    }
});
test('without an owner binding no lookup is trusted', async () => {
    const dock = taskBackedDock({ dock: { turn: async () => { throw Error('x'); } }, status: async () => ({ status: 'complete' }) });
    await assert.rejects(dock.turn({ sessionId: 's', requestId: 'r', text: 'x' })); await assert.rejects(dock.turn({ sessionId: 's', requestId: 'r', text: 'x' }), /uncertain/);
});
test('/tasks shows whether the agent is actually reachable, not just configured', async () => {
    const at = Date.parse('2026-01-01T00:10:00Z'); const mk = h => taskBackedDock({ dock: {}, health: async () => h, now: () => at });
    assert.match((await mk({ configured: true }).turn({ requestId: 'a', text: '/tasks' })).text, /configured untested/);
    assert.match((await mk({ configured: true, lastContactAt: '2026-01-01T00:09:00Z' }).turn({ requestId: 'a', text: '/tasks' })).text, /reachable/);
    assert.match((await mk({ configured: true, lastContactAt: '2026-01-01T00:09:00Z', lastTestOk: false }).turn({ requestId: 'a', text: '/tasks' })).text, /unreachable/);
});
