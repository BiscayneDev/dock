import { runLimited } from './limits.mjs';
// Scoped file tools for light work (read, list, write) on ONE task worktree. The path check is NOT the boundary: a concurrent
// sandboxed task can swap a symlink between a check and a use, so a check in the trusted process would be a race.
// The operation itself runs INSIDE the namespace sandbox (only that worktree is mounted, as /work; no sibling, no home, no secrets), so a
// symlink that points anywhere else resolves to nothing or to read-only system files. Inside the sandbox a fixed helper additionally:
//  - rejects absolute paths, '..' segments, NUL and over-long paths up front,
//  - resolves with realpath and refuses anything that does not stay under /work (so symlinks to /usr/... are refused too),
//  - never follows a final symlink for writes (O_NOFOLLOW) and refuses writes through a symlinked directory,
//  - caps size. Paths and content go in as argv/env data, never interpolated into code.
// Residual: a swap between realpath and open inside the sandbox can only land in the same sandbox, not outside it.
const HELPER = `
const fs = require('fs'), path = require('path');
const [op, rel] = process.argv.slice(1), MAX = +process.env.MAXB, ROOT = '/work';
const bad = m => { process.stderr.write(m); process.exit(3); };
if (typeof rel !== 'string' || !rel || rel.length > 400 || rel.includes('\\0') || path.isAbsolute(rel) || rel.split('/').includes('..')) bad('path not allowed');
const target = path.join(ROOT, rel), under = p => p === ROOT || p.startsWith(ROOT + '/');
const parentReal = fs.realpathSync(path.dirname(target)); if (!under(parentReal)) bad('path leaves the workspace');
if (op === 'read' || op === 'list') { const real = fs.realpathSync(target); if (!under(real)) bad('path leaves the workspace');
  if (op === 'list') process.stdout.write(JSON.stringify(fs.readdirSync(real, { withFileTypes: true }).map(d => ({ name: d.name, dir: d.isDirectory(), link: d.isSymbolicLink() }))));
  else { const st = fs.statSync(real); if (!st.isFile()) bad('not a file'); if (st.size > MAX) bad('file too large'); process.stdout.write(fs.readFileSync(real)); } }
else if (op === 'write') { const data = Buffer.from(process.env.DATA_B64 || '', 'base64'); if (data.length > MAX) bad('content too large');
  const fd = fs.openSync(path.join(parentReal, path.basename(target)), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o644); fs.writeSync(fd, data); fs.closeSync(fd); process.stdout.write('ok'); }
else bad('unknown operation');`;
export function scopedFiles({ worktree, enforcement, limits = {}, maxBytes = 1_000_000, detect, signal = undefined }) {
    const run = (op, rel, env = {}) => String(rel).includes('\0') ? Promise.resolve({ ok: false, stderr: 'path not allowed' }) : runLimited({ worktree, cmd: ['node', '-e', HELPER, op, String(rel)], env: { MAXB: maxBytes, ...env }, enforcement, detect, signal, limits: { wallMs: 10000, cpuSeconds: 5, memoryBytes: 2 * 1024 ** 3, ...limits } });
    const res = r => { if (!r.ok) throw Error(r.refused ? r.stderr : ((r.stderr.match(/ENOENT|ELOOP|EACCES|ENOTDIR|path not allowed|path leaves the workspace|file too large|content too large|not a file|unknown operation/) || ['failed'])[0])); return r.stdout; };
    return {
        read: async rel => res(await run('read', rel)),
        list: async rel => JSON.parse(res(await run('list', rel || '.'))),
        write: async (rel, text) => res(await run('write', rel, { DATA_B64: Buffer.from(String(text)).toString('base64') })),
    };
}
