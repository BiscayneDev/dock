// REAL: authenticated Next production build (NEXT_CMD=start), real session creation, queue, fenced finish, /assistant at 390px. FICTIONAL data; local only.
// Dev mode (next dev) did not hydrate this page in the harness; use a production build.
// REAL: authenticated Next enqueue route -> Postgres queue -> separate worker PROCESSES (one SIGKILLed mid-run) ->
// Next killed and restarted -> owner page. FICTIONAL: data, repo, agent (scripted, no model, no inference server at all).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dockMobileClient } from '../../node/dock-node/src/mobile/acp.mjs';
let log = ''; const repo = '/tmp/x', wts = '/tmp/y';
const pp = createRequire(process.cwd() + '/package.json')('puppeteer-core');
const env = { ...process.env, DOCK_PUBLIC_ORIGIN: 'http://127.0.0.1:3107', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:4597', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fictional', SUPABASE_SERVICE_ROLE_KEY: 'fictional', DOCK_OWNER_EMAIL: 'demo@example.com', DOCK_MOBILE_ENABLED: 'true', DOCK_MOBILE_TASK_LEDGER: 'true', DOCK_MOBILE_TASK_QUEUE: 'true', FIX_REPO: repo, FIX_WTS: wts };
const pg = spawn('python3', ['scripts/proofs/postgres-http-fixture.py'], { env }); pg.stdout.on('data', x => log += x); pg.stderr.on('data', x => log += x);
let next; const startNext = () => { next = spawn(process.execPath, ['node_modules/next/dist/bin/next', process.env.NEXT_CMD || 'dev', '-p', '3107'], { env }); next.stdout.on('data', x => log += x); next.stderr.on('data', x => log += x); };
const rest = p => fetch('http://127.0.0.1:4597/rest/v1/' + p).then(r => r.json());
const OWN = '44444444-4444-4444-8444-444444444444', WSP = '33333333-3333-4333-8333-333333333333', secretOf = n => ('fictional-secret-' + n).padEnd(40, 'x');
const rpc = async (fn, a) => { const r = await fetch('http://127.0.0.1:4597/rest/v1/rpc/' + fn, { method: 'POST', body: JSON.stringify(a) }); const j = await r.json(); return r.ok ? { data: j } : { error: { message: j.message } }; };
const register = n => rpc('mobile_worker_register', { p_worker: n, p_owner: OWN, p_workspace: WSP, p_secret: secretOf(n) });
const worker = async (mode, name) => { assert.equal((await register(name)).data, true); return new Promise(res => { const c = spawn(process.execPath, ['scripts/proofs/queue-worker.mjs', mode, name], { env: { ...env, WORKER_SECRET: secretOf(name) } }); let out = ''; c.stdout.on('data', d => { out += d; if (mode === 'hang' && out.includes('IN_AGENT')) res({ c, out }); if (out.includes('WORKER_DONE')) res({ c, out }); }); c.stderr.on('data', d => log += d); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
    for (let i = 0; i < 200 && !log.includes('POSTGRES_HTTP_READY'); i++) await sleep(300);
    startNext();
    const c = dockMobileClient({ url: 'http://127.0.0.1:3107', token: 'dockdev.66666666-6666-4666-8666-666666666666.fictional-device-secret' });
    let session; for (let i = 0; i < 100; i++) { try { session = await c.open({ requestId: crypto.randomUUID() }); break; } catch { await sleep(1000); } }
    assert.ok(session?.sessionId, 'session ' + log.slice(-400));
    const T = crypto.randomUUID(); const r = await c.turn({ sessionId: session.sessionId, requestId: T, text: 'FICTIONAL: fix add' }); await register('w1');
    const lr = (await rpc('mobile_job_lease', { p_worker: 'w1', p_secret: secretOf('w1'), p_ttl_seconds: 60 })).data; await rpc('mobile_job_start', { p_task: T, p_worker: 'w1', p_secret: secretOf('w1'), p_epoch: lr.epoch });
    console.log('finish', JSON.stringify(await rpc('mobile_job_finish', { p_task: T, p_worker: 'w1', p_secret: secretOf('w1'), p_epoch: lr.epoch, p_status: 'delivered', p_digest: 'e'.repeat(64), p_summary: 'Fixed. All 2 tests pass.', p_evidence: '["fictional"]' })));
    const sess = (await rest('mobile_sessions?id=eq.' + session.sessionId))[0]; console.log('session', JSON.stringify(sess));
    console.log('conv', JSON.stringify(await rest('conversations?id=eq.' + sess.conversation_id)), 'msgs', (await rest('messages?conversation_id=eq.' + sess.conversation_id)).map(m => m.role));
    const b64 = x => Buffer.from(JSON.stringify(x)).toString('base64url');
    const ck = 'sb-127-auth-token=base64-' + Buffer.from(JSON.stringify({ access_token: b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: OWN, email: 'demo@example.com', aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig', refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: OWN, email: 'demo@example.com', aud: 'authenticated' } })).toString('base64url');
    const a = await fetch('http://127.0.0.1:3107/api/conversations/' + sess.conversation_id, { headers: { cookie: ck } }); console.log('API', a.status, (await a.text()).slice(0, 600));
    const browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'], defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true } });
    const page = await browser.newPage(); page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0, 300))); page.on('requestfailed', q => console.log('REQFAIL', q.url().slice(0, 120))); page.on('console', m => { if (m.type()==='error' && !m.text().includes('WebSocket')) console.log('BROWSER', m.text().slice(0,300)); }); page.on('response', r => { if (r.url().includes('/api/')) console.log('RESP', r.status(), r.url().replace('http://127.0.0.1:3107', '')); });
    await page.setCookie({ name: 'sb-127-auth-token', value: ck.split('=')[1], domain: '127.0.0.1', path: '/' });
    await page.goto('http://127.0.0.1:3107/assistant?id=' + sess.conversation_id, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.goto('http://127.0.0.1:3107/assistant?id=' + sess.conversation_id, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
    try { await page.waitForFunction(() => document.body.innerText.includes('Fixed. All 2'), { timeout: 60000 }); } catch { console.log('RESULT NOT SHOWN'); }
    console.log('TEXT', (await page.evaluate(() => document.body.innerText)).slice(0, 500));
    const T0 = await page.evaluate(() => document.body.innerText); console.log('REGEN_ON_WORKER_RESULT', T0.includes('Regenerate'));
    const composerOk = await page.evaluate(() => { const box = [...document.querySelectorAll('textarea')][0].closest('div[class*=rounded]').parentElement.getBoundingClientRect(); const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Run in background').getBoundingClientRect(); return { inside: btn.right <= box.right && btn.left >= box.left, btnH: btn.height, boxRight: box.right, btnRight: btn.right }; }); console.log('COMPOSER', JSON.stringify(composerOk));
    await page.screenshot({ path: '/downloads/dock-chat-390px-top-FICTIONAL-LOCAL.png' });
    await page.evaluate(() => { for (const e of [document.scrollingElement, ...document.querySelectorAll('*')]) if (e && e.scrollHeight > e.clientHeight + 40) e.scrollTop = e.scrollHeight; }); await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: '/downloads/dock-chat-390px-bottom-FICTIONAL-LOCAL.png' });
    // ordinary chat is unchanged: a plain assistant reply as the last message keeps Regenerate
    await fetch('http://127.0.0.1:4597/rest/v1/messages', { method: 'POST', body: JSON.stringify({ conversation_id: sess.conversation_id, role: 'assistant', content: 'FICTIONAL ordinary reply', agent: 'chief', meta: {} }) });
    await page.goto('http://127.0.0.1:3107/assistant?id=' + sess.conversation_id, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}); await new Promise(r => setTimeout(r, 2500));
    console.log('REGEN_ON_ORDINARY_REPLY', (await page.evaluate(() => document.body.innerText)).includes('Regenerate')); await browser.close();
} catch (e) { console.error('FAIL', e.message); } finally { console.log('LOG', log.slice(-1500)); next?.kill(); pg.kill(); process.exit(0); }
