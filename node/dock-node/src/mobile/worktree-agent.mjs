import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runLimited, checkEnforcement } from './limits.mjs';
import { scopedFiles } from './scoped-files.mjs';
import { validatePlan } from './plan-validator.mjs';
// SCRIPTED STAND-IN, not a model. It proves the execution shape: one real git worktree + branch per task,
// a change made only inside that worktree, inside a namespace sandbox, the repo's own tests run before and after, and diff/test evidence
// returned. The shared checkout is never touched. `editCmd` (run sandboxed, cwd = the worktree) is the only thing a real agent replaces.
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// Untrusted code (the edit and the repo's tests) only ever runs inside the sandbox, mounted on its own worktree.
const testsWith = (enforcement, limits) => async (cwd, signal) => { const r = await runLimited({ worktree: cwd, cmd: ['node', '--test'], enforcement, limits, signal }); return { ok: r.ok, out: r.stdout, enforcement: r.enforcement }; };
export function worktreeAgent({ repoDir, worktreesRoot, editCmd, fileSteps = undefined, planner = undefined, modelProxyFactory = undefined, enforcement = 'aggregate-required', limits = {} }) {
    const tests = testsWith(enforcement, limits);
    return async ({ taskId, ownerId, input, context = undefined, signal = undefined }) => {
        signal?.throwIfAborted();
        const gate = checkEnforcement(enforcement); if (!gate.ok) throw Error('Refused before running anything: ' + gate.reason);
        const key = 'wt-' + taskId.replace(/[^a-z0-9-]/gi, '').toLowerCase(), dir = join(worktreesRoot, key), branch = 'task/' + key;
        // Untrusted plan (e.g. proposed by a model): validated as data BEFORE any worktree or write exists. Rejection changes nothing.
        // enforcement, limits, identity and commands come only from this trusted function's own configuration, never from the plan.
        let steps = fileSteps; if (planner) { const v = validatePlan(await planner({ taskId, input, context })); if (!v.ok) throw Error('Plan rejected before running anything: ' + v.reason); steps = v.steps; }
        if (existsSync(dir)) throw Error('Worktree already exists for this task; refusing to reuse');
        git(repoDir, 'worktree', 'add', '-b', branch, dir);
        const before = await tests(dir, signal); signal?.throwIfAborted();
        // Optional model channel: a trusted proxy (identity from the server-side job, never from the task) reached only
        // through a unix socket mounted into the sandbox. Only the edit step gets it; the tests never do.
        const proxy = modelProxyFactory?.({ ownerId, jobId: taskId, signal }), chan = proxy ? await proxy.listen() : undefined;
        // Simple edits as data, not a shell: [{op:'write', path, text}]. They run through scoped-files (each op inside the namespace sandbox under
        // the same limit layer), so a task cannot run arbitrary commands in this step. Tests still run as a sandboxed command.
        if (steps) { const f = scopedFiles({ worktree: dir, enforcement, limits, signal }); try { for (const st of steps) { if (st.op === 'write') await f.write(st.path, st.text); else if (st.op === 'read') await f.read(st.path); else if (st.op === 'list') await f.list(st.path); else throw Error('Unknown file step'); } } catch (e) { try { git(dir, 'checkout', '--', '.'); git(dir, 'clean', '-fdq'); } catch { } throw e; } }
        let ed = steps ? { ok: true } : undefined; if (!steps) try { ed = await runLimited({ worktree: dir, cmd: editCmd, socketDir: chan?.dir, enforcement, limits, signal }); } finally { if (proxy) proxy.close(chan.dir); }
        if (!ed.ok) throw Error('Edit step failed inside the sandbox');
        git(dir, 'add', '-A'); git(dir, '-c', 'user.name=dock-agent', '-c', 'user.email=agent@example.invalid', 'commit', '-qm', 'FICTIONAL scripted change');
        signal?.throwIfAborted(); const after = await tests(dir, signal), stat = git(dir, 'diff', '--shortstat', 'HEAD~1', 'HEAD').trim();
        const pass = s => (s.out.match(/# pass (\d+)/) || [])[1] ?? '?', fail = s => (s.out.match(/# fail (\d+)/) || [])[1] ?? '?';
        if (!after.ok) throw Error('Tests still failing after the change');
        const files = (stat.match(/(\d+) files? changed/) || [])[1] ?? '?';
        return { evidenceSource: 'sandbox-run', text: `Fixed. All ${pass(after)} tests pass.`, evidence: [`Tests: ${fail(before)} failing before, ${fail(after)} failing after (${pass(after)} passing).`, `Changed ${files} file${files === '1' ? '' : 's'}: ${stat.replace(/^\s*\d+ files? changed, /, '')}`, ...(steps ? [`Edited through scoped file tools (${steps.filter(x => x.op === 'write').length} write${steps.filter(x => x.op === 'write').length === 1 ? '' : 's'}, no free-form command).`] : []), ...(proxy ? [`Asked the model router ${proxy.calls()} time${proxy.calls() === 1 ? '' : 's'} (an attempt count, not a cost).`] : []), `Kept on its own branch (${branch.slice(0, 13)}...), apart from the shared code.`] };
    };
}
