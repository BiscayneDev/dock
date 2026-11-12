// REAL: Postgres queue (draft 0023+0024), supervisor loop in real child processes, real SIGTERM and SIGKILL.
// FICTIONAL: tasks and the answer function (a local function; no model, no cost). Local only, not a hosted service.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { superviseWorker, assertWorkerConfig, restartPolicy } from '../../node/dock-node/src/mobile/supervisor.mjs';
import { db, psql } from './job-queue-db.mjs';
const U = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`, O = U(1), W = U(2), S = U(3), sleep = ms => new Promise(r => setTimeout(r, ms));
if (process.argv[2] === 'child') {
    const mode = process.argv[3], ac = new AbortController(); process.on('SIGTERM', () => { console.log('SIGTERM'); ac.abort(); });
    const answer = async ({ input }) => { if (mode === 'hang-on-poison' && input.includes('POISON')) { console.log('IN_JOB'); return new Promise(() => { }); } console.log('JOB ' + input); await sleep(mode === 'slow' ? 1200 : 10); return 'FICTIONAL result ' + input; };
    const r = await superviseWorker({ db, worker: process.argv[4], answer, pollMs: 100, ttlSeconds: 2, signal: ac.signal, enforcement: 'local-rlimit-only', allowWeakLocal: true }); console.log('EXIT ' + JSON.stringify(r)); process.exit(0);
}
const mk = async (id, input) => { await psql(`select mobile_task_open('${id}','${O}','${W}','${S}','chief','none','FICTIONAL job')`); assert.equal((await db.rpc('mobile_job_enqueue', { p_task: id, p_owner: O, p_input: input })).data !== undefined, true); };
const state = id => psql(`select j.state||'|'||t.state from mobile_task_jobs j join mobile_tasks t on t.id=j.task_id where j.task_id='${id}'`);
const start = (mode, name) => { const c = spawn(process.execPath, [new URL(import.meta.url).pathname, 'child', mode, name], { env: process.env }); c.out = ''; c.stdout.on('data', d => c.out += d); return c; };
const until = async (f, ms = 15000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await sleep(100); } return false; };
// config gate
assert.throws(() => assertWorkerConfig({ enforcement: 'local-rlimit-only' }), /allowWeakLocal/); assert.throws(() => assertWorkerConfig({ enforcement: 'local-rlimit-only', allowWeakLocal: true, env: { NODE_ENV: 'production' } }), /production/); assert.throws(() => assertWorkerConfig({ enforcement: 'x' })); assert.equal(assertWorkerConfig({}), 'aggregate-required');
await assert.rejects(superviseWorker({ db, worker: 'x', answer: () => 'x', enforcement: 'local-rlimit-only' }), /allowWeakLocal/);
// A. a supervised worker drains the queue, then a graceful SIGTERM mid-job finishes the job in hand before exit
const A = [U(4), U(5), U(6)]; for (const [i, id] of A.entries()) await mk(id, 'a' + i);
const w1 = start('slow', 'sup1'); assert.ok(await until(async () => (await Promise.all(A.map(state))).filter(s => s === 'done|done').length >= 1));
const inFlight = await until(async () => (await Promise.all(A.map(state))).some(s => s.startsWith('running') || s.startsWith('started')), 5000); w1.kill('SIGTERM');
await new Promise(r => w1.on('exit', r)); assert.match(w1.out, /EXIT \{"stopped":true/); const sA = await Promise.all(A.map(state)); assert.ok(!sA.some(s => /^(leased|started|running)/.test(s)), 'graceful stop left a job in flight: ' + sA);
// B. crash: a started job is lost by SIGKILL. A restarted worker finishes the OTHER queued job and never re-runs the lost one.
const P = U(7), Q = U(8); await mk(P, 'POISON'); await mk(Q, 'after');
const w2 = start('hang-on-poison', 'sup2'); await until(() => w2.out.includes('IN_JOB')); w2.kill('SIGKILL'); await new Promise(r => w2.on('exit', r));
const rp = restartPolicy({ maxRestarts: 2 }); assert.equal(rp.allow(), true); const w3 = start('hang-on-poison', 'sup3');
assert.ok(await until(async () => (await state(Q)).endsWith('done'))); assert.ok(await until(async () => (await state(P)).startsWith('uncertain'), 8000), 'poison state ' + await state(P));
assert.ok(!w3.out.includes('JOB POISON') && !w3.out.includes('IN_JOB'), 'lost job was replayed'); assert.equal((await state(P)), 'uncertain|blocked');
w3.kill('SIGTERM'); await new Promise(r => w3.on('exit', r)); assert.equal(rp.allow(), true); assert.equal(rp.allow(), false);
console.log(JSON.stringify({ realPostgres: true, supervisedWorkerDrainedQueue: true, gracefulSigtermFinishedJobInHand: true, sigkillMidJob: 'uncertain/blocked, never replayed by the restarted worker', restartedWorkerFinishedOtherWork: true, weakLocalModeNeedsTrustedStarterAndRefusedInProduction: true, restartsBounded: true, hosted: false }));
