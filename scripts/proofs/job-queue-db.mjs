// REAL: Postgres draft migrations 0023+0024, job-runner, real child processes killed with SIGKILL.
// FICTIONAL: tasks and "model" (a local function; no inference, no cost). Not deployed, not a host.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const URI = process.env.PGURI, PSQL = '/usr/lib/postgresql/14/bin/psql', ex = promisify(execFile);
const lit = v => v === null || v === undefined ? 'null' : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const psql = async q => (await ex(PSQL, [URI, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', q])).stdout.trim();
export const db = { sql: async q => psql(q), rpc: async (fn, a) => { try { const out = await psql(`select ${fn}(${Object.entries(a).map(([k, v]) => `${k} := ${lit(v)}`).join(',')})`); return { data: out === 't' ? true : out === 'f' ? false : out === '' ? null : out.startsWith('{') ? JSON.parse(out) : out }; } catch (e) { return { error: { message: e.message } }; } } };
