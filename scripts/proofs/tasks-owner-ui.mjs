// Real Next page /mobile/tasks over real local Postgres ledger rows. FICTIONAL data, local fixture auth, 390px.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const pp = createRequire(process.cwd() + '/package.json')('puppeteer-core');
let log = ''; const env = { ...process.env, DOCK_PUBLIC_ORIGIN: 'http://127.0.0.1:3105', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:4597', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fictional', SUPABASE_SERVICE_ROLE_KEY: 'fictional', DOCK_OWNER_EMAIL: 'demo@example.com' };
const pg = spawn('python3', ['scripts/proofs/postgres-http-fixture.py'], { env }); pg.stdout.on('data', x => log += x); pg.stderr.on('data', x => log += x);
const next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', '3105'], { env }); next.stdout.on('data', x => log += x); next.stderr.on('data', x => log += x);
let browser;
try {
    for (let i = 0; i < 200 && !log.includes('POSTGRES_HTTP_READY'); i++) await new Promise(r => setTimeout(r, 300));
    await fetch('http://127.0.0.1:4597/fixture/seed-tasks', { method: 'POST', body: '{}' }).then(r => r.json()).then(j => assert.ok(j.ok, JSON.stringify(j)));
    browser = await pp.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'], defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true } });
    const page = await browser.newPage(); const u = '44444444-4444-4444-8444-444444444444', b64 = x => Buffer.from(JSON.stringify(x)).toString('base64url');
    await page.setCookie({ name: 'sb-127-auth-token', value: 'base64-' + Buffer.from(JSON.stringify({ access_token: b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: u, email: 'demo@example.com', aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.fictional-signature', refresh_token: 'demo', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: u, email: 'demo@example.com' } })).toString('base64url'), domain: '127.0.0.1', path: '/' });
    let text = ''; for (let i = 0; i < 60; i++) { try { await page.goto('http://127.0.0.1:3105/mobile/tasks', { waitUntil: 'domcontentloaded', timeout: 60000 }); text = await page.evaluate(() => document.body.innerText); if (text.includes('What needs you')) break; } catch { } await new Promise(r => setTimeout(r, 1500)); }
    await new Promise(r => setTimeout(r, 1000)); text = await page.evaluate(() => document.body.innerText);
    await page.screenshot({ path: '/downloads/dock-tasks-390px-fictional.png', fullPage: true });
    console.log(page.url()); console.log(text);
    const low = text.toLowerCase(); assert.ok(['waiting on you', 'pick headline a or b', 'ready for review', 'outcome unknown (not retried)', 'closed on recorded proof', 'blocked'].every(x => low.includes(x)));
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); assert.ok(w[0] <= w[1], 'no horizontal overflow ' + w);
    console.log('UI_PASS');
} catch (e) { console.error('FAIL', e.message, log.slice(-1200)); process.exitCode = 1; } finally { await browser?.close(); next.kill(); pg.kill(); }
