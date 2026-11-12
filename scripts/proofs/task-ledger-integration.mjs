// Run by task-ledger-integration.py against a real LOCAL Postgres with the DRAFT 0023 migration.
// Real: Postgres ledger + migration functions, Ed25519 signing, ACP bridge, task-dock, process-fresh restart.
// Stub: Dock turn transport and the owner-scoped turn store (no Supabase, no Next server, no Agent37).
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import assert from 'node:assert/strict';
import { createDockAcp } from '../../node/dock-node/src/mobile/acp.mjs';
import { taskBackedDock } from '../../node/dock-node/src/mobile/task-dock.mjs';
import { issueTurnReceipt, taskLedger } from '../../node/dock-node/src/mobile/receipt-issuer.mjs';
const URI = process.env.PGURI, PSQL = '/usr/lib/postgresql/14/bin/psql';
const lit = v => v === null || v === undefined ? 'null' : typeof v === 'boolean' ? String(v) : Array.isArray(v) ? `'${JSON.stringify(v)}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`;
const psql = q => { const r = spawnSync(PSQL, [URI, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }); if (r.status) throw Error(r.stderr); return r.stdout.trim(); };
const db = { rpc: async (fn, a) => { try { const out = psql(`select ${fn}(${Object.entries(a).map(([k, v]) => `${k} := ${lit(v)}`).join(',')})`); return { data: out === 't' ? true : out === 'f' ? false : out }; } catch (e) { return { error: { message: e.message } }; } } };
const U = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;
const owner = U(1), ws = U(2), session = U(3), request = U(4), other = U(5);
const principal = { ownerId: owner, workspaceId: ws }, keys = generateKeyPairSync('ed25519'), rogue = generateKeyPairSync('ed25519');
const turns = new Map(); // stub owner-scoped turn store
const store = { turnStatus: async (sid, rid) => { if (sid !== session) throw Error('Session not owned'); return turns.get(rid) ?? null; } };
let sends = 0;
const mk = (transport) => taskBackedDock({ ...principal, receiptKey: keys.publicKey, ledger: taskLedger({ db, principal }), agentId: 'dock',
    dock: { open: async () => ({ sessionId: session }), turn: transport },
    status: ({ sessionId, requestId }) => issueTurnReceipt({ principal, sessionId, requestId, store, privateKey: keys.privateKey }) });
const state = () => psql(`select state from mobile_tasks where id='${request}'`), handoff = () => psql(`select status||':'||attempts||':'||coalesce(reply_digest,'') from mobile_task_handoffs where task_id='${request}'`);
const prompt = (acp, requestId, text) => acp.handle({ method: 'session/prompt', params: { sessionId: session, prompt: [{ type: 'text', text }] } });
// Seed the parent session row requirement is not modelled by the draft ledger; sessions are uuid-only here.
// 1) first process: the transport drops after the turn was claimed
const d1 = mk(async () => { sends++; throw Error('disconnect'); });
await assert.rejects(d1.turn({ sessionId: session, requestId: request, text: 'fictional job' }));
assert.equal(sends, 1); assert.equal(state(), 'blocked'); assert.equal(handoff(), 'uncertain:1:');
// 2) "restart": fresh bridge, empty in-memory board, same Postgres. Must not send again.
const d2 = mk(async () => { sends++; return { text: 'must not happen' }; });
await assert.rejects(d2.turn({ sessionId: session, requestId: request, text: 'fictional job' }), /uncertain/);
assert.equal(sends, 1);
// 3) a forged completion (signed by a different key) and a receipt for another owner never close it
const forged = mk(async () => { sends++; });
forged.turn; // eslint
const dBad = taskBackedDock({ ...principal, receiptKey: keys.publicKey, ledger: taskLedger({ db, principal }), dock: { turn: async () => { sends++; } }, status: ({ sessionId, requestId }) => issueTurnReceipt({ principal, sessionId, requestId, store, privateKey: rogue.privateKey }) });
turns.set(request, { status: 'complete', reply: { text: 'fictional reply' } });
await assert.rejects(dBad.turn({ sessionId: session, requestId: request, text: 'fictional job' }), /uncertain/);
assert.equal(state(), 'blocked'); assert.equal(sends, 1);
// another owner cannot touch this task through the ledger
const intruder = taskLedger({ db, principal: { ownerId: other, workspaceId: ws } });
assert.equal(await intruder.claimAttempt(request, 'turn'), false); assert.equal(await intruder.transition(request, 'done', 'agent', ['x']), false);
// 4) backend turn completes; recovery after restart closes it by signed receipt, still zero extra sends
const d3 = mk(async () => { sends++; return { text: 'must not happen' }; });
let r; try { r = await d3.turn({ sessionId: session, requestId: request, text: 'fictional job' }); } catch (e) { console.error('DBG', state(), handoff(), e.message); throw e; }
assert.match(r.text, /already completed/); assert.equal(sends, 1);
assert.equal(state(), 'done'); assert.match(handoff(), /^delivered:1:[a-f0-9]{64}$/);
// 5) a repeat after completion is still not a second send
await d3.turn({ sessionId: session, requestId: request, text: 'fictional job' }); assert.equal(sends, 1);
console.log(JSON.stringify({ realLocalPostgresLedger: true, signedReceiptClosure: true, restartDidNotResend: true, forgedReceiptRejected: true, otherOwnerRefused: true, totalSends: sends, stubbed: ['turn transport', 'owner-scoped turn store', 'Supabase', 'Next route', 'Agent37'], migrationDeployed: false }));
