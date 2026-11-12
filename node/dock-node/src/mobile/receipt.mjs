// Backend-signed completion receipts. The Dock backend holds the Ed25519 private key; the phone
// bridge and any task/agent hold only the public key, so neither can fabricate completion.
// A 64-hex digest alone proves nothing: only a valid signature over the exact scope counts.
import { sign, verify, createHash } from 'node:crypto';
const canon = r => JSON.stringify([r.v, r.ownerId, r.workspaceId, r.sessionId, r.requestId, r.executionId ?? null, r.status, r.replyDigest ?? null, r.issuedAt]);
export const replyDigest = text => createHash('sha256').update(text).digest('hex');
export function signReceipt(privateKey, r) { const body = { v: 1, ...r }; return { ...body, sig: sign(null, Buffer.from(canon(body)), privateKey).toString('base64') }; }
export function verifyReceipt(publicKey, receipt, expected, { now = Date.now(), maxAgeMs = 24 * 3600_000 } = {}) {
    if (!receipt || receipt.v !== 1 || typeof receipt.sig !== 'string') return null;
    for (const k of ['ownerId', 'workspaceId', 'sessionId', 'requestId', 'executionId']) if (expected[k] !== undefined && receipt[k] !== expected[k]) return null;
    const age = now - Date.parse(receipt.issuedAt); if (!(age >= -60_000 && age <= maxAgeMs)) return null;
    try { if (!verify(null, Buffer.from(canon(receipt)), publicKey, Buffer.from(receipt.sig, 'base64'))) return null; } catch { return null; }
    if (receipt.status === 'complete' && !/^[a-f0-9]{64}$/.test(receipt.replyDigest ?? '')) return null;
    return receipt;
}
