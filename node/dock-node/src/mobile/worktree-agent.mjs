import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// SCRIPTED STAND-IN, not a model. It proves the execution shape: one real git worktree + branch per task,
// a change made only inside that worktree, the repo's own tests run before and after, and diff/test evidence
// returned. The shared checkout is never touched. `edit(worktreeDir)` is the only thing a real agent replaces.
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tests = cwd => { try { const out = execFileSync(process.execPath, ['--test'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }); return { ok: true, out }; } catch (e) { return { ok: false, out: String(e.stdout ?? '') }; } };
export function worktreeAgent({ repoDir, worktreesRoot, edit }) {
    return async ({ taskId }) => {
        const key = 'wt-' + taskId.replace(/[^a-z0-9-]/gi, '').toLowerCase(), dir = join(worktreesRoot, key), branch = 'task/' + key;
        if (existsSync(dir)) throw Error('Worktree already exists for this task; refusing to reuse');
        git(repoDir, 'worktree', 'add', '-b', branch, dir);
        const before = tests(dir);
        await edit(dir);
        git(dir, 'add', '-A'); git(dir, '-c', 'user.name=dock-agent', '-c', 'user.email=agent@example.invalid', 'commit', '-qm', 'FICTIONAL scripted change');
        const after = tests(dir), stat = git(dir, 'diff', '--shortstat', 'HEAD~1', 'HEAD').trim();
        const pass = s => (s.out.match(/# pass (\d+)/) || [])[1] ?? '?', fail = s => (s.out.match(/# fail (\d+)/) || [])[1] ?? '?';
        if (!after.ok) throw Error('Tests still failing after the change');
        return { text: `Changed the code in its own branch ${branch}; the tests now pass.`, evidence: [`Tests before: ${pass(before)} passed, ${fail(before)} failed. After: ${pass(after)} passed, ${fail(after)} failed.`, `Diff: ${stat}`, `Branch ${branch} in its own worktree; the shared checkout was not touched.`] };
    };
}
