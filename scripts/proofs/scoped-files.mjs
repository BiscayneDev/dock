// LOCAL, FICTIONAL. Scoped file access that does not rely on a path check alone: symlinks, traversal and writes outside the worktree.
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { scopedFiles } from '../../node/dock-node/src/mobile/scoped-files.mjs';
const root = mkdtempSync(join(tmpdir(), 'fictional-sf-')), A = join(root, 'wt-a'), B = join(root, 'wt-b'); mkdirSync(A); mkdirSync(B); mkdirSync(join(A, 'src'));
writeFileSync(join(root, 'parent-secret'), 'PARENT_SECRET'); writeFileSync(join(B, 'sibling.txt'), 'SIBLING_SECRET'); writeFileSync(join(A, 'src', 'a.txt'), 'hello');
symlinkSync(join(B, 'sibling.txt'), join(A, 'to-sibling')); symlinkSync(join(root, 'parent-secret'), join(A, 'to-parent')); symlinkSync('/usr/bin/env', join(A, 'to-system')); symlinkSync(root, join(A, 'dir-out')); symlinkSync('src', join(A, 'dir-in'));
const f = scopedFiles({ worktree: A, enforcement: 'local-rlimit-only' }), out = {}, denies = async (p, re) => { await assert.rejects(p, re); };
try {
    assert.equal(await f.read('src/a.txt'), 'hello'); out.normalRead = true;
    await f.write('src/new.txt', 'written'); assert.equal(readFileSync(join(A, 'src', 'new.txt'), 'utf8'), 'written'); assert.deepEqual((await f.list('src')).map(e => e.name).sort(), ['a.txt', 'new.txt']); out.normalWriteList = true;
    for (const p of ['../wt-b/sibling.txt', '/etc/passwd', 'src/../../parent-secret', 'a\0b', 'x/'.repeat(300)]) await denies(f.read(p), /not allowed|failed|ENOENT/); out.traversalAbsoluteNulLong = 'refused';
    for (const p of ['to-sibling', 'to-parent', 'to-system', 'dir-out/parent-secret']) await denies(f.read(p), /leaves the workspace|ENOENT|failed/); out.symlinksOut = 'refused (target not visible in the sandbox and refused by realpath)';
    assert.equal(await f.read('dir-in/a.txt'), 'hello'); out.symlinkInsideWorkspaceFollowed = true;
    await denies(f.write('dir-out/pwned', 'x'), /leaves the workspace|ENOENT|failed/); assert.ok(!existsSync(join(root, 'pwned')));
    await denies(f.write('to-parent', 'OVERWRITE'), /ELOOP|failed|leaves/); assert.equal(readFileSync(join(root, 'parent-secret'), 'utf8'), 'PARENT_SECRET'); await denies(f.write('to-sibling', 'OVERWRITE'), /ELOOP|failed|leaves/); assert.equal(readFileSync(join(B, 'sibling.txt'), 'utf8'), 'SIBLING_SECRET'); out.writesThroughSymlinks = 'refused, outside files unchanged';
    await denies(f.write('src/big.txt', 'z'.repeat(2_000_000)), /failed|too large|E2BIG|spawn/); out.sizeCap = true;
    await assert.rejects(scopedFiles({ worktree: A }).read('src/a.txt'), /aggregate enforcement unavailable/); out.defaultEnforcementFailsClosed = true;
    out.limits = 'runs under the same limit layer, so this is as strong as that layer (per-process rlimits + namespace sandbox here); hosted isolation unproven';
    console.log(JSON.stringify(out, null, 1));
} finally { rmSync(root, { recursive: true, force: true }); }
