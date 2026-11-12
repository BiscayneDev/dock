// REAL: conversation service in queue mode + task ledger adapter + lease-fenced runner + Postgres 0023/0024.
// STUB: turn store (in-memory), no model at all. FICTIONAL data. Not deployed.
import assert from 'node:assert/strict';
import { mobileConversationService } from '../../node/dock-node/src/mobile/service.mjs';
import { taskLedger } from '../../node/dock-node/src/mobile/receipt-issuer.mjs';
import { runOneJob, workerState } from '../../node/dock-node/src/mobile/job-runner.mjs';
import { db } from './job-queue-db.mjs';
const U = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;
const P = { ownerId: U(1), workspaceId: U(2), deviceId: U(6) }, S = U(3), S2 = U(9);
const sess = id => ({ id, deviceId: P.deviceId, ownerId: P.ownerId, workspaceId: P.workspaceId, conversationId: U(7), projectId: null, repoKeys: ['fictional-repo'], agentId: 'chief' });
const receipts = new Map();
const store = { session: async id => sess(id), messages: async () => [], claim: async (s, r) => receipts.has(r) ? receipts.get(r) : (receipts.set(r, { status: 'claimed' }), { status: 'claimed' }), complete: async (s, r, f, x) => receipts.set(r, { status: 'complete', result: x.reply }), fail: async () => { } };
const ledger = taskLedger({ db, principal: P });
const svc = mobileConversationService({ store, tasks: ledger, queue: true, onTaskError: () => { }, context: async () => ({}), recordTurn: async () => { }, answer: async () => { throw Error('no model may run in queue mode'); } });
const turn = (id, text, sid = S) => svc.turn(P, { sessionId: sid, requestId: id, text });
const T = [U(4), U(5), U(6), U('a')];
assert.ok(await workerState(ledger).then(r => r.state === 'configured_untested'), 'no worker has ever checked in');
for (const [i, id] of T.slice(0, 3).entries()) assert.equal((await turn(id, 'FICTIONAL job ' + (i + 1))).taskStatus, undefined); // first answer is the ack
assert.match((await turn(T[1], 'FICTIONAL job 2')).text, /No worker has picked it up/);
const delay = { 1: 600, 2: 100, 3: 300 }; let ran = [];
const agent = async ({ input, context }) => { assert.equal(context.beaconScope.sharedWrites, 'owner-promotion-only'); assert.equal(context.repoKeys[0], 'fictional-repo'); const n = +input.slice(-1); await new Promise(r => setTimeout(r, delay[n])); ran.push(n); return { text: 'Result for job ' + n, evidence: ['Evidence for job ' + n] }; };
const runs = await Promise.all(['wa', 'wb', 'wc'].map(w => runOneJob({ db, worker: w, answer: agent, ttlSeconds: 30 }))); assert.ok(runs.every(r => r.recorded));
assert.equal(ran.length, 3); assert.notDeepEqual(ran, [1, 2, 3], 'jobs finished out of lease order');
for (const [i, id] of T.slice(0, 3).entries()) { const v = await turn(id, 'FICTIONAL job ' + (i + 1)); assert.equal(v.taskStatus, 'done'); assert.equal(v.text, 'Result for job ' + (i + 1)); assert.deepEqual(v.evidence, ['Evidence for job ' + (i + 1)]); }
// a newer turn is not overwritten by older completions; repeated delivery is a pure read
await turn(T[3], 'FICTIONAL job 4'); const snap = () => db.sql(`select string_agg(task_id||state||epoch||updated_at::text,',' order by task_id) from mobile_task_jobs`);
const before = await snap(); for (let i = 0; i < 3; i++) assert.equal((await turn(T[0], 'FICTIONAL job 1')).text, 'Result for job 1'); assert.equal(await snap(), before);
assert.match((await turn(T[3], 'FICTIONAL job 4')).text, /No worker has picked it up/);
// boundaries: other session or other owner sees nothing
assert.equal(await ledger.jobStatus(T[0], S2), null);
assert.equal(await taskLedger({ db, principal: { ...P, ownerId: U(8) } }).jobStatus(T[0], S), null);
// context persisted on the job row; worker liveness
assert.match(await db.sql(`select context::text from mobile_task_jobs where task_id='${T[0]}'`), /owner-promotion-only/);
assert.equal((await workerState(ledger)).state, 'reachable');
assert.equal((await workerState(ledger, Date.now() + 10 * 60_000)).state, 'stale');
console.log(JSON.stringify({ realService: true, realPostgres: true, noModelRan: true, outOfOrderCompletion: ran, eachResultOwnTask: true, repeatedDeliveryIsPureRead: true, newerTurnNotOverwritten: true, otherSessionOrOwnerSeesNothing: true, contextPersistedOnJob: true, workerLiveness: 'reachable then stale', deployed: false }));
