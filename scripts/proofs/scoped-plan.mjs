// REAL: Postgres queue, fenced runner, plan validator -> real git worktree -> namespace-sandboxed scoped file tools -> sandboxed repo tests.
// FICTIONAL: repo and tasks. No model. Local only. Edits are DATA steps, not a shell; each file op still runs inside the sandbox.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, existsSync, readdirSync } from 'node:fs';
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
const plans = new Map(); // FICTIONAL planner: stands in for a model. Its output is untrusted data.
const enqueue = async (T, text, plan) => { plans.set(T, plan); await db.rpc('mobile_task_open', { p_task: T, p_owner: O, p_workspace: U(2), p_session: U(3), p_agent: 'chief', p_review: 'none', p_brief: text }); await db.rpc('mobile_job_enqueue', { p_task: T, p_owner: O, p_input: text }); };
const agent = worktreeAgent({ repoDir: repo, worktreesRoot: wts, planner: async ({ taskId }) => plans.get(taskId), enforcement: 'local-rlimit-only' });
const run = () => runOneJob({ db, worker: 'w1', ttlSeconds: 60, answer: agent });
const row = T => db.sql(`select state||'|'||coalesce(result_summary,'')||'|'||coalesce(evidence::text,'') from mobile_tasks where id='${T}'`);
const worktrees = () => readdirSync(wts).length, branches = () => sh(repo, 'branch', '--list', 'task/*').trim();
const outside = () => readFileSync(join(root, 'outside-secret'), 'utf8');
const out = { rejectedBeforeAnyEffect: {} };
// A. valid plan: done
const A = U(4); await enqueue(A, 'FICTIONAL: fix add (planned)', [{ op: 'read', path: 'math.mjs' }, { op: 'write', path: 'math.mjs', text: 'export const add = (a, b) => a + b;\n' }]); await run(); assert.match(await row(A), /^done\|Fixed\. All 2 tests pass\./); assert.equal(worktrees(), 1); out.valid = 'done';
// B. invalid plans: whole plan rejected, task failed, NO worktree, NO branch, nothing written
const bad = { notAList: { op: 'write' }, empty: [], tooManySteps: Array.from({ length: 21 }, () => ({ op: 'read', path: 'math.mjs' })),
    extraCommandField: [{ op: 'write', path: 'math.mjs', text: 'x', cmd: ['sh', '-c', 'id'] }], extraEnforcementField: [{ op: 'read', path: 'math.mjs', enforcement: 'local-rlimit-only' }], modelOrIdentityField: [{ op: 'read', path: 'math.mjs', model: 'x', owner: 'y' }],
    execOp: [{ op: 'exec', path: 'math.mjs' }], traversal: [{ op: 'write', path: '../x', text: 'x' }], absolute: [{ op: 'write', path: '/tmp/x', text: 'x' }], gitHook: [{ op: 'write', path: '.git/hooks/pre-commit', text: 'x' }], nested: [{ op: 'write', path: 'a/.gitmodules', text: 'x' }],
    tooLargeText: [{ op: 'write', path: 'big', text: 'z'.repeat(100_001) }], validThenInvalid: [{ op: 'write', path: 'math.mjs', text: 'PARTIAL' }, { op: 'write', path: '../x', text: 'x' }] };
const w0 = worktrees(), b0 = branches();
const ids = Object.keys(bad).map((k, i) => `${String(i + 1).padStart(2, '0')}000000-0000-4000-8000-000000000000`);
for (const [i, [k, plan]] of Object.entries(bad).entries()) { const T = ids[i]; await enqueue(T, 'FICTIONAL invalid plan: ' + k, plan); await run(); const r = await row(T); assert.ok(r.startsWith('failed') || r.startsWith('blocked') || !r.startsWith('done'), k + ' -> ' + r); out.rejectedBeforeAnyEffect[k] = r.split('|')[0]; }
assert.equal(worktrees(), w0); assert.equal(branches(), b0); assert.equal(readFileSync(join(repo, 'math.mjs'), 'utf8').includes('PARTIAL'), false); assert.equal(outside(), 'OUTSIDE_SECRET');
// C. a plan that PASSES validation but fails at execution (committed symlink to outside): no partial success, worktree reset, outside file unchanged
const C = U(7); await enqueue(C, 'FICTIONAL: valid shape, hostile target', [{ op: 'write', path: 'notes.txt', text: 'first' }, { op: 'write', path: 'link-out', text: 'OVERWRITE' }]); await run();
const rc = await row(C); assert.ok(!rc.startsWith('done'), rc); assert.equal(outside(), 'OUTSIDE_SECRET'); const wt = readdirSync(wts).map(d => join(wts, d)).find(d => d.includes(C.replace(/-/g, '').slice(0, 4)) || d.includes('wt-' + C));
const st = sh(wt, 'status', '--porcelain').trim(); assert.equal(st, '', 'worktree must be clean after a failed plan, got: ' + st); out.validShapeButHostileAtExecution = { task: rc.split('|')[0], partialWriteRolledBack: true, outsideFileUnchanged: true };
console.log(JSON.stringify({ realPostgres: true, planValidatedAsUntrustedData: out, containmentStillChecksAtExecution: true, enforcement: 'local-rlimit-only (per-process, NOT aggregate)', noModel: true, hosted: false }));
