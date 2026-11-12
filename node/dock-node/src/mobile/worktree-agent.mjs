import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runSandboxed, runSandboxedAsync } from './sandbox.mjs';
// SCRIPTED STAND-IN, not a model. It proves the execution shape: one real git worktree + branch per task,
// a change made only inside that worktree, inside a namespace sandbox, the repo's own tests run before and after, and diff/test evidence
// returned. The shared checkout is never touched. `editCmd` (run sandboxed, cwd = the worktree) is the only thing a real agent replaces.
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// Untrusted code (the edit and the repo's tests) only ever runs inside the sandbox, mounted on its own worktree.
const tests = cwd => { const r = runSandboxed({ worktree: cwd, cmd: ['node', '--test'] }); return { ok: r.ok, out: r.stdout }; };
export function worktreeAgent({ repoDir, worktreesRoot, editCmd, modelProxyFactory = undefined }) {
    return async ({ taskId, ownerId }) => {
        const key = 'wt-' + taskId.replace(/[^a-z0-9-]/gi, '').toLowerCase(), dir = join(worktreesRoot, key), branch = 'task/' + key;
        if (existsSync(dir)) throw Error('Worktree already exists for this task; refusing to reuse');
        git(repoDir, 'worktree', 'add', '-b', branch, dir);
        const before = tests(dir);
        // Optional model channel: a trusted proxy (identity from the server-side job, never from the task) reached only
        // through a unix socket mounted into the sandbox. Only the edit step gets it; the tests never do.
        const proxy = modelProxyFactory?.({ ownerId, jobId: taskId }), chan = proxy ? await proxy.listen() : undefined;
        let ed; try { ed = await runSandboxedAsync({ worktree: dir, cmd: editCmd, socketDir: chan?.dir }); } finally { if (proxy) proxy.close(chan.dir); }
        if (!ed.ok) throw Error('Edit step failed inside the sandbox');
        git(dir, 'add', '-A'); git(dir, '-c', 'user.name=dock-agent', '-c', 'user.email=agent@example.invalid', 'commit', '-qm', 'FICTIONAL scripted change');
        const after = tests(dir), stat = git(dir, 'diff', '--shortstat', 'HEAD~1', 'HEAD').trim();
        const pass = s => (s.out.match(/# pass (\d+)/) || [])[1] ?? '?', fail = s => (s.out.match(/# fail (\d+)/) || [])[1] ?? '?';
        if (!after.ok) throw Error('Tests still failing after the change');
        const files = (stat.match(/(\d+) files? changed/) || [])[1] ?? '?';
        return { text: `Fixed. All ${pass(after)} tests pass.`, evidence: [`Tests: ${fail(before)} failing before, ${fail(after)} failing after (${pass(after)} passing).`, `Changed ${files} file${files === '1' ? '' : 's'}: ${stat.replace(/^\s*\d+ files? changed, /, '')}`, ...(proxy ? [`Asked the model router ${proxy.calls()} time${proxy.calls() === 1 ? '' : 's'} (an attempt count, not a cost).`] : []), `Kept on its own branch (${branch.slice(0, 13)}...), apart from the shared code.`] };
    };
}
