// REAL: mobileConversationService + task ledger rpc adapter + local Postgres 0023 functions.
// STUB: turn store, context, answer (no inference), Next route, Supabase.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mobileConversationService } from '../../node/dock-node/src/mobile/service.mjs';
import { taskLedger } from '../../node/dock-node/src/mobile/receipt-issuer.mjs';
const URI = process.env.PGURI, PSQL = '/usr/lib/postgresql/14/bin/psql';
const lit = v => v === null || v === undefined ? 'null' : typeof v === 'boolean' ? String(v) : Array.isArray(v) ? `'${JSON.stringify(v)}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`;
const psql = q => { const r = spawnSync(PSQL, [URI, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }); if (r.status) throw Error(r.stderr); return r.stdout.trim(); };
const db = { rpc: async (fn, a) => { try { const out = psql(`select ${fn}(${Object.entries(a).map(([k, v]) => `${k} := ${lit(v)}`).join(',')})`); return { data: out === 't' ? true : out === 'f' ? false : out }; } catch (e) { return { error: { message: e.message } }; } } };
const U = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;
const principal = { ownerId: U(1), workspaceId: U(2), deviceId: U(6) }, S = U(3);
const sess = { id: S, deviceId: principal.deviceId, ownerId: principal.ownerId, workspaceId: principal.workspaceId, conversationId: U(7), projectId: null, repoKeys: [], agentId: 'chief' };
const receipts = new Map();
const store = { session: async () => sess, messages: async () => [], claim: async (s, r) => receipts.has(r) ? receipts.get(r) : (receipts.set(r, { status: 'claimed' }), { status: 'claimed' }), complete: async (s, r, f, x) => receipts.set(r, { status: 'complete', result: x.reply }), fail: async () => { } };
let errs = 0, mode = 'ok', calls = 0;
const svc = tasks => mobileConversationService({ store, tasks, onTaskError: () => errs++, context: async () => ({ version: 'v', nodes: [], memory: [] }), recordTurn: async () => { }, answer: async () => { calls++; if (mode === 'fail') throw Error('model failed'); return 'fictional reply'; } });
const state = id => psql(`select state||':'||jsonb_array_length(evidence) from mobile_tasks where id='${id}'`), hand = id => psql(`select status||':'||attempts||':'||length(coalesce(reply_digest,'')) from mobile_task_handoffs where task_id='${id}'`);
const R1 = U(8), R2 = U(9), R3 = U('a');
const s = svc(taskLedger({ db, principal }));
await s.turn(principal, { sessionId: S, requestId: R1, text: 'fictional job' });
assert.equal(state(R1), 'done:1'); assert.equal(hand(R1), 'delivered:1:64');
mode = 'fail'; await assert.rejects(s.turn(principal, { sessionId: S, requestId: R2, text: 'fictional failing job' }));
assert.equal(state(R2), 'failed:0');
// ledger down at the authoritative claim: fail closed, ZERO model calls
mode = 'ok'; calls = 0;
const down = svc({ open: async () => { throw Error('ledger down'); }, transition: async () => { }, claimAttempt: async () => true, finish: async () => { } });
await assert.rejects(down.turn(principal, { sessionId: S, requestId: R3, text: 'fictional job 3' }), /nothing was sent to the model/); assert.equal(calls, 0);
const noclaim = svc({ open: async () => 'ok', transition: async () => true, claimAttempt: async () => false, finish: async () => { } });
await assert.rejects(noclaim.turn(principal, { sessionId: S, requestId: U('c'), text: 'x' })); assert.equal(calls, 0);
// display-only failures after the claim do not cancel the turn
const disp = svc({ open: async () => 'ok', transition: async () => { throw Error('display down'); }, claimAttempt: async () => true, finish: async () => { throw Error('display down'); } });
assert.equal((await disp.turn(principal, { sessionId: S, requestId: U('d'), text: 'x' })).text, 'fictional reply'); assert.equal(calls, 1); calls = 0;
// worst case: the turn store fails to dedupe, 5 concurrent same-request turns. The ledger claim alone must allow one model call.
const leaky = { ...store, claim: async () => ({ status: 'claimed' }) };
const R5 = U('e'); const conc = mobileConversationService({ store: leaky, tasks: taskLedger({ db, principal }), onTaskError: () => { }, context: async () => ({ version: 'v', nodes: [], memory: [] }), recordTurn: async () => { }, answer: async () => { calls++; await new Promise(r => setTimeout(r, 100)); return 'fictional reply'; } });
const res = await Promise.allSettled(Array.from({ length: 5 }, () => conc.turn(principal, { sessionId: S, requestId: R5, text: 'fictional concurrent' })));
assert.equal(res.filter(x => x.status === 'fulfilled').length, 1); assert.equal(calls, 1); assert.equal(hand(R5).split(':')[1], '1');
// client abort does not cancel the model call in ledger mode
let seenSignal = 'unset'; const ab = new AbortController(); const ds = mobileConversationService({ store, tasks: taskLedger({ db, principal }), onTaskError: () => { }, context: async () => ({ version: 'v', nodes: [], memory: [] }), recordTurn: async () => { }, answer: async ({ signal }) => { seenSignal = signal; return 'fictional reply'; } });
await ds.turn(principal, { sessionId: S, requestId: U('f'), text: 'x' }, ab.signal); assert.equal(seenSignal, undefined);
// default off: no tasks adapter, no ledger rows
await svc(undefined).turn(principal, { sessionId: S, requestId: U('b'), text: 'fictional job 4' }); assert.equal(psql(`select count(*) from mobile_tasks where id='${U('b')}'`), '0');
console.log(JSON.stringify({ realService: true, realLocalPostgresLedger: true, completedTurn: 'done with server digest', failedTurn: 'failed', claimOutageFailsClosedBeforeModel: true, concurrentSameRequestModelCalls: 1, displayOutageDoesNotCancel: true, abortDoesNotCancelInLedgerMode: true, defaultOffWritesNothing: true, stubbed: ['inference', 'turn store', 'Next route', 'Supabase'], deployed: false }));
