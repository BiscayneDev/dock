// REAL: Next route (actual app code) -> mobileBackend device auth + grant check -> mobileStore -> real local Postgres
// (via the PostgREST-shaped local fixture) -> Ed25519 signing -> task-dock verification with the public key.
// FICTIONAL: keys, devices, owners, reply text. NOT exercised: Supabase itself, production keys, Agent37, T3 pixels.
import { spawn } from 'node:child_process';
import { generateKeyPairSync, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { dockMobileClient } from '../../node/dock-node/src/mobile/acp.mjs';
import { taskBackedDock } from '../../node/dock-node/src/mobile/task-dock.mjs';
const keys = generateKeyPairSync('ed25519'), rogue = generateKeyPairSync('ed25519');
const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
let log = ''; const pg = spawn('python3', ['scripts/proofs/postgres-http-fixture.py']); pg.stdout.on('data', x => log += x); pg.stderr.on('data', x => log += x);
const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:4597', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fictional', SUPABASE_SERVICE_ROLE_KEY: 'fictional', DOCK_OWNER_EMAIL: 'demo@example.com', DOCK_MOBILE_ENABLED: 'true', DOCK_MOBILE_INFERENCE_GATEWAY_BOUNDED: 'true', AGENT_MODEL_CHIEF: 'shipyard/fixture', EMBEDDINGS_BASE_URL: '', EMBEDDINGS_API_KEY: '' };
const start = (extra, port) => { const n = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], { env: { ...env, ...extra } }); let out = ''; n.stdout.on('data', x => out += x); n.stderr.on('data', x => out += x); return { n, out: () => out }; };
const post = (path, body) => fetch('http://127.0.0.1:4597' + path, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
const tok = 'dockdev.66666666-6666-4666-8666-666666666666.fictional-device-secret', tok2 = 'dockdev.88888888-8888-4888-8888-888888888888.other-secret';
let app = start({ MOBILE_RECEIPT_SIGNING_KEY: pem }, 3103);
const kill = () => { app.n.kill(); pg.kill(); };
try {
    for (let i = 0; i < 200; i++) { if (log.includes('POSTGRES_HTTP_READY')) break; await new Promise(r => setTimeout(r, 300)); }
    assert.ok(log.includes('POSTGRES_HTTP_READY'), 'fixture ready');
    await post('/fixture/second-device', {});
    const c = dockMobileClient({ url: 'http://127.0.0.1:3103', token: tok }), other = dockMobileClient({ url: 'http://127.0.0.1:3103', token: tok2 });
    let session; for (let i = 0; i < 100; i++) { try { session = await c.open({ requestId: crypto.randomUUID() }); break; } catch { await new Promise(r => setTimeout(r, 1000)); } }
    assert.ok(session?.sessionId, 'real Next route answered real session open: ' + app.out().slice(-600));
    const sid = session.sessionId, rid = crypto.randomUUID(), pending = crypto.randomUUID();
    // not complete yet: the route must not sign
    const before = await c.receipt({ sessionId: sid, requestId: rid }); assert.equal(before.sig, undefined); assert.equal(before.status, 'unknown');
    await post('/fixture/complete-turn', { sessionId: sid, requestId: rid, fingerprint: 'fp1' });
    const rec = await c.receipt({ sessionId: sid, requestId: rid });
    assert.equal(rec.status, 'complete'); assert.equal(rec.replyDigest, createHash('sha256').update('fictional reply text').digest('hex')); assert.ok(rec.sig);
    // route owner scoping, actually exercised: another owner's real device, a bad token, and a route with no signing key
    await assert.rejects(other.receipt({ sessionId: sid, requestId: rid }), /refused \(403\)/);
    await assert.rejects(dockMobileClient({ url: 'http://127.0.0.1:3103', token: 'dockdev.66666666-6666-4666-8666-666666666666.wrong' }).receipt({ sessionId: sid, requestId: rid }), /refused/);
    // task-dock closes only on that real receipt, verified with the public key
    const mk = (pub) => taskBackedDock({ ownerId: '44444444-4444-4444-8444-444444444444', workspaceId: '33333333-3333-4333-8333-333333333333', receiptKey: pub, dock: { turn: async () => { throw Error('disconnect'); } }, status: q => c.receipt(q) });
    const good = mk(keys.publicKey); await assert.rejects(good.turn({ sessionId: sid, requestId: rid, text: 'x' }));
    assert.match((await good.turn({ sessionId: sid, requestId: rid, text: 'x' })).text, /already completed/); assert.equal(good.board.get(rid).state, 'done');
    const wrong = mk(rogue.publicKey); await assert.rejects(wrong.turn({ sessionId: sid, requestId: rid, text: 'x' })); await assert.rejects(wrong.turn({ sessionId: sid, requestId: rid, text: 'x' }), /uncertain/);
    // execution receipt: pending until the controller function records a result bound to instance+run
    const { executionId } = await post('/fixture/prepare-execution', { sessionId: sid, threadId: 'fictional-thread', runId: 'fictional-run' });
    assert.equal((await c.executionReceipt(executionId)).status, 'pending');
    await assert.rejects(other.executionReceipt(executionId), /refused \(403\)/); // other owner's device: no receipt at all
    await post('/fixture/execution-result', { executionId });
    const er = await c.executionReceipt(executionId);
    assert.equal(er.status, 'complete'); assert.equal(er.executionId, executionId); assert.ok(er.instanceId && er.runId);
    assert.equal(er.replyDigest, createHash('sha256').update('fictional worker output').digest('hex'));
    const { verifyReceipt } = await import('../../node/dock-node/src/mobile/receipt.mjs');
    const scope = { ownerId: '44444444-4444-4444-8444-444444444444', workspaceId: '33333333-3333-4333-8333-333333333333', sessionId: sid, requestId: executionId, executionId };
    assert.ok(verifyReceipt(keys.publicKey, er, scope)); assert.equal(verifyReceipt(keys.publicKey, { ...er, runId: 'other-run' }, scope), null); assert.equal(verifyReceipt(keys.publicKey, er, { ...scope, executionId: crypto.randomUUID() }), null);
    // phase 2: same app without a signing key must refuse to sign
    app.n.kill(); await new Promise(r => setTimeout(r, 3000)); app = start({}, 3103);
    const offc = dockMobileClient({ url: 'http://127.0.0.1:3103', token: tok }); let refused = false;
    for (let i = 0; i < 100 && !refused; i++) { try { await offc.receipt({ sessionId: sid, requestId: rid }); break; } catch (e) { refused = /refused \(403\)/.test(e.message); if (!refused) await new Promise(r => setTimeout(r, 1000)); } }
    assert.ok(refused, 'no signing key must mean 403');
    console.log(JSON.stringify({ realNextRoute: true, realLocalPostgres: true, notSignedBeforeComplete: true, ownerScopingExercised: { otherOwnerDevice: 403, wrongSecret: 'refused', noSigningKeyConfigured: 403 }, closedOnlyByVerifiedReceipt: true, executionReceiptBoundToInstanceRun: true, executionPendingUntilControllerRecords: true, otherOwnerExecution: 403, wrongPublicKeyRejected: true, stubbed: ['Supabase service', 'Agent37', 'T3 pixels'], productionKeys: false, deployed: false }));
} catch (e) { console.error('FAIL', e.message, '\nNEXT:', app.out().slice(-1500), '\nPG:', log.slice(-500)); process.exitCode = 1; }
finally { kill(); }
