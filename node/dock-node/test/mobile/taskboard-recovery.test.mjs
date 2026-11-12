import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { taskBoard, fileTaskStore } from '../../src/mobile/taskboard.mjs';
const mod = new URL('../../src/mobile/taskboard.mjs', import.meta.url).href;
// Worker process creates a task and hands it off. The spool write lands, then the
// process is killed before it can record delivery (a real disconnect/crash).
const child = (dir) => `
import { taskBoard, fileTaskStore } from '${mod}';
import { writeFileSync } from 'node:fs';
const b = taskBoard({ store: fileTaskStore('${dir}/tasks.json') });
b.create({ id: 't1', brief: 'Fictional job', agentId: 'agent-a', review: 'none' });
b.transition('t1', 'delegated');
const o = b.enqueue('t1', 'k1', 'do it');
await b.deliver(o.key, { send: async (m, key) => { writeFileSync('${dir}/spool-' + key.replace(':','_'), m); process.kill(process.pid, 'SIGKILL'); } });
`;
test('real process kill mid-handoff: restart looks up the spool and does not send twice', async () => {
    const dir = mkdtempSync(tmpdir() + '/tb-');
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', child(dir)]);
    assert.equal(r.signal, 'SIGKILL');
    const b = taskBoard({ store: fileTaskStore(dir + '/tasks.json') });
    const o = b.enqueue('t1', 'k1', 'do it'); // same intent, deduped from disk
    assert.equal(o.status, 'uncertain'); assert.equal(o.attempts, 1);
    let sends = 0;
    await b.deliver(o.key, { send: async () => { sends++; }, lookup: async key => existsSync(dir + '/spool-' + key.replace(':', '_')) });
    assert.equal(sends, 0); assert.equal(o.status, 'delivered');
    assert.equal(readdirSync(dir).filter(f => f.startsWith('spool-')).length, 1);
    // delivery survives another restart; task still delegated and gains proof-gated close
    const b2 = taskBoard({ store: fileTaskStore(dir + '/tasks.json') });
    assert.equal(b2.enqueue('t1', 'k1', 'x').status, 'delivered');
    b2.transition('t1', 'running');
    assert.equal(b2.transition('t1', 'done', { actor: 'agent', evidence: ['fictional check'] }).state, 'done');
});
test('uncertain handoff with no way to look up stays uncertain across restart (no blind resend)', async () => {
    const dir = mkdtempSync(tmpdir() + '/tb-'); const store = fileTaskStore(dir + '/t.json');
    const b = taskBoard({ store }); b.create({ id: 'a', brief: 'x', agentId: 'g' }); b.transition('a', 'delegated');
    const o = b.enqueue('a', 'p', 'm', { noRetry: true });
    await b.deliver(o.key, { send: async () => { throw Error('timeout'); } });
    const b2 = taskBoard({ store: fileTaskStore(dir + '/t.json') }); let sends = 0;
    const o2 = b2.enqueue('a', 'p', 'm'); await b2.deliver(o2.key, { send: async () => { sends++; }, lookup: async () => undefined });
    assert.equal(sends, 0); assert.equal(o2.status, 'uncertain');
});
