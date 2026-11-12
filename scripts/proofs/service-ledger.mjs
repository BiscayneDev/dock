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
let errs = 0, mode = 'ok';
const svc = tasks => mobileConversationService({ store, tasks, onTaskError: () => errs++, context: async () => ({ version: 'v', nodes: [], memory: [] }), recordTurn: async () => { }, answer: async () => { if (mode === 'fail') throw Error('model failed'); return 'fictional reply'; } });
const state = id => psql(`select state||':'||jsonb_array_length(evidence) from mobile_tasks where id='${id}'`), hand = id => psql(`select status||':'||attempts||':'||length(coalesce(reply_digest,'')) from mobile_task_handoffs where task_id='${id}'`);
const R1 = U(8), R2 = U(9), R3 = U('a');
const s = svc(taskLedger({ db, principal }));
await s.turn(principal, { sessionId: S, requestId: R1, text: 'fictional job' });
assert.equal(state(R1), 'done:1'); assert.equal(hand(R1), 'delivered:1:64');
mode = 'fail'; await assert.rejects(s.turn(principal, { sessionId: S, requestId: R2, text: 'fictional failing job' }));
assert.equal(state(R2), 'failed:0');
// ledger down must never change the turn outcome
mode = 'ok'; const broken = svc({ open: async () => { throw Error('ledger down'); }, transition: async () => { throw Error('x'); }, claimAttempt: async () => { throw Error('x'); }, finish: async () => { throw Error('x'); } });
assert.equal((await broken.turn(principal, { sessionId: S, requestId: R3, text: 'fictional job 3' })).text, 'fictional reply'); assert.ok(errs >= 1);
// default off: no tasks adapter, no ledger rows
await svc(undefined).turn(principal, { sessionId: S, requestId: U('b'), text: 'fictional job 4' }); assert.equal(psql(`select count(*) from mobile_tasks`), '2');
console.log(JSON.stringify({ realService: true, realLocalPostgresLedger: true, completedTurn: 'done with server digest', failedTurn: 'failed', ledgerOutageDoesNotAffectTurn: true, defaultOffWritesNothing: true, stubbed: ['inference', 'turn store', 'Next route', 'Supabase'], deployed: false }));
