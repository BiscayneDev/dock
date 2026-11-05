// Fresh private object database per execution, never shared sibling git history.
// This creates source, not a security boundary. The caller MUST place each job
// into a different verified sandbox identity; filesystem modes alone are not
// isolation from a sibling with the same UID on the same host.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, realpath, lstat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
export async function committedSnapshot({ repo, sha, maxBytes = 20 * 1024 * 1024, allowedPaths }) {
    if (!/^[a-f0-9]{40}$/.test(sha) || !Array.isArray(allowedPaths) || !allowedPaths.length)
        throw Error('Bound source grant required');
    const { stdout: head } = await exec('git', ['-C', repo, 'rev-parse', sha + '^{commit}']);
    if (head.trim() !== sha)
        throw Error('Commit mismatch');
    const { stdout: raw } = await exec('git', ['-C', repo, 'ls-tree', '-rz', '--full-tree', sha], { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 });
    const files = [];
    let bytes = 0;
    for (const item of raw.toString().split('\0').filter(Boolean)) {
        const [header, path] = item.split('\t');
        const [mode, kind] = header.split(' ');
        if (!allowedPaths.some(p => path === p || path.startsWith(p.replace(/\/$/, '') + '/')))
            continue;
        if (!['100644', '100755'].includes(mode) || kind !== 'blob')
            throw Error('Symlink/submodule source rejected');
        if (path.split('/').some(p => p === '..' || p === '.' || p === '.git') || path.startsWith('/') || /(^|\/)(\.env(?:\.|$)|node_modules|credentials|\.ssh|\.aws|\.npmrc)/i.test(path) || /\.(pem|key|p12|db|sqlite|sqlite3)$/i.test(path))
            throw Error('Credential/build source rejected');
        const { stdout: data } = await exec('git', ['-C', repo, 'show', sha + ':' + path], { encoding: 'buffer', maxBuffer: maxBytes });
        bytes += data.length;
        if (bytes > maxBytes)
            throw Error('Source grant too large');
        files.push({ path, mode, base64: data.toString('base64'), sha256: createHash('sha256').update(data).digest('hex') });
    }
    if (!files.length)
        throw Error('Empty source grant');
    return { sha, files, bytes };
}
export async function materializePrivateSource({ root, snapshot, executionId, attestation }) {
    if (!attestation?.separateSandbox || attestation.executionId !== executionId || !attestation.noSiblingMounts || !attestation.noControllerCredentials)
        throw Error('Independent sandbox attestation required');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(executionId))
        throw Error('Invalid execution');
    const base = join(root, executionId, 'base'), work = join(root, executionId, 'work');
    await mkdir(base, { recursive: true, mode: 0o700 });
    // refuse reuse: no inherited checkout, alternates or preexisting .git
    const { readdir } = await import('node:fs/promises');
    if ((await readdir(base)).length)
        throw Error('Fresh execution path required');
    for (const f of snapshot.files) {
        const p = resolve(base, f.path);
        if (!p.startsWith(resolve(base) + sep) || f.path.split('/').includes('.git'))
            throw Error('Unsafe file');
        const data = Buffer.from(f.base64, 'base64');
        if (createHash('sha256').update(data).digest('hex') !== f.sha256)
            throw Error('Source digest mismatch');
        await mkdir(join(p, '..'), { recursive: true, mode: 0o700 });
        await writeFile(p, data, { flag: 'wx', mode: f.mode === '100755' ? 0o700 : 0o600 });
    }
    const git = (...a) => exec('git', ['-C', base, ...a]);
    await git('init', '-b', 'base');
    await git('add', '.');
    await git('-c', 'user.name=Dock', '-c', 'user.email=dock@localhost', 'commit', '-m', 'Committed source ' + snapshot.sha);
    await git('worktree', 'add', work, '-b', 'task/' + executionId);
    return { executionId, work, baseSha: snapshot.sha, gitCommonDir: await realpath(join(base, '.git')), sourceFiles: snapshot.files.length, securityBoundary: 'external-attested-sandbox' };
}
