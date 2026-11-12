// REAL: Next route + mobileBackend + conversation service + task ledger rpc + local Postgres (0012-0015 + draft 0023).
// FICTIONAL: tiny graph/manifest, owner, device, model server (local SSE stub; no model, no cost).
// Scenario: the phone client disconnects mid-turn; the server finishes; the retry with the same request id gets the
// recorded reply with no second model call, and the ledger shows one task closed by the server's own completion.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { dockMobileClient } from '../../node/dock-node/src/mobile/acp.mjs';
const dir = mkdtempSync('/tmp/dock-fict-');
writeFileSync(dir + '/manifest.json', JSON.stringify({ repositories: [{ key: 'dock', commit: '1', currentCommit: '1', coverage: 'code' }] }));
writeFileSync(dir + '/graph.json', JSON.stringify({ nodes: [{ id: 'a', repoKey: 'dock', commit: '1', path: 'README.md', line: 1, text: 'fictional readme for a fictional project' }], edges: [] }));
let modelCalls = 0;
const ai = http.createServer(async (q, s) => { let t = ''; for await (const c of q) t += c; modelCalls++; await new Promise(r => setTimeout(r, 4000)); s.setHeader('content-type', 'text/event-stream');
    s.write('data: ' + JSON.stringify({ id: 'f', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: 'FICTIONAL_REPLY: done.' }, finish_reason: null }] }) + '\n\n');
    s.write('data: ' + JSON.stringify({ id: 'f', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n'); s.end('data: [DONE]\n\n'); });
await new Promise(r => ai.listen(8788, '127.0.0.1', r));
let log = ''; const pg = spawn('python3', ['scripts/proofs/postgres-http-fixture.py']); pg.stdout.on('data', x => log += x); pg.stderr.on('data', x => log += x);
const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:4597', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fictional', SUPABASE_SERVICE_ROLE_KEY: 'fictional', DOCK_OWNER_EMAIL: 'demo@example.com', DOCK_MOBILE_ENABLED: 'true', DOCK_MOBILE_INFERENCE_GATEWAY_BOUNDED: 'true', DOCK_MOBILE_TASK_LEDGER: 'true', DOCK_KNOWLEDGE_MANIFEST: dir + '/manifest.json', DOCK_KNOWLEDGE_GRAPH: dir + '/graph.json', AGENT_MODEL_CHIEF: 'shipyard/fixture', SHIPYARD_INFERENCE_URL: 'http://127.0.0.1:8788/v1', SHIPYARD_INFERENCE_API_KEY: 'fictional', EMBEDDINGS_BASE_URL: '', EMBEDDINGS_API_KEY: '' };
const next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', '3106'], { env }); let nlog = ''; next.stdout.on('data', x => nlog += x); next.stderr.on('data', x => nlog += x);
const rest = path => fetch('http://127.0.0.1:4597/rest/v1/' + path).then(r => r.json());
try {
    for (let i = 0; i < 200 && !log.includes('POSTGRES_HTTP_READY'); i++) await new Promise(r => setTimeout(r, 300));
    const c = dockMobileClient({ url: 'http://127.0.0.1:3106', token: 'dockdev.66666666-6666-4666-8666-666666666666.fictional-device-secret' });
    let session; for (let i = 0; i < 100; i++) { try { session = await c.open({ requestId: crypto.randomUUID() }); break; } catch { await new Promise(r => setTimeout(r, 1000)); } }
    assert.ok(session?.sessionId, 'session ' + nlog.slice(-500));
    const req = { sessionId: session.sessionId, requestId: crypto.randomUUID(), text: 'FICTIONAL: summarize the fictional readme' };
    await assert.rejects(c.turn({ ...req, signal: AbortSignal.timeout(1500) }));       // phone drops mid-turn
    await new Promise(r => setTimeout(r, 7000));                                         // server finishes without the client
    const during = await rest('mobile_tasks?id=eq.' + req.requestId);
    let status = 0; try { await c.turn(req); } catch (e) { status = /409/.test(e.message) ? 409 : e.message; }
    const [t] = during, [h] = await rest('mobile_task_handoffs?task_id=eq.' + req.requestId);
    assert.equal(status, 409, 'same-id retry must be refused, not replayed'); assert.equal(modelCalls, 1, 'no second model call');
    assert.equal(t.state, 'failed'); assert.equal(h.attempts, 1);
    console.log(JSON.stringify({ realNextTurnPath: true, realLocalPostgresLedger: true, clientDisconnectMidTurn: true, taskState: t.state, handoffAttempts: h.attempts, handoffStatus: h.status, sameIdRetry: 'refused 409', modelCalls, stubbed: ['model (local SSE)', 'Supabase service', 'Agent37', 'T3 pixels'], deployed: false }));
} catch (e) { console.error('FAIL', e.message, '\nNEXT:', nlog.slice(-1500), '\nPG:', log.slice(-400)); process.exitCode = 1; }
finally { next.kill(); pg.kill(); ai.close(); }
