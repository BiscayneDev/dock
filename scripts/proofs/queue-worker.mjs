// Separate worker PROCESS for the proofs. REST rpc to the local fixture DB. Fictional repo, scripted agent (no model).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runOneJob } from '../../node/dock-node/src/mobile/job-runner.mjs';
import { worktreeAgent } from '../../node/dock-node/src/mobile/worktree-agent.mjs';
const rpc = async (fn, a) => { const r = await fetch('http://127.0.0.1:4597/rest/v1/rpc/' + fn, { method: 'POST', body: JSON.stringify(a) }); const j = await r.json(); return r.ok ? { data: j } : { error: { message: j.message } }; };
const [mode, worker] = process.argv.slice(2), secret = process.env.WORKER_SECRET;
const agent = mode === 'hang' ? async () => { console.log('IN_AGENT'); return new Promise(() => { }); }
    : worktreeAgent({ repoDir: process.env.FIX_REPO, worktreesRoot: process.env.FIX_WTS, enforcement: 'local-rlimit-only', editCmd: ['node', '-e', "require('fs').writeFileSync('math.mjs','export const add = (a, b) => a + b;\\n')"] });
const r = await runOneJob({ db: { rpc }, worker, secret, ttlSeconds: 2, heartbeatMs: 100000, answer: agent });
console.log('WORKER_DONE ' + JSON.stringify(r)); process.exit(0);
