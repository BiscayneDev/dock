import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  buildAuthorizeUrl, decryptSecret, encryptSecret, generateState, generateVerifier,
  pkceChallenge, redactForLog, stateMatches,
} from "../lib/shipyard-connect.ts";

const KEY = randomBytes(32).toString("base64");
const OTHER = randomBytes(32).toString("base64");

test("verifier is 43-128 chars and challenge is S256 of it", () => {
  const v = generateVerifier();
  assert.ok(v.length >= 43 && v.length <= 128);
  assert.equal(pkceChallenge(v), pkceChallenge(v));
  assert.notEqual(pkceChallenge(v), v);
});

test("authorize URL carries the challenge, never the verifier", () => {
  const v = generateVerifier();
  const url = buildAuthorizeUrl("https://shipyard.example", {
    redirectUri: "https://dock-harness.vercel.app/api/connect/shipyard/callback",
    state: generateState(), challenge: pkceChallenge(v), workspace: "ws-1",
  });
  const u = new URL(url);
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("code_challenge"), pkceChallenge(v));
  assert.ok(!url.includes(v), "verifier must not appear in the browser URL");
  assert.equal(u.searchParams.get("scope"), "chat:write route:preview");
});

test("state mismatch, missing, or empty is refused", () => {
  const s = generateState();
  assert.equal(stateMatches(s, s), true);
  assert.equal(stateMatches(s, generateState()), false);
  assert.equal(stateMatches(s, null), false);
  assert.equal(stateMatches(s, undefined), false);
  assert.equal(stateMatches("", ""), false);
});

test("key encryption round-trips; tamper and wrong key fail", () => {
  const blob = encryptSecret("sk-shipyard-test-value", KEY);
  assert.ok(!blob.includes("sk-shipyard"), "ciphertext must not contain plaintext");
  assert.equal(decryptSecret(blob, KEY), "sk-shipyard-test-value");
  assert.throws(() => decryptSecret(blob, OTHER));
  const parts = blob.split(".");
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
  assert.throws(() => decryptSecret(parts.join("."), KEY));
});

test("log redaction removes gateway keys and bearer tokens", () => {
  const out = redactForLog("upstream 401 for sk-shipyard-abc123_XYZ and Authorization: Bearer sk-shipyard-zzz");
  assert.ok(!out.includes("abc123"));
  assert.ok(!out.includes("zzz"));
  assert.match(out, /\[redacted\]/);
});
