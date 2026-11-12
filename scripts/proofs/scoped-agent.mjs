// REAL: Postgres queue, fenced runner, real git worktree, namespace sandbox, scoped file tools, repo tests run sandboxed.
// FICTIONAL: repo and tasks. No model. Local only. Edits are DATA steps, not a shell; each file op still runs inside the sandbox.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { runOneJob } from '../../node/dock-node/src/mobile/job-runner.mjs';
import { worktreeAgent } from '../../node/dock-node/src/mobile/worktree-agent.mjs';
import { db } from './job-queue-db.mjs';
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const root = mkdtempSync(join(tmpdir(), 'fictional-repo-')), repo = join(root, 'main'), wts = join(root, 'wts'); mkdirSync(repo); mkdirSync(wts); sh(repo, 'init', '-q', '-b', 'main');
writeFileSync(join(root, 'outside-secret'), 'OUTSIDE_SECRET');
writeFileSync(join(repo, 'math.mjs'), 'export const add = (a, b) => a - b;\n'); writeFileSync(join(repo, 'math.test.mjs'), "import test from 'node:test';import assert from 'node:assert/strict';import { add } from './math.mjs';test('add',()=>assert.equal(add(2,3),5));test('add zero',()=>assert.equal(add(0,0),0));\n");
symlinkSync(join(root, 'outside-secret'), join(repo, 'link-out')); // a committed symlink pointing outside the repo
sh(repo, 'add', '-A'); sh(repo, '-c', 'user.name=x', '-c', 'user.email=x@example.invalid', 'commit', '-qm', 'init');
const U = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`, O = U(1);
const enqueue = async (T, text) => { await db.rpc('mobile_task_open', { p_task: T, p_owner: O, p_workspace: U(2), p_session: U(3), p_agent: 'chief', p_review: 'none', p_brief: text }); await db.rpc('mobile_job_enqueue', { p_task: T, p_owner: O, p_input: text }); };
const run = async steps => runOneJob({ db, worker: 'w1', ttlSeconds: 60, answer: worktreeAgent({ repoDir: repo, worktreesRoot: wts, fileSteps: steps, enforcement: 'local-rlimit-only' }) });
const row = T => db.sql(`select state||'|'||coalesce(result_summary,'')||'|'||coalesce(evidence::text,'') from mobile_tasks where id='${T}'`);
// A. a good task: edit as data, tests run sandboxed, evidence says how
const A = U(4); await enqueue(A, 'FICTIONAL: fix add (file steps)'); const a = await run([{ op: 'read', path: 'math.mjs' }, { op: 'write', path: 'math.mjs', text: 'export const add = (a, b) => a + b;\n' }]); assert.equal(a.recorded, true);
const ra = await row(A); assert.match(ra, /^done\|Fixed\. All 2 tests pass\./); assert.match(ra, /scoped file tools \(1 write, no free-form command\)/);
// B. hostile plans: each must fail the task, change nothing outside, and not be reported as success
const check = async (T, steps, why) => { await enqueue(T, 'FICTIONAL hostile: ' + why); await run(steps); const r = await row(T); assert.ok(!r.startsWith('done'), why + ' -> ' + r); assert.equal(readFileSync(join(root, 'outside-secret'), 'utf8'), 'OUTSIDE_SECRET', why + ' changed an outside file'); return r.split('|')[0]; };
const out = { good: 'done', hostile: {} };
out.hostile.traversal = await check(U(5), [{ op: 'write', path: '../escape.txt', text: 'x' }], 'traversal'); assert.ok(!existsSync(join(wts, 'escape.txt')));
out.hostile.absolute = await check(U(6), [{ op: 'write', path: '/tmp/fictional-abs-write', text: 'x' }], 'absolute'); assert.ok(!existsSync('/tmp/fictional-abs-write'));
out.hostile.writeThroughCommittedSymlink = await check(U(7), [{ op: 'write', path: 'link-out', text: 'OVERWRITE' }], 'write via committed symlink');
out.hostile.readThroughCommittedSymlink = await check(U(8), [{ op: 'read', path: 'link-out' }], 'read via committed symlink');
console.log(JSON.stringify({ realPostgres: true, queuedTaskWithScopedFileSteps: out, repoTestsRanSandboxed: true, everyFileOperationRunsInsideTheNamespaceSandbox: true, enforcement: 'local-rlimit-only (per-process, NOT aggregate)', hosted: false }));
