// REAL: Postgres draft migrations 0023+0024, job-runner, real child processes killed with SIGKILL.
// FICTIONAL: tasks and "model" (a local function; no inference, no cost). Not deployed, not a host.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const URI = process.env.PGURI, PSQL = '/usr/lib/postgresql/14/bin/psql', ex = promisify(execFile);
const lit = v => v === null || v === undefined ? 'null' : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
export const psql = async q => (await ex(PSQL, [URI, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', q])).stdout.trim();
const rawRpc = async (fn, a) => { try { const out = await psql(`select ${fn}(${Object.entries(a).map(([k, v]) => `${k} := ${lit(v)}`).join(',')})`); return { data: out === 't' ? true : out === 'f' ? false : out === '' ? null : out.startsWith('{') ? JSON.parse(out) : out }; } catch (e) { return { error: { message: e.message } }; } };
// PROOF PLUMBING ONLY: the trusted backend registers workers (owner-authorized in a real deployment). Proofs register a
// worker on first use for the fixed fictional owner/workspace and inject its secret. Names starting 'infra' are never registered.
export const secretFor = n => ('proof-secret-' + n).padEnd(40, 'x');
const known = new Set();
export const db = {
    sql: async q => psql(q),
    rpc: async (fn, a) => {
        if (a.p_worker && a.p_secret == null && !a.p_worker.startsWith('infra') && /^mobile_(job_(lease|start|heartbeat|finish)|worker_beat)$/.test(fn)) {
            if (!known.has(a.p_worker)) { await rawRpc('mobile_worker_register', { p_worker: a.p_worker, p_owner: '11111111-1111-1111-1111-111111111111', p_workspace: '22222222-2222-2222-2222-222222222222', p_secret: secretFor(a.p_worker) }); known.add(a.p_worker); }
            a = { ...a, p_secret: secretFor(a.p_worker) };
        }
        return rawRpc(fn, a);
    },
};
