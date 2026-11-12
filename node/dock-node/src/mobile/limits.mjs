import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmdirSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sandboxArgs } from './sandbox.mjs';
// Resource limits for untrusted task code. Two enforcement levels, never conflated:
//   'aggregate-required' (DEFAULT, fail closed): needs a delegated cgroup v2 (memory + pids + cpu for the WHOLE job tree).
//       If it cannot be created, the job is refused before any code runs. This is the only mode meant for a hosted worker.
//   'local-rlimit-only' (explicit, weaker): per-PROCESS rlimits via prlimit + a wall-clock kill of the whole pid namespace +
//       a polling disk watcher. NOT per-job totals: N processes may each use the per-process limit. Evidence says so.
// Never relied on as a pid cap: RLIMIT_NPROC is per real uid, so it is only a secondary brake. Process creation is bounded by
// the wall-clock kill of the pid namespace (bwrap's init dies, the kernel kills every process inside it).
// The disk watcher polls: it is detection + termination, NOT a hard ceiling. A writer can overshoot between polls
// (about writeRate x pollMs) and RLIMIT_FSIZE only caps single files.
export const DEFAULT_LIMITS = { wallMs: 60000, cpuSeconds: 30, memoryBytes: 2 * 1024 ** 3, fileBytes: 64 * 1024 ** 2, openFiles: 256, diskBytes: 256 * 1024 ** 2, pollMs: 100 };
export function detectAggregate(cgroupRoot = '/sys/fs/cgroup') {
    try {
        const own = readFileSync('/proc/self/cgroup', 'utf8').trim().split('\n').find(l => l.startsWith('0::'))?.slice(3) ?? '/', base = join(cgroupRoot, own);
        const ctl = readFileSync(join(base, 'cgroup.controllers'), 'utf8').split(/\s+/);
        for (const c of ['memory', 'pids', 'cpu']) if (!ctl.includes(c)) return { available: false, reason: `controller ${c} not delegated here` };
        const probe = join(base, 'dock-probe-' + process.pid); mkdirSync(probe); rmdirSync(probe);
        return { available: true, base };
    } catch (e) { return { available: false, reason: 'cannot create a cgroup here: ' + (e.code || e.message) }; }
}
const dirBytes = d => { let n = 0; try { for (const e of readdirSync(d)) { const p = join(d, e), s = lstatSync(p); n += s.isDirectory() ? dirBytes(p) : s.size; } } catch { } return n; };
export function checkEnforcement(mode = 'aggregate-required', env = {}) {
    if (mode === 'local-rlimit-only') return { ok: true, level: 'per-process only (NOT aggregate)', aggregate: false };
    if (mode !== 'aggregate-required') return { ok: false, reason: 'unknown enforcement mode: ' + mode };
    const d = (env.detect ?? detectAggregate)();
    return d.available ? { ok: true, level: 'aggregate (cgroup v2: memory, pids, cpu for the whole job tree)', aggregate: true, base: d.base } : { ok: false, reason: 'aggregate enforcement unavailable (' + d.reason + ')' };
}
// Per-job cgroup v2. The job's whole process tree is placed in it BEFORE the sandbox starts (the trusted launcher shell joins, then execs),
// so nothing the job forks can be outside it. Cleanup kills everything in the group, waits for it to empty, then removes it.
// Kernel enforcement is only as real as the host's delegated cgroup; on this sandbox it cannot be created, so the kernel side is UNPROVEN here.
export function createJobCgroup({ base, name, memoryMax, pidsMax, cpuMax = '100000 100000' }) {
    const path = join(base, name); mkdirSync(path);
    try {
        writeFileSync(join(path, 'memory.max'), String(memoryMax)); try { writeFileSync(join(path, 'memory.swap.max'), '0'); } catch { }
        writeFileSync(join(path, 'pids.max'), String(pidsMax)); writeFileSync(join(path, 'cpu.max'), cpuMax);
    } catch (e) { try { rmdirSync(path); } catch { } throw Error('cgroup limits could not be set: ' + (e.code || e.message)); }
    const procs = () => { try { return readFileSync(join(path, 'cgroup.procs'), 'utf8').split('\n').filter(Boolean).map(Number); } catch { return []; } };
    return {
        path, procs,
        killAll() { try { writeFileSync(join(path, 'cgroup.kill'), '1'); } catch { for (const p of procs()) { try { process.kill(p, 'SIGKILL'); } catch { } } } },
        async remove(waitMs = 3000) { this.killAll(); for (let t = 0; t < waitMs && procs().length; t += 50) await new Promise(r => setTimeout(r, 50)); const left = procs().length; try { rmdirSync(path); } catch (e) { return { removed: false, left, why: e.code }; } return { removed: true, left }; },
        stats() { const rd = f => { try { return readFileSync(join(path, f), 'utf8').trim(); } catch { return null; } }; return { memoryPeak: rd('memory.peak'), memoryEvents: rd('memory.events'), pidsEvents: rd('pids.events') }; },
    };
}
// Runs cmd inside the namespace sandbox under the given limits. Returns { ok, status, stdout, stderr, killedBy?, enforcement, peakDiskBytes }.
export async function runLimited({ worktree, cmd, env, socketDir, limits = {}, enforcement = 'aggregate-required', detect, cgroupName = 'dock-job-' + process.pid + '-' + Date.now() }) {
    const gate = checkEnforcement(enforcement, { detect });
    if (!gate.ok) return { ok: false, refused: true, status: null, stdout: '', stderr: gate.reason, enforcement: 'refused' };
    const L = { ...DEFAULT_LIMITS, ...limits };
    const pr = ['--cpu=' + L.cpuSeconds, '--as=' + L.memoryBytes, '--fsize=' + L.fileBytes, '--nofile=' + L.openFiles, '--core=0', '--', 'bwrap'];
    let cg = null, argv0 = 'prlimit', argv = [...pr, ...sandboxArgs({ worktree, cmd, env, socketDir })];
    if (gate.aggregate) {
        try { cg = createJobCgroup({ base: gate.base, name: cgroupName, memoryMax: L.memoryBytes, pidsMax: L.maxPids ?? 128 }); }
        catch (e) { return { ok: false, refused: true, status: null, stdout: '', stderr: 'Refused before running anything: ' + e.message, enforcement: 'refused' }; }
        // trusted shell joins the cgroup first; if the join fails nothing is exec'd
        argv0 = 'sh'; argv = ['-c', 'echo $$ > "$0/cgroup.procs" && exec "$@"', cg.path, 'prlimit', ...argv];
    }
    const child = spawn(argv0, argv, { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '', err = '', killedBy = null, peak = 0; const kill = why => { if (killedBy) return; killedBy = why; cg?.killAll(); try { process.kill(-child.pid, 'SIGKILL'); } catch { } };
    child.stdout.on('data', d => { if ((out += d).length > 2e6) kill('output'); }); child.stderr.on('data', d => { if ((err += d).length > 2e6) kill('output'); });
    const wall = setTimeout(() => kill('wall-clock'), L.wallMs), poll = setInterval(() => { peak = Math.max(peak, dirBytes(worktree)); if (peak > L.diskBytes) kill('disk-ceiling (detected by polling)'); }, L.pollMs);
    const status = await new Promise(res => { child.on('close', c => res(c)); child.on('error', () => res(null)); });
    clearTimeout(wall); clearInterval(poll); peak = Math.max(peak, dirBytes(worktree));
    let cleanup; if (cg) { const st = cg.stats(); cleanup = await cg.remove(); cleanup = { ...cleanup, ...st }; }
    return { ok: status === 0 && !killedBy && (!cleanup || cleanup.removed), status, stdout: out, stderr: err, killedBy, enforcement: gate.level, peakDiskBytes: peak, limits: L, cgroup: cleanup };
}
