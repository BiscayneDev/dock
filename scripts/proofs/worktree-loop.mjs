// REAL: Postgres 0023+0024, lease-fenced runner, real git repo + real `git worktree`, real `node --test` runs.
// FICTIONAL: the repo, the tasks, and the "agent" (a scripted edit, no model, no cost). Not deployed.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { runOneJob } from '../../node/dock-node/src/mobile/job-runner.mjs';
import { worktreeAgent } from '../../node/dock-node/src/mobile/worktree-agent.mjs';
import { db } from './job-queue-db.mjs';
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const root = mkdtempSync(join(tmpdir(), 'fictional-repo-')), repo = join(root, 'main'), wts = join(root, 'worktrees'); mkdirSync(repo); mkdirSync(wts);
sh(repo, 'init', '-q', '-b', 'main');
writeFileSync(join(repo, 'math.mjs'), 'export const add = (a, b) => a - b; // FICTIONAL bug\n');
writeFileSync(join(repo, 'math.test.mjs'), "import test from 'node:test';import assert from 'node:assert/strict';import { add } from './math.mjs';test('add',()=>assert.equal(add(2,3),5));test('add zero',()=>assert.equal(add(0,0),0));\n");
sh(repo, 'add', '-A'); sh(repo, '-c', 'user.name=x', '-c', 'user.email=x@example.invalid', 'commit', '-qm', 'FICTIONAL init');
const mainBefore = readFileSync(join(repo, 'math.mjs'), 'utf8');
const agent = worktreeAgent({ repoDir: repo, worktreesRoot: wts, editCmd: ['node', '-e', "require('fs').writeFileSync('math.mjs','export const add = (a, b) => a + b;\\n')"] });
const U = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`, O = U(1);
const out = [];
for (const n of [4, 5]) {
    await db.rpc('mobile_task_open', { p_task: U(n), p_owner: O, p_workspace: U(2), p_session: U(3), p_agent: 'chief', p_review: 'none', p_brief: 'FICTIONAL: fix the add function in the fictional repo' });
    await db.rpc('mobile_job_enqueue', { p_task: U(n), p_owner: O, p_input: 'FICTIONAL: fix add' });
    const r = await runOneJob({ db, scope: { ownerId: O, workspaceId: U(2) }, worker: 'w' + n, answer: agent, ttlSeconds: 60 }); assert.equal(r.recorded, true);
}
const wtDirs = [4, 5].map(n => join(wts, 'wt-' + U(n))); assert.ok(wtDirs.every(existsSync)); assert.notEqual(wtDirs[0], wtDirs[1]);
assert.equal(readFileSync(join(repo, 'math.mjs'), 'utf8'), mainBefore, 'shared checkout untouched');
assert.ok(sh(repo, 'branch', '--list', 'task/*').split('\n').filter(Boolean).length === 2);
// Hostile edit step: tries to read the sibling task's worktree and the parent's repo; both must be invisible inside the sandbox.
const sib = join(wts, 'wt-' + U(4), 'math.mjs'), hostile = `const fs=require('fs');let l='';for(const p of [${JSON.stringify(sib)},${JSON.stringify(join(repo, 'math.mjs'))}]){try{l+=fs.readFileSync(p,'utf8')}catch(e){l+='blocked:'+e.code+';'}}fs.writeFileSync('loot.txt',l);fs.writeFileSync('math.mjs','export const add = (a, b) => a + b;\\n')`;
await db.rpc('mobile_task_open', { p_task: U(6), p_owner: O, p_workspace: U(2), p_session: U(3), p_agent: 'chief', p_review: 'none', p_brief: 'FICTIONAL hostile' }); await db.rpc('mobile_job_enqueue', { p_task: U(6), p_owner: O, p_input: 'FICTIONAL hostile' });
const hr = await runOneJob({ db, scope: { ownerId: O, workspaceId: U(2) }, worker: 'wh', answer: worktreeAgent({ repoDir: repo, worktreesRoot: wts, editCmd: ['node', '-e', hostile] }), ttlSeconds: 60 }); assert.equal(hr.recorded, true);
const loot = readFileSync(join(wts, 'wt-' + U(6), 'loot.txt'), 'utf8'); assert.match(loot, /^blocked:ENOENT;blocked:ENOENT;$/, loot);
const rows = await db.sql(`select state,result_summary,evidence::text from mobile_tasks order by id`);
console.log(JSON.stringify({ realPostgres: true, realGitWorktrees: 2, realTestRuns: true, sharedCheckoutUntouched: true, hostileEditCouldNotReadSiblingOrParent: true, untrustedCodeRunsInNamespaceSandbox: true, taskRows: rows, agent: 'scripted stand-in, not a model', deployed: false }));
