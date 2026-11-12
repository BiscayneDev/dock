// REAL: Postgres draft migrations 0023+0024, job-runner, real child processes killed with SIGKILL.
// FICTIONAL: tasks and "model" (a local function; no inference, no cost). Not deployed, not a host.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { runOneJob } from '../../node/dock-node/src/mobile/job-runner.mjs';
const URI = process.env.PGURI, PSQL = '/usr/lib/postgresql/14/bin/psql', ex = promisify(execFile);
const lit = v => v === null || v === undefined ? 'null' : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const psql = async q => (await ex(PSQL, [URI, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', q])).stdout.trim();
export const db = { rpc: async (fn, a) => { try { const out = await psql(`select ${fn}(${Object.entries(a).map(([k, v]) => `${k} := ${lit(v)}`).join(',')})`); return { data: out === 't' ? true : out === 'f' ? false : out === '' ? null : out.startsWith('{') ? JSON.parse(out) : out }; } catch (e) { return { error: { message: e.message } }; } } };
if (process.argv[2] === 'child') { // a worker process that starts a job then hangs "inside the model" until killed
    await runOneJob({ db, scope: { ownerId: '11111111-1111-1111-1111-111111111111', workspaceId: '22222222-2222-2222-2222-222222222222' }, worker: process.argv[3], ttlSeconds: 1, heartbeatMs: 100000, answer: () => { console.log('IN_MODEL'); return new Promise(() => { }); } }); process.exit(0);
}
const U = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;
const O = U(1), W = U(2), S = U(3), sleep = ms => new Promise(r => setTimeout(r, ms));
const mk = async id => { await psql(`select mobile_task_open('${id}','${O}','${W}','${S}','chief','none','FICTIONAL job')`); assert.equal(await db.rpc('mobile_job_enqueue', { p_task: id, p_owner: O, p_input: 'FICTIONAL input' }).then(r => r.data), true); };
const row = id => psql(`select j.state||'|'||j.epoch||'|'||t.state||'|'||coalesce(t.result_summary,'-')||'|'||coalesce((select status||':'||attempts from mobile_task_handoffs where task_id=j.task_id),'-') from mobile_task_jobs j join mobile_tasks t on t.id=j.task_id where j.task_id='${id}'`);
let calls = 0; const model = async () => { calls++; return 'FICTIONAL result'; };
// A. normal run
const A = U(4); await mk(A); const a = await runOneJob({ db, scope: { ownerId: O, workspaceId: W }, worker: 'w1', answer: model, ttlSeconds: 30 });
assert.deepEqual([a.ran, a.recorded], [true, true]); assert.equal(await row(A), 'done|1|done|FICTIONAL result|delivered:1'); assert.equal(calls, 1);
// B. concurrent leases of ONE job: exactly one winner, one model call
const B = U(5); await mk(B); calls = 0;
const res = await Promise.all(Array.from({ length: 6 }, (_, i) => runOneJob({ db, scope: { ownerId: O, workspaceId: W }, worker: 'c' + i, answer: model, ttlSeconds: 30 })));
assert.equal(res.filter(r => r.ran).length, 1); assert.equal(calls, 1); assert.equal(await row(B), 'done|1|done|FICTIONAL result|delivered:1');
// C. worker dies after lease but BEFORE start: provably unstarted, safely re-leased by another worker; the dead worker is fenced out
const C = U(6); await mk(C); calls = 0;
const dead = await db.rpc('mobile_job_lease', { p_worker: 'dead', p_ttl_seconds: 1, p_owner: O, p_workspace: W }); assert.equal(dead.data.task_id, C);
await sleep(1300);
const c2 = await runOneJob({ db, scope: { ownerId: O, workspaceId: W }, worker: 'w2', answer: model, ttlSeconds: 30 }); assert.equal(c2.recorded, true); assert.equal(calls, 1);
assert.equal((await db.rpc('mobile_job_start', { p_task: C, p_worker: 'dead', p_epoch: 1 })).data, false);
assert.equal((await db.rpc('mobile_job_finish', { p_task: C, p_worker: 'dead', p_epoch: 1, p_status: 'delivered', p_digest: 'a'.repeat(64), p_summary: 'LATE' })).data, false);
assert.equal(await row(C), 'done|2|done|FICTIONAL result|delivered:1');
// D. REAL SIGKILL after start (inside the model call): never re-leased, never replayed, task needs a human
const D = U(7); await mk(D); calls = 0;
const child = spawn(process.execPath, [new URL(import.meta.url).pathname, 'child', 'victim'], { env: process.env });
await new Promise(r => child.stdout.on('data', d => String(d).includes('IN_MODEL') && r())); child.kill('SIGKILL'); await sleep(1400);
const d2 = await runOneJob({ db, scope: { ownerId: O, workspaceId: W }, worker: 'w3', answer: model, ttlSeconds: 30 });
assert.equal(d2.ran, false); assert.equal(calls, 0); assert.equal(await row(D), 'uncertain|1|blocked|-|uncertain:1');
// E. late result from a worker whose lease expired (it was merely slow, not dead) is rejected and writes nothing
const E = U(8); await mk(E);
const lease = (await db.rpc('mobile_job_lease', { p_worker: 'slow', p_ttl_seconds: 1, p_owner: O, p_workspace: W })).data; assert.equal(lease.task_id, E);
assert.equal((await db.rpc('mobile_job_start', { p_task: E, p_worker: 'slow', p_epoch: lease.epoch })).data, true); await sleep(1300);
assert.equal((await db.rpc('mobile_job_heartbeat', { p_task: E, p_worker: 'slow', p_epoch: lease.epoch, p_ttl_seconds: 30 })).data, false);
assert.equal((await db.rpc('mobile_job_finish', { p_task: E, p_worker: 'slow', p_epoch: lease.epoch, p_status: 'delivered', p_digest: 'b'.repeat(64), p_summary: 'LATE' })).data, false);
await db.rpc('mobile_job_lease', { p_worker: 'reaper', p_ttl_seconds: 5, p_owner: O, p_workspace: W });
assert.equal(await row(E), 'uncertain|1|blocked|-|uncertain:1');
// F. wrong worker / wrong epoch cannot finish a live job
const F = U(9); await mk(F); const lf = (await db.rpc('mobile_job_lease', { p_worker: 'owner-w', p_ttl_seconds: 30, p_owner: O, p_workspace: W })).data; await db.rpc('mobile_job_start', { p_task: F, p_worker: 'owner-w', p_epoch: lf.epoch });
for (const bad of [{ p_worker: 'other', p_epoch: lf.epoch }, { p_worker: 'owner-w', p_epoch: lf.epoch + 1 }]) assert.equal((await db.rpc('mobile_job_finish', { p_task: F, ...bad, p_status: 'delivered', p_digest: 'c'.repeat(64) })).data, false);
console.log(JSON.stringify({ realPostgres: true, normalRun: 'done', concurrentLeases6: 'one winner, one model call', deadBeforeStart: 'resumed once, dead worker fenced', sigkillAfterStart: 'uncertain/blocked, 0 replays', expiredLateResult: 'rejected, nothing written', wrongWorkerOrEpoch: 'rejected', modelIsFictional: true, deployed: false }));
