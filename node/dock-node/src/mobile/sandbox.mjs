import { spawnSync } from 'node:child_process';
// Local isolation boundary for untrusted task code (agent edits, test runs). Linux user+mount+pid+net+ipc+uts
// namespaces via bubblewrap: the process sees only system binaries (read-only), an empty /tmp, and ITS OWN worktree
// (read-write) mounted at /work. No parent home, no sibling worktrees, no parent env, no network, no parent pids.
// This is an equivalent of the namespace design on one machine; it is NOT a hosted sandbox (no cgroup limits here
// beyond the wall-clock timeout) and the trusted worker still does the git and ledger work outside it.
export function sandboxArgs({ worktree, cmd, env = {}, socketDir = undefined }) {
    if (!worktree?.startsWith('/') || !Array.isArray(cmd) || !cmd.length) throw Error('worktree and cmd required');
    const a = ['--unshare-all', '--die-with-parent', '--new-session', '--clearenv', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', worktree, '/work', '--chdir', '/work', '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'HOME', '/tmp'];
    if (socketDir) a.push('--ro-bind', socketDir, '/run/model'); // the one allowed channel: a unix socket to the trusted model proxy
    for (const [k, v] of Object.entries(env)) a.push('--setenv', k, String(v));
    return [...a, '--', ...cmd];
}
export function runSandboxed({ worktree, cmd, env, socketDir, timeoutMs = 60000 }) {
    const r = spawnSync('bwrap', sandboxArgs({ worktree, cmd, env, socketDir }), { encoding: 'utf8', timeout: timeoutMs, env: { PATH: '/usr/bin:/bin' } }); // parent env is not passed even to bwrap
    return { ok: r.status === 0, status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
