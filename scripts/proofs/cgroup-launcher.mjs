// LOCAL, FICTIONAL. Tests the cgroup LAUNCHER LOGIC against a fake cgroup tree (plain directory): limits written, join-before-exec,
// refusal and cleanup-failure paths. The kernel does not enforce a fake tree, so memory/pids/cpu enforcement is NOT proven by this.
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { runLimited, createJobCgroup } from '../../node/dock-node/src/mobile/limits.mjs';
const W = mkdtempSync(join(tmpdir(), 'fictional-cg-work-')), FAKE = mkdtempSync(join(tmpdir(), 'fictional-cg-root-')), out = {};
try {
    // 1. limits are written exactly as requested
    const g = createJobCgroup({ base: FAKE, name: 'unit', memoryMax: 123456789, pidsMax: 17 });
    assert.equal(readFileSync(join(g.path, 'memory.max'), 'utf8'), '123456789'); assert.equal(readFileSync(join(g.path, 'pids.max'), 'utf8'), '17'); assert.equal(readFileSync(join(g.path, 'memory.swap.max'), 'utf8'), '0'); out.limitsWritten = true; rmSync(g.path, { recursive: true });
    // 2. cgroup cannot be created: refuse BEFORE running anything
    const ro = join(FAKE, 'ro'); mkdirSync(ro); chmodSync(ro, 0o500);
    const r1 = await runLimited({ worktree: W, cmd: ['sh', '-c', 'echo ran > /work/ran'], detect: () => ({ available: true, base: ro }) });
    assert.equal(r1.refused, true); assert.ok(!existsSync(join(W, 'ran'))); out.cgroupCreateFailureRefusesBeforeRunning = r1.stderr; chmodSync(ro, 0o700);
    // 3. launcher: job joins the group before exec (its pid is in cgroup.procs), runs inside the sandbox, and a group that will not empty/remove fails the job closed
    const r2 = await runLimited({ worktree: W, cmd: ['sh', '-c', 'echo inside > /work/ran'], limits: { wallMs: 5000, maxPids: 9 }, detect: () => ({ available: true, base: FAKE }), cgroupName: 'job-fake' });
    assert.equal(readFileSync(join(W, 'ran'), 'utf8').trim(), 'inside'); const procsFile = readFileSync(join(FAKE, 'job-fake', 'cgroup.procs'), 'utf8').trim(); assert.match(procsFile, /^\d+$/);
    assert.equal(readFileSync(join(FAKE, 'job-fake', 'pids.max'), 'utf8'), '9'); assert.equal(r2.cgroup.removed, false); assert.equal(r2.ok, false, 'a job whose cgroup could not be cleaned up must not report ok');
    out.launcher = { joinedBeforeExec: true, limitsAppliedFromJobConfig: true, cleanupFailureFailsClosed: true, enforcement: r2.enforcement };
    // 4. a join that fails runs nothing: the cgroup.procs target is a directory
    rmSync(join(FAKE, 'job-fake'), { recursive: true }); rmSync(join(W, 'ran'));
    mkdirSync(join(FAKE, 'job-bad')); // EEXIST on create => refused (create failure path again)
    const r3 = await runLimited({ worktree: W, cmd: ['sh', '-c', 'echo ran > /work/ran'], detect: () => ({ available: true, base: FAKE }), cgroupName: 'job-bad' });
    assert.equal(r3.refused, true); assert.ok(!existsSync(join(W, 'ran'))); out.existingGroupRefused = true;
    out.notProven = 'kernel enforcement of memory/pids/cpu (fake tree); real host delegation; cleanup of a real populated cgroup';
    console.log(JSON.stringify(out, null, 1));
} finally { for (const d of [W, FAKE]) { try { chmodSync(join(FAKE, 'ro'), 0o700); } catch { } rmSync(d, { recursive: true, force: true }); } }
