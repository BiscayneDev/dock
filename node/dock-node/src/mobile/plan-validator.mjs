// A plan is DATA proposed by something untrusted (a model). This validates its shape before anything runs. It is not the boundary:
// the file operations still run inside the namespace sandbox and re-check containment at execution (scoped-files.mjs).
// A plan can only say which of three file operations to do on which relative path with what text. It cannot carry or select
// enforcement, limits, credentials, workspace or owner identity, a router/model, or a command: unknown keys reject the whole plan.
export const PLAN_LIMITS = { maxSteps: 20, maxPathLen: 200, maxTextBytes: 100_000, maxTotalBytes: 300_000 };
const OPS = new Set(['read', 'list', 'write']);
const reject = reason => ({ ok: false, reason });
export function validatePlan(raw, L = PLAN_LIMITS) {
    if (!Array.isArray(raw)) return reject('plan is not a list');
    if (raw.length === 0) return reject('plan is empty');
    if (raw.length > L.maxSteps) return reject('plan has too many steps');
    const steps = []; let total = 0;
    for (const [i, s] of raw.entries()) {
        const at = `step ${i + 1}`;
        if (!s || typeof s !== 'object' || Array.isArray(s) || Object.getPrototypeOf(s) !== Object.prototype) return reject(`${at} is not a plain object`);
        const keys = Object.keys(s); if (keys.some(k => !['op', 'path', 'text'].includes(k))) return reject(`${at} has a field that is not allowed`);
        if (!OPS.has(s.op)) return reject(`${at} has an operation that is not allowed`);
        const p = s.path;
        if (typeof p !== 'string' || !p || p.length > L.maxPathLen) return reject(`${at} has a bad path`);
        if (/[\0\\]/.test(p) || /[\x00-\x1f]/.test(p) || p.startsWith('/') || p.endsWith('/') && s.op === 'write') return reject(`${at} has a path that is not allowed`);
        const segs = p.split('/'); if (segs.some(x => x === '' || x === '.' || x === '..')) return reject(`${at} has a path that is not allowed`);
        if (segs.some(x => /^\.git/i.test(x))) return reject(`${at} touches git metadata`); // hooks and config would run or change code outside the plan
        if (s.op === 'write') { if (typeof s.text !== 'string') return reject(`${at} has no text`); const b = Buffer.byteLength(s.text); if (b > L.maxTextBytes) return reject(`${at} is too large`); total += b; if (total > L.maxTotalBytes) return reject('plan is too large'); steps.push({ op: 'write', path: p, text: s.text }); }
        else { if ('text' in s) return reject(`${at} has a field that is not allowed`); steps.push({ op: s.op, path: p }); }
    }
    return { ok: true, steps };
}
