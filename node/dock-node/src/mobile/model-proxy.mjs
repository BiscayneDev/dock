import http from 'node:http';
import { mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The ONLY outbound channel an untrusted worker gets: a unix socket served by the trusted side.
// - Upstream is one fixed URL from server config. The task never supplies a URL, host, path prefix or redirect.
// - Only POST /v1/chat/completions. Anything else (other paths, absolute-URI requests, CONNECT, other methods) is refused.
// - Provider credentials live here, outside the sandbox. The task's own Authorization and identity headers are dropped.
// - Identity and budget come from the server-side job record passed in at creation, never from the request.
// - The model is NOT chosen here and never by the task: the proxy always sends `routerModel` (the authorized router value,
//   Dock's `auto`, so Jev routes) and ignores any model the task names. Output tokens are clamped, body size is capped.
// - maxCalls is an ATTEMPT cap per job. It is not a dollar cap. A real provider path must use the existing request-bound
//   quote-then-serve transport (shipyard-model.mjs) for cost bounds; that is unapproved and unproven here. Redirects are not followed.
export function createModelProxy({ upstream, apiKey, identity, routerModel = 'auto', maxCalls = 3, maxBodyBytes = 16_000, maxOutputTokens = 512, fetchImpl = fetch }) {
    const u = new URL(upstream); if (!/^https?:$/.test(u.protocol)) throw Error('bad upstream');
    let calls = 0; const log = [];
    const server = http.createServer(async (req, res) => {
        const refuse = (code, why) => { log.push({ refused: why }); res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: why })); };
        if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return refuse(404, 'not an allowed route');
        let size = 0; const chunks = [];
        for await (const c of req) { size += c.length; if (size > maxBodyBytes) { req.destroy(); return refuse(413, 'body too large'); } chunks.push(c); }
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return refuse(400, 'bad json'); }
        if (!Array.isArray(body.messages) || body.messages.length > 20 || body.stream === true) return refuse(400, 'bad request shape');
        if (++calls > maxCalls) return refuse(429, 'job model budget exhausted');
        const out = { model: routerModel, messages: body.messages.map(m => ({ role: ['system', 'user', 'assistant'].includes(m.role) ? m.role : 'user', content: String(m.content ?? '').slice(0, 8000) })), max_tokens: Math.min(Number(body.max_tokens) || maxOutputTokens, maxOutputTokens), user: identity.jobId };
        try {
            const r = await fetchImpl(new URL('/v1/chat/completions', u), { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey, 'x-dock-owner': identity.ownerId, 'x-dock-job': identity.jobId }, body: JSON.stringify(out), signal: AbortSignal.timeout(20000) });
            log.push({ forwarded: true, status: r.status }); res.writeHead(r.status === 200 ? 200 : 502, { 'content-type': 'application/json' }); res.end(r.status === 200 ? await r.text() : JSON.stringify({ error: 'upstream refused' }));
        } catch { refuse(502, 'upstream unavailable'); }
    });
    return {
        log, calls: () => calls,
        async listen() { const dir = mkdtempSync(join(tmpdir(), 'dock-proxy-')); chmodSync(dir, 0o700); const path = join(dir, 'model.sock'); await new Promise(r => server.listen(path, r)); chmodSync(path, 0o600); return { dir, path }; },
        close: dir => { server.close(); if (dir) rmSync(dir, { recursive: true, force: true }); },
    };
}
