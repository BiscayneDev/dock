// Adversarial boundary proof with FICTIONAL canaries. A hostile "task" tries to read secrets, siblings, env, network, pids.
// CONTROL: the same probe unsandboxed must leak (so the test can fail). SANDBOX: everything must be blocked.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const ex = promisify(execFile);
import assert from 'node:assert/strict';
import { sandboxArgs } from '../../node/dock-node/src/mobile/sandbox.mjs';
const root = mkdtempSync(join(homedir(), 'fictional-iso-')), mine = join(root, 'wt-mine'), sibling = join(root, 'wt-sibling'); mkdirSync(mine); mkdirSync(sibling);
writeFileSync(join(root, 'parent-secret.txt'), 'CANARY_PARENT_FILE_FICTIONAL'); writeFileSync(join(sibling, 'other-task.txt'), 'CANARY_SIBLING_FICTIONAL'); writeFileSync(join(mine, 'ok.txt'), 'mine');
const srv = net.createServer(s => s.end('CANARY_LOOPBACK_FICTIONAL')); await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
process.env.DOCK_CANARY_ENV = 'CANARY_ENV_FICTIONAL';
const probe = `
const fs=require('fs'),net=require('net');const out={};const t=(k,f)=>{try{out[k]=f()}catch(e){out[k]='blocked:'+(e.code||e.message)}};
t('parentFile',()=>fs.readFileSync(${JSON.stringify(join(root, 'parent-secret.txt'))},'utf8'));
t('siblingByAbsPath',()=>fs.readFileSync(${JSON.stringify(join(sibling, 'other-task.txt'))},'utf8'));
t('siblingByRelative',()=>fs.readFileSync('../wt-sibling/other-task.txt','utf8'));
t('parentHome',()=>fs.readdirSync(${JSON.stringify(homedir())}).join(','));
t('env',()=>process.env.DOCK_CANARY_ENV||'absent');
t('parentEnvViaProc',()=>fs.readFileSync('/proc/1/environ','utf8').includes('CANARY_ENV')?'LEAK':'absent');
t('pids',()=>fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x)).length);
t('writeOutside',()=>{fs.writeFileSync('/usr/escape.txt','x');return 'WROTE'});
t('writeWork',()=>{fs.writeFileSync('/work/new.txt','x');return 'ok'});
const tcp=(h,p)=>new Promise(r=>{const s=net.connect({host:h,port:p,timeout:1500});let d='';s.on('data',x=>d+=x);s.on('connect',()=>{});s.on('close',()=>r(d||'closed'));s.on('error',e=>r('blocked:'+e.code));s.on('timeout',()=>{s.destroy();r('blocked:timeout')})});
(async()=>{out.loopback=await tcp('127.0.0.1',${port});out.external=await tcp('1.1.1.1',443);console.log(JSON.stringify(out))})();`;
const control = await ex('node', ['-e', probe], { cwd: mine, env: process.env }); const c = JSON.parse(control.stdout);
for (const k of ['parentFile', 'siblingByAbsPath', 'siblingByRelative', 'env']) assert.match(c[k], /CANARY|mine|ENV/, 'control must leak ' + k);
assert.match(c.loopback, /CANARY_LOOPBACK/); assert.match(c.parentHome, /fictional-iso/);
const sb = await ex('bwrap', sandboxArgs({ worktree: mine, cmd: ['node', '-e', probe] }), { env: { PATH: '/usr/bin:/bin' } }); const s = JSON.parse(sb.stdout);
for (const k of ['parentFile', 'siblingByAbsPath', 'siblingByRelative', 'parentHome', 'writeOutside']) assert.match(s[k], /^blocked:/, k + ' leaked: ' + s[k]);
assert.equal(s.env, 'absent'); assert.equal(s.parentEnvViaProc, 'absent'.replace('absent', s.parentEnvViaProc)); assert.ok(!String(s.parentEnvViaProc).includes('LEAK'));
assert.match(s.loopback, /^blocked:/); assert.match(s.external, /^blocked:/); assert.ok(s.pids < 10, 'pid namespace: ' + s.pids); assert.equal(s.writeWork, 'ok');
assert.equal(readFileSync(join(mine, 'new.txt'), 'utf8'), 'x'); // only its own worktree is writable
console.log(JSON.stringify({ controlLeaks: { parentFile: true, sibling: true, env: true, loopback: true, home: true }, sandbox: { parentFile: s.parentFile, sibling: s.siblingByAbsPath, siblingRelative: s.siblingByRelative, home: s.parentHome, env: s.env, loopback: s.loopback, external: s.external, visiblePids: s.pids, writeOutsideWork: s.writeOutside, writeOwnWorktree: s.writeWork }, scope: 'local bubblewrap namespaces, not a hosted sandbox, no cgroup limits', deployed: false }));
srv.close();
