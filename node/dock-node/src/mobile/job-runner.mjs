import { createHash } from 'node:crypto';
// One pass of a durable worker. `db.rpc(fn,args)` is the backend-only (service role) database client.
// Order is fixed: lease -> durable start claim (fenced) -> answer -> fenced finish. Nothing is replayed:
// a lost worker's started job is never re-leased by the database. Heartbeats only extend a lease; they
// do not make a late result acceptable once the lease has expired.
export async function runOneJob({ db, worker, secret, answer, ttlSeconds = 30, heartbeatMs = 10000, onEvent = () => { } }) {
    const rpc = async (fn, a) => { const r = await db.rpc(fn, a); if (r.error) throw Error(r.error.message); return r.data; };
    await rpc('mobile_worker_beat', { p_worker: worker, p_secret: secret }).catch(() => { }); // liveness only; says nothing about readiness to execute
    const job = await rpc('mobile_job_lease', { p_worker: worker, p_secret: secret, p_ttl_seconds: ttlSeconds });
    if (!job) return { ran: false };
    const fence = { p_task: job.task_id, p_worker: worker, p_secret: secret, p_epoch: job.epoch };
    if (await rpc('mobile_job_start', fence) !== true) return { ran: false, lost: 'start' };
    onEvent('started');
    let lost = false;
    const hb = setInterval(() => { rpc('mobile_job_heartbeat', { ...fence, p_ttl_seconds: ttlSeconds }).then(ok => { if (!ok) lost = true; }, () => { }); }, heartbeatMs);
    try {
        let text, evidence = [];
        try { const r = await answer({ taskId: job.task_id, ownerId: job.owner_id, input: job.input, context: job.context }); if (typeof r === 'string') text = r; else { text = r.text; evidence = (r.evidence ?? []).slice(0, 8).map(e => String(e).slice(0, 200)); } } catch { text = null; }
        const ok = text == null ? await rpc('mobile_job_finish', { ...fence, p_status: 'failed' })
            : await rpc('mobile_job_finish', { ...fence, p_status: 'delivered', p_digest: createHash('sha256').update(text).digest('hex'), p_summary: text.replace(/\s+/g, ' ').slice(0, 300), p_evidence: JSON.stringify(evidence) });
        return { ran: true, recorded: ok === true, lost };
    }
    finally { clearInterval(hb); }
}

// Worker-fleet liveness for the task page. Reachability only: a worker checked in recently. It is NOT proof that
// the worker can execute, is authenticated, or is isolated.
import { reachability } from './taskboard.mjs';
export async function workerState(tasks, now = Date.now()) {
    const last = await tasks.workerLastSeen().catch(() => null);
    return reachability({ configured: true, lastContactAt: last ? new Date(last).toISOString() : undefined, lastTestOk: true }, now);
}
