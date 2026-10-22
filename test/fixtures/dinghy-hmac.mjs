// Verbatim logic copied from Dinghy's src/lib/dock/hmac.ts (dinghy branch feat/dock-connector, commit 1f6e270),
// with TypeScript types removed. Dock's signer is tested against this so the two sides agree on the scheme.
// If Dinghy changes its verifier, update this fixture from the Dinghy source and re-run the tests.
import { createHmac, timingSafeEqual } from "crypto"

export const DOCK_REPLAY_WINDOW_SECONDS = 300

export function signDockPayload(secret, timestampSeconds, rawBody) {
  return createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`).digest("hex")
}

export function verifyDockSignature(input) {
  if (!input.secret) return { ok: false, reason: "no_secret" }
  if (!input.timestamp || !input.signature) return { ok: false, reason: "missing" }
  if (!/^\d{1,12}$/.test(input.timestamp)) return { ok: false, reason: "bad_timestamp" }
  const ts = Number(input.timestamp)
  const window = input.windowSeconds ?? DOCK_REPLAY_WINDOW_SECONDS
  if (Math.abs(input.nowSeconds - ts) > window) return { ok: false, reason: "stale" }

  const expected = Buffer.from(signDockPayload(input.secret, ts, input.rawBody), "hex")
  if (!/^[0-9a-f]{64}$/i.test(input.signature)) return { ok: false, reason: "bad_signature" }
  const provided = Buffer.from(input.signature, "hex")
  if (provided.length !== expected.length) return { ok: false, reason: "bad_signature" }
  return timingSafeEqual(provided, expected) ? { ok: true } : { ok: false, reason: "bad_signature" }
}
