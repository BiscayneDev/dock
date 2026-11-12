// The only network channel for an untrusted worker is a unix socket to a trusted proxy. FICTIONAL local upstream and
// FICTIONAL key canary (no real provider, no cost). A hostile task tries SSRF, identity/budget assertion and key theft.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModelProxy } from '../../node/dock-node/src/mobile/model-proxy.mjs';
import { sandboxArgs } from '../../node/dock-node/src/mobile/sandbox.mjs';
const ex = promisify(execFile), seen = [];
const up = http.createServer(async (q, s) => { let t = ''; for await (const c of q) t += c; seen.push({ url: q.url, auth: q.headers.authorization, owner: q.headers['x-dock-owner'], job: q.headers['x-dock-job'], body: JSON.parse(t) }); if (q.url === '/v1/redir') { s.writeHead(302, { location: 'http://127.0.0.1:1/' }); return s.end(); } s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'FICTIONAL model reply' } }] })); });
await new Promise(r => up.listen(0, '127.0.0.1', r)); const upPort = up.address().port;
const KEY = 'CANARY_FICTIONAL_PROVIDER_KEY', identity = { ownerId: 'server-side-owner', jobId: 'server-side-job' };
const proxy = createModelProxy({ upstream: `http://127.0.0.1:${upPort}`, apiKey: KEY, identity, model: 'fictional-pinned-model', maxCalls: 3, maxOutputTokens: 512 });
const { dir } = await proxy.listen(); const wt = mkdtempSync(join(tmpdir(), 'fictional-wt-'));
const probe = `
const http=require('http'),fs=require('fs');const out={};
const call=(o,body)=>new Promise(r=>{const q=http.request({socketPath:'/run/model/model.sock',...o},s=>{let d='';s.on('data',x=>d+=x);s.on('end',()=>r(s.statusCode+':'+d.slice(0,80)))});q.on('error',e=>r('err:'+e.code));q.end(body)});
const chat=b=>call({path:'/v1/chat/completions',method:'POST',headers:{'content-type':'application/json',authorization:'Bearer TASK_ASSERTED_KEY','x-dock-owner':'attacker-owner','x-dock-job':'attacker-job'}},JSON.stringify(b));
(async()=>{
out.ok=await chat({model:'expensive-model',max_tokens:999999,user:'attacker',messages:[{role:'user',content:'hi'}]});
out.otherPath=await call({path:'/admin',method:'GET'});
out.ssrfAbsolute=await call({path:'http://169.254.169.254/latest/meta-data/',method:'GET'});
out.ssrfPostAbsolute=await call({path:'http://127.0.0.1:1/v1/chat/completions',method:'POST'},'{}');
out.method=await call({path:'/v1/chat/completions',method:'PUT'},'{}');
out.stream=await chat({stream:true,messages:[{role:'user',content:'x'}]});
out.big=await chat({messages:[{role:'user',content:'x'.repeat(20000)}]});
out.second=await chat({messages:[{role:'user',content:'2'}]});
out.third=await chat({messages:[{role:'user',content:'3'}]});
out.overBudget=await chat({messages:[{role:'user',content:'4'}]});
out.keyInEnv=process.env.CANARY_KEY||'absent';
try{out.keyOnDisk=fs.readFileSync('/run/model/../../proc/1/environ','utf8').includes('CANARY')?'LEAK':'absent'}catch(e){out.keyOnDisk='blocked'}
try{fs.writeFileSync('/run/model/x','x');out.writeSock='WROTE'}catch(e){out.writeSock='blocked:'+e.code}
console.log(JSON.stringify(out))})()`;
process.env.CANARY_KEY = KEY;
const r = await ex('bwrap', sandboxArgs({ worktree: wt, cmd: ['node', '-e', probe], socketDir: dir }), { env: { PATH: '/usr/bin:/bin' } }); const o = JSON.parse(r.stdout);
assert.match(o.ok, /^200:.*FICTIONAL model reply/);
for (const k of ['otherPath', 'ssrfAbsolute', 'ssrfPostAbsolute', 'method']) assert.match(o[k], /^404:/, k + ' ' + o[k]);
assert.match(o.stream, /^400:/); assert.match(o.big, /^413:|^err:/); assert.match(o.overBudget, /^429:/);
assert.equal(o.keyInEnv, 'absent'); assert.equal(o.keyOnDisk === 'LEAK', false); assert.match(o.writeSock, /^blocked:/);
// what the upstream actually saw: pinned model, clamped tokens, proxy's own credential, server-side identity (never the task's)
assert.equal(seen.length, 3); for (const s of seen) { assert.equal(s.url, '/v1/chat/completions'); assert.equal(s.auth, 'Bearer ' + KEY); assert.equal(s.owner, 'server-side-owner'); assert.equal(s.job, 'server-side-job'); assert.equal(s.body.model, 'fictional-pinned-model'); assert.ok(s.body.max_tokens <= 512); assert.equal(s.body.user, 'server-side-job'); }
// redirects are not followed
const p2 = createModelProxy({ upstream: `http://127.0.0.1:${upPort}`, apiKey: KEY, identity, model: 'm', fetchImpl: (u, o) => fetch(new URL('/v1/redir', u), o) }); const l2 = await p2.listen();
const r2 = await ex('bwrap', sandboxArgs({ worktree: wt, cmd: ['node', '-e', probe.replace(/out\.ok=await[^\n]*\n[\s\S]*console/, "out.ok=await chat({messages:[{role:'user',content:'r'}]});console")], socketDir: l2.dir }), { env: { PATH: '/usr/bin:/bin' } });
assert.match(JSON.parse(r2.stdout).ok, /^502:/);
console.log(JSON.stringify({ onlyChannel: 'unix socket to trusted proxy', allowed: 'POST /v1/chat/completions only', refused: { otherPath: o.otherPath.slice(0, 3), ssrfAbsolute: o.ssrfAbsolute.slice(0, 3), method: o.method.slice(0, 3), stream: o.stream.slice(0, 3), bigBody: o.big.slice(0, 3), overBudget: o.overBudget.slice(0, 3) }, upstreamSaw: { calls: seen.length, model: 'pinned', credential: 'proxy-side only', identity: 'server-side, task-asserted ignored', maxTokensClamped: true }, redirectFollowed: false, keyVisibleInSandbox: false, upstream: 'fictional local endpoint', deployed: false }));
up.close(); proxy.close(dir); p2.close(l2.dir);
