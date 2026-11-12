// REAL: authenticated Next enqueue route -> Postgres queue -> separate worker PROCESSES (one SIGKILLed mid-run) ->
// Next killed and restarted -> owner page. FICTIONAL: data, repo, agent (scripted, no model, no inference server at all).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dockMobileClient } from '../../node/dock-node/src/mobile/acp.mjs';
const pp = createRequire(process.cwd() + '/package.json')('puppeteer-core');
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }), root = mkdtempSync(join(tmpdir(), 'fictional-repo-')), repo = join(root, 'main'), wts = join(root, 'wts'); mkdirSync(repo); mkdirSync(wts); sh(repo, 'init', '-q', '-b', 'main');
writeFileSync(join(repo, 'math.mjs'), 'export const add = (a, b) => a - b;\n'); writeFileSync(join(repo, 'math.test.mjs'), "import test from 'node:test';import assert from 'node:assert/strict';import { add } from './math.mjs';test('add',()=>assert.equal(add(2,3),5));test('add zero',()=>assert.equal(add(0,0),0));\n");
sh(repo, 'add', '-A'); sh(repo, '-c', 'user.name=x', '-c', 'user.email=x@example.invalid', 'commit', '-qm', 'init');
let log = '';
const env = { ...process.env, DOCK_PUBLIC_ORIGIN: 'http://127.0.0.1:3107', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:4597', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fictional', SUPABASE_SERVICE_ROLE_KEY: 'fictional', DOCK_OWNER_EMAIL: 'demo@example.com', DOCK_MOBILE_ENABLED: 'true', DOCK_MOBILE_TASK_LEDGER: 'true', DOCK_MOBILE_TASK_QUEUE: 'true', FIX_REPO: repo, FIX_WTS: wts };
const pg = spawn('python3', ['scripts/proofs/postgres-http-fixture.py'], { env }); pg.stdout.on('data', x => log += x); pg.stderr.on('data', x => log += x);
let next; const startNext = () => { next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', '3107'], { env }); next.stdout.on('data', x => log += x); next.stderr.on('data', x => log += x); };
const rest = p => fetch('http://127.0.0.1:4597/rest/v1/' + p).then(r => r.json());
const OWN = '44444444-4444-4444-8444-444444444444', WSP = '33333333-3333-4333-8333-333333333333', secretOf = n => ('fictional-secret-' + n).padEnd(40, 'x');
const rpc = async (fn, a) => { const r = await fetch('http://127.0.0.1:4597/rest/v1/rpc/' + fn, { method: 'POST', body: JSON.stringify(a) }); const j = await r.json(); return r.ok ? { data: j } : { error: { message: j.message } }; };
const register = n => rpc('mobile_worker_register', { p_worker: n, p_owner: OWN, p_workspace: WSP, p_secret: secretOf(n) });
const worker = async (mode, name) => { assert.equal((await register(name)).data, true); return new Promise(res => { const c = spawn(process.execPath, ['scripts/proofs/queue-worker.mjs', mode, name], { env: { ...env, WORKER_SECRET: secretOf(name) } }); let out = ''; c.stdout.on('data', d => { out += d; if (mode === 'hang' && out.includes('IN_AGENT')) res({ c, out }); if (out.includes('WORKER_DONE')) res({ c, out }); }); c.stderr.on('data', d => log += d); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let browser;
try {
    for (let i = 0; i < 200 && !log.includes('POSTGRES_HTTP_READY'); i++) await sleep(300);
    startNext();
    const c = dockMobileClient({ url: 'http://127.0.0.1:3107', token: 'dockdev.66666666-6666-4666-8666-666666666666.fictional-device-secret' });
    let session; for (let i = 0; i < 100; i++) { try { session = await c.open({ requestId: crypto.randomUUID() }); break; } catch { await sleep(1000); } }
    assert.ok(session?.sessionId, 'session ' + log.slice(-400));
    const T1 = crypto.randomUUID(), T2 = crypto.randomUUID();
    const r1 = await c.turn({ sessionId: session.sessionId, requestId: T1, text: 'FICTIONAL: fix the add function in the demo repo (attempt that gets killed)' });
    assert.equal(r1.queued, true);
    const again = await c.turn({ sessionId: session.sessionId, requestId: T1, text: 'FICTIONAL: fix the add function in the demo repo (attempt that gets killed)' }); assert.equal(again.queued, true); // idempotent
    assert.equal((await rest('mobile_task_jobs?task_id=eq.' + T1)).length, 1);
    // worker A leases and starts, then is SIGKILLed inside the agent
    const A = await worker('hang', 'worker-a'); A.c.kill('SIGKILL'); await sleep(2500);
    const r2 = await c.turn({ sessionId: session.sessionId, requestId: T2, text: 'FICTIONAL: fix the add function in the demo repo' }); assert.equal(r2.queued, true);
    // Next dies before any worker touches T2; a fresh worker process runs it while Next is down
    next.kill('SIGKILL'); await sleep(500);
    const B = await worker('run', 'worker-b'); if (!/recorded/.test(B.out)) console.error('JOBS', JSON.stringify(await rest('mobile_task_jobs')), T1, T2); assert.match(B.out, /"recorded":true/);
    startNext();
    const [t1] = await rest('mobile_tasks?id=eq.' + T1), [t2] = await rest('mobile_tasks?id=eq.' + T2), [j1] = await rest('mobile_task_jobs?task_id=eq.' + T1), [j2] = await rest('mobile_task_jobs?task_id=eq.' + T2);
    assert.equal(j1.state, 'uncertain'); assert.equal(t1.state, 'blocked'); assert.equal(j2.state, 'done'); assert.equal(t2.state, 'done'); assert.match(t2.result_summary, /tests pass/);
    // Result continuation: exactly one conversation message for T2, bound to owner/workspace/session/task/epoch; none for the uncertain T1.
    const [dl] = await rest('mobile_task_deliveries?task_id=eq.' + T2); assert.ok(dl); assert.equal(dl.session_id, session.sessionId); assert.equal(dl.owner_id, '44444444-4444-4444-8444-444444444444'); assert.equal(dl.epoch, 1);
    assert.equal((await rest('mobile_task_deliveries?task_id=eq.' + T1)).length, 0);
    const msgs = (await rest('messages?role=eq.agent')).filter(m => m.meta?.mobileTaskId === T2); assert.equal(msgs.length, 1); assert.equal(msgs[0].id, dl.message_id); assert.match(msgs[0].content, /tests pass/);
    assert.equal((await fetch('http://127.0.0.1:4597/rest/v1/rpc/mobile_job_finish', { method: 'POST', body: JSON.stringify({ p_task: T2, p_worker: 'worker-b', p_secret: secretOf('worker-b'), p_epoch: 1, p_status: 'delivered', p_digest: 'a'.repeat(64), p_summary: 'DUPLICATE' }) }).then(r => r.json())), false);
    assert.equal((await rest('messages?role=eq.agent')).filter(m => m.meta?.mobileTaskId === T2).length, 1, 'repeat finish adds no second message');
    // Concurrent finishes against the real messages table/indexes and transaction path.
    const { runOneJob } = await import('../../node/dock-node/src/mobile/job-runner.mjs');
    const N = 8, ids = Array.from({ length: N }, () => crypto.randomUUID());
    for (const id of ids) assert.equal((await c.turn({ sessionId: session.sessionId, requestId: id, text: 'FICTIONAL concurrent job' })).queued, true);
    const names = ids.map((_, i) => 'cw' + i); for (const n of names) await register(n);
    const done = await Promise.all(names.map(n => runOneJob({ db: { rpc }, worker: n, secret: secretOf(n), ttlSeconds: 60, answer: async ({ taskId }) => { await sleep(300); return { text: 'Concurrent result ' + taskId.slice(0, 8), evidence: ['fictional'] }; } })));
    assert.equal(done.filter(r => r.recorded).length, N);
    const all = (await rest('messages?role=eq.agent')).filter(m => ids.includes(m.meta?.mobileTaskId)); assert.equal(all.length, N); assert.equal(new Set(all.map(m => m.meta.mobileTaskId)).size, N);
    assert.equal(new Set((await rest('mobile_task_deliveries')).filter(d => ids.includes(d.task_id)).map(d => d.message_id)).size, N);
    // one started job, 6 racing finishes with the same fence: exactly one wins, exactly one message
    const R = crypto.randomUUID(); await c.turn({ sessionId: session.sessionId, requestId: R, text: 'FICTIONAL race job' }); await register('racer');
    const lr = (await rpc('mobile_job_lease', { p_worker: 'racer', p_secret: secretOf('racer'), p_ttl_seconds: 60 })).data; assert.equal(lr.task_id, R);
    assert.equal((await rpc('mobile_job_start', { p_task: R, p_worker: 'racer', p_secret: secretOf('racer'), p_epoch: lr.epoch })).data, true);
    const race = await Promise.all(Array.from({ length: 6 }, () => rpc('mobile_job_finish', { p_task: R, p_worker: 'racer', p_secret: secretOf('racer'), p_epoch: lr.epoch, p_status: 'delivered', p_digest: 'e'.repeat(64), p_summary: 'RACE RESULT', p_evidence: '["fictional"]' })));
    assert.equal(race.filter(x => x.data === true).length, 1, JSON.stringify(race)); assert.equal((await rest('messages?role=eq.agent')).filter(m => m.meta?.mobileTaskId === R).length, 1);
    browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'], defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true } });
    const page = await browser.newPage(); const u = '44444444-4444-4444-8444-444444444444', b64 = x => Buffer.from(JSON.stringify(x)).toString('base64url');
    await page.setCookie({ name: 'sb-127-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: u, email: 'demo@example.com', aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.fictional-signature', refresh_token: 'demo', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: u, email: 'demo@example.com' } })).toString('base64url'), domain: '127.0.0.1', path: '/' });
    let text = ''; for (let i = 0; i < 60; i++) { try { await page.goto('http://127.0.0.1:3107/mobile/tasks', { waitUntil: 'domcontentloaded', timeout: 60000 }); text = await page.evaluate(() => document.body.innerText); if (text.includes('Done')) break; } catch { } await sleep(2000); }
    await sleep(1000); text = await page.evaluate(() => document.body.innerText);
    await page.screenshot({ path: '/downloads/dock-queue-390px-top-FICTIONAL-LOCAL.png' });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(500);
    await page.screenshot({ path: '/downloads/dock-queue-390px-bottom-FICTIONAL-LOCAL.png' });
    const m = await page.evaluate(() => { const nav = [...document.querySelectorAll('*')].filter(e => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().bottom >= innerHeight - 2 && e.getBoundingClientRect().height < 200).map(e => e.getBoundingClientRect().top)[0]; const cards = [...document.querySelectorAll('article')]; const last = cards.at(-1).getBoundingClientRect(); return { navTop: nav ?? null, lastBottom: last.bottom, w: [document.documentElement.scrollWidth, innerWidth] }; });
    console.log(text); console.log(JSON.stringify(m));
    // The chat screen the user actually opens (/assistant) must show the delivered worker result from the same conversation.
    const convRow = (await rest('mobile_sessions?id=eq.' + session.sessionId))[0]; const convId = convRow?.conversation_id; console.log('session conversation', convId, (await rest('conversations?id=eq.' + convId)).length);
    let chat = ''; for (let i = 0; i < 12; i++) { try { await page.goto('http://127.0.0.1:3107/assistant?id=' + convId, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(2500); chat = await page.evaluate(() => document.body.innerText); if (chat.includes('Fixed. All 2 tests pass')) break; } catch { } await sleep(1500); }
    await page.screenshot({ path: '/downloads/dock-chat-390px-top-FICTIONAL-LOCAL.png' });
    console.log('CHAT TEXT:', chat.slice(0, 900)); assert.ok(chat.includes('Fixed. All 2 tests pass'), 'chat screen does not show the worker result');
    await page.evaluate(() => { for (const e of [document.scrollingElement, ...document.querySelectorAll('*')]) if (e && e.scrollHeight > e.clientHeight + 40) e.scrollTop = e.scrollHeight; }); await sleep(600);
    await page.screenshot({ path: '/downloads/dock-chat-390px-bottom-FICTIONAL-LOCAL.png' });
    const low = text.toLowerCase(); for (const w of ['worker checked in', 'fixed. all 2 tests pass', 'stopped before reporting back', 'not run again']) assert.ok(low.includes(w), 'missing: ' + w);
    assert.ok(m.w[0] <= m.w[1]); if (m.navTop !== null) assert.ok(m.lastBottom <= m.navTop - 8, JSON.stringify(m));
    console.log(JSON.stringify({ authenticatedNextEnqueue: true, noInferenceServerExists: true, duplicateEnqueueIdempotent: true, workerKilledMidRun: 'uncertain/blocked, not replayed', nextKilledBeforeWorkerRan: true, freshWorkerProcessFinished: true, resultDeliveredOnceToConversation: true, duplicateFinishAddsNothing: true, concurrentFinishes: '8 parallel workers: 8 messages; 6 racing finishes of one job: 1 message', workerAuth: 'registered with secret', ownerPageAfterRestart: 'shows both', deployed: false }));
} catch (e) { console.error('FAIL', e.message, log.slice(-800)); process.exitCode = 1; } finally { await browser?.close(); next?.kill(); pg.kill(); }
