// LOCAL, FICTIONAL. Proves the fail-closed gate and what rlimit-only enforcement does and does not do.
// Every payload is intrinsically small and finite even if all enforcement failed (bounded loop, <=200MB, 40 short sleeps, <=40MB).
// NOT proven: aggregate per-job enforcement (no delegable cgroup here), hosted isolation, disk as a hard ceiling.
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { runLimited, detectAggregate } from '../../node/dock-node/src/mobile/limits.mjs';
const mk = () => mkdtempSync(join(tmpdir(), 'fictional-limits-')), W = mk(), R = { enforcement: 'local-rlimit-only' }, out = {};
try {
    out.aggregateAvailableHere = detectAggregate();
    // 1. default fails closed: nothing runs
    const refused = await runLimited({ worktree: W, cmd: ['sh', '-c', 'echo ran > /work/ran'] }); assert.equal(refused.refused, true); assert.ok(!existsSync(join(W, 'ran'))); out.defaultRefusedBeforeRunning = refused.stderr;
    // 2. containment is active before any adversarial payload
    writeFileSync(join(tmpdir(), 'fictional-outside-secret'), 'x');
    const c = await runLimited({ worktree: W, cmd: ['sh', '-c', 'cat /tmp/fictional-outside-secret 2>&1; ls /home 2>&1; echo contained'], ...R, limits: { wallMs: 5000 } }); assert.ok(!/^x/m.test(c.stdout) && c.stdout.includes('contained') && !c.stdout.includes('sandbox'), c.stdout); out.containmentActive = true;
    // 3. runaway CPU loop (bounded to 300M iterations either way): killed by the CPU rlimit
    const t0 = Date.now(); const cpu = await runLimited({ worktree: W, cmd: ['sh', '-c', 'i=0; while [ $i -lt 300000000 ]; do i=$((i+1)); done; echo finished'], ...R, limits: { cpuSeconds: 1, wallMs: 8000 } });
    assert.ok(!cpu.stdout.includes('finished') && !cpu.ok, JSON.stringify(cpu).slice(0, 300)); out.cpuLoop = { stopped: true, by: cpu.killedBy ?? 'RLIMIT_CPU (signal)', ms: Date.now() - t0 };
    // 4. memory hog (hard-bounded at 200MB total) under a 96MB address-space rlimit
    const mem = await runLimited({ worktree: W, cmd: ['python3', '-c', 'a=[]\nfor i in range(25):\n a.append(bytearray(8*1024*1024))\nprint("allocated-all")'], ...R, limits: { memoryBytes: 96 * 1024 ** 2, wallMs: 8000 } });
    assert.ok(!mem.stdout.includes('allocated-all') && !mem.ok, mem.stdout + mem.stderr.slice(0, 200)); out.memoryHog = 'refused by per-process address-space rlimit (not an aggregate cap)';
    // 5. bounded process storm: exactly 40 sleepers of 6s. The wall-clock kill takes the pid namespace down; nothing is left behind.
    const t1 = Date.now(); const storm = await runLimited({ worktree: W, cmd: ['sh', '-c', 'for i in $(seq 1 40); do sleep 6.123 & done; wait'], ...R, limits: { wallMs: 1500 } });
    assert.equal(storm.killedBy, 'wall-clock'); await new Promise(r => setTimeout(r, 400));
    let left = ''; try { left = execFileSync('pgrep', ['-f', 'sleep 6.123'], { encoding: 'utf8' }).trim(); } catch { }
    assert.equal(left, '', 'leftover processes: ' + left); out.processStorm = { killedBy: storm.killedBy, ms: Date.now() - t1, leftoverProcesses: 0, note: 'bounded by wall-clock + pid-namespace teardown, NOT by an NPROC pid cap' };
    // 6a. one oversized file (<=40MB attempted) under an 8MB RLIMIT_FSIZE
    const big = await runLimited({ worktree: W, cmd: ['sh', '-c', 'dd if=/dev/zero of=/work/big bs=1M count=40 2>&1; echo done-writing'], ...R, limits: { fileBytes: 8 * 1024 ** 2, wallMs: 8000 } });
    const bigSize = existsSync(join(W, 'big')) ? readFileSync(join(W, 'big')).length : 0; assert.ok(bigSize <= 8 * 1024 ** 2, 'file size ' + bigSize); out.singleFileCap = { attempted: '40MB', wrote: bigSize };
    rmSync(join(W, 'big'), { force: true });
    // 6b. many files (<=40MB total attempted, 1MB each) against a 12MB polling ceiling: detection + kill, with overshoot reported
    const disk = await runLimited({ worktree: W, cmd: ['sh', '-c', 'for i in $(seq 1 40); do dd if=/dev/zero of=/work/f$i bs=1M count=1 2>/dev/null; sleep 0.05; done; echo done-writing'], ...R, limits: { diskBytes: 12 * 1024 ** 2, pollMs: 50, wallMs: 10000 } });
    assert.ok(disk.killedBy?.startsWith('disk-ceiling') && !disk.stdout.includes('done-writing'), JSON.stringify({ k: disk.killedBy, s: disk.stdout }));
    out.diskWatcher = { ceilingMB: 12, peakMB: +(disk.peakDiskBytes / 1048576).toFixed(1), killedBy: disk.killedBy, limitation: 'polling detection + termination, not a hard ceiling: a fast writer overshoots between polls' };
    out.evidenceLabel = 'per-process rlimits + wall-clock namespace kill + polling disk watcher; NOT aggregate per-job enforcement; hosted isolation unproven';
    console.log(JSON.stringify(out, null, 1));
} finally { rmSync(W, { recursive: true, force: true }); rmSync(join(tmpdir(), 'fictional-outside-secret'), { force: true }); }
