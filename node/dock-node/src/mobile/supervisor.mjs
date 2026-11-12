import { runOneJob } from './job-runner.mjs';
// LOCAL worker supervisor (a process loop, not a hosted service). Trusted configuration only: the worker id, secret, answer function
// and enforcement mode come from the process that starts it, never from a task or job payload.
// - Leases one job at a time through runOneJob (fenced). A job that started and was lost is NEVER replayed: the database makes it
//   'uncertain'; this loop never re-runs anything itself.
// - Errors from the database or network back off and retry the LEASE only. A started job whose finish call failed is left for the
//   database to mark uncertain after its lease expires.
// - Graceful stop: finish (and record) the job in hand, then exit. Hard crash: the process dies, the database owns the outcome.
export function assertWorkerConfig({ enforcement = 'aggregate-required', allowWeakLocal = false, env = process.env }) {
    if (enforcement === 'aggregate-required') return enforcement;
    if (enforcement === 'local-rlimit-only') {
        if (!allowWeakLocal) throw Error("enforcement 'local-rlimit-only' needs allowWeakLocal:true set by the trusted starter");
        if (env.NODE_ENV === 'production') throw Error("enforcement 'local-rlimit-only' is refused when NODE_ENV=production");
        return enforcement;
    }
    throw Error('unknown enforcement: ' + enforcement);
}
export async function superviseWorker({ db, worker, secret, answer, pollMs = 1000, maxBackoffMs = 15000, ttlSeconds = 30, signal, enforcement, allowWeakLocal, onEvent = () => { } }) {
    assertWorkerConfig({ enforcement, allowWeakLocal }); // fail closed before the first lease
    let backoff = pollMs, jobs = 0; const sleep = ms => new Promise(r => { const t = setTimeout(r, ms); signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });
    while (!signal?.aborted) {
        try {
            const r = await runOneJob({ db, worker, secret, answer, ttlSeconds, onEvent });
            if (r.ran) { jobs++; backoff = pollMs; onEvent('job-finished'); continue; }
            backoff = pollMs; await sleep(pollMs);
        } catch (e) { onEvent('error:' + String(e.message).slice(0, 80)); await sleep(backoff); backoff = Math.min(backoff * 2, maxBackoffMs); }
    }
    return { stopped: true, jobs };
}
// Restarts a crashed worker process a bounded number of times. It never touches jobs: replay is not its call.
export function restartPolicy({ maxRestarts = 3, windowMs = 60000 } = {}) { const t = []; return { allow: () => { const n = Date.now(); while (t.length && n - t[0] > windowMs) t.shift(); if (t.length >= maxRestarts) return false; t.push(n); return true; } }; }
