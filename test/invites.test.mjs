import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INVITE_TTL_DAYS,
  MAX_EMAIL_LENGTH,
  MAX_TOKEN_LENGTH,
  normalizeInviteEmail,
  inviteTtlMs,
  inviteShareUrl,
  isInviteTokenShape,
  inviteStatus,
  isAlreadyRegisteredError,
} from "../lib/invites.ts";

const TOKEN = "AbCdEf0123456789_abCdEf0123456789_abC-_XYZW"; // 43 base64url chars, like newInviteToken()

test("default invite TTL is seven days", () => {
  assert.equal(DEFAULT_INVITE_TTL_DAYS, 7);
  const result = inviteTtlMs();
  assert.deepEqual(result, { ok: true, value: 7 * 86_400_000 });
  assert.deepEqual(inviteTtlMs(undefined), result);
});

test("custom TTL is day-based and positive", () => {
  assert.deepEqual(inviteTtlMs(1), { ok: true, value: 86_400_000 });
  assert.deepEqual(inviteTtlMs(30), { ok: true, value: 30 * 86_400_000 });
});

test("TTL rejects non-finite and non-positive values as a typed result", () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "7", null, {}, true]) {
    const result = inviteTtlMs(bad);
    assert.equal(result.ok, false, String(bad));
    assert.equal(result.code, "invalid_ttl", String(bad));
    assert.equal(typeof result.error, "string");
  }
});

test("email normalization lowercases and trims", () => {
  assert.deepEqual(normalizeInviteEmail("  Person@Example.COM  "), { ok: true, value: "person@example.com" });
  assert.deepEqual(normalizeInviteEmail("FIRST.LAST+tag@Sub.Example.Org"), {
    ok: true,
    value: "first.last+tag@sub.example.org",
  });
});

test("email validation rejects malformed input and oversized addresses", () => {
  const longLocal = "a".repeat(MAX_EMAIL_LENGTH - 4);
  for (const bad of ["", "   ", "person", "person@", "@example.com", "a@b", "a@@b.com", "a b@c.com", 42, null, undefined, {}, `${longLocal}@x.co`]) {
    const result = normalizeInviteEmail(bad);
    assert.equal(result.ok, false, String(bad));
    assert.equal(result.code, "invalid_email", String(bad));
  }
  assert.equal(normalizeInviteEmail(`a@${"b".repeat(250)}.com`).ok, false);
});

test("share URL uses a bare origin and encodes the token once", () => {
  assert.equal(isInviteTokenShape(TOKEN), true);
  assert.deepEqual(inviteShareUrl("https://dock.example.com", TOKEN), {
    ok: true,
    value: `https://dock.example.com/login?invite=${TOKEN}`,
  });
  assert.deepEqual(inviteShareUrl("http://localhost:3000/", TOKEN), {
    ok: true,
    value: `http://localhost:3000/login?invite=${TOKEN}`,
  });

  const unsafe = "a+b/c?d=e&f#g";
  const built = inviteShareUrl("https://dock.example.com", unsafe);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.value, "https://dock.example.com/login?invite=a%2Bb%2Fc%3Fd%3De%26f%23g");
  assert.equal(new URL(built.value).searchParams.get("invite"), unsafe);
});

test("share URL rejects unsafe origins and invalid tokens", () => {
  for (const badOrigin of ["javascript:alert(1)", "https://dock.example.com/path", "https://dock.example.com/?x=1", "https://dock.example.com/#x", "https://user:pw@dock.example.com", "", null, 7]) {
    const result = inviteShareUrl(badOrigin, TOKEN);
    assert.equal(result.ok, false, String(badOrigin));
    assert.equal(result.code, "invalid_origin", String(badOrigin));
  }
  for (const badToken of ["", "   ", "has space", "x".repeat(MAX_TOKEN_LENGTH + 1), null, 12]) {
    const result = inviteShareUrl("https://dock.example.com", badToken);
    assert.equal(result.ok, false, String(badToken));
    assert.equal(result.code, "invalid_token", String(badToken));
  }
  assert.equal(isInviteTokenShape("short"), false);
  assert.equal(isInviteTokenShape("a+b/c?d=e&f"), false);
  assert.equal(isInviteTokenShape(null), false);
});

test("already-registered errors are idempotent; everything else is not", () => {
  assert.equal(isAlreadyRegisteredError("A user with this email address has already been registered"), true);
  assert.equal(isAlreadyRegisteredError("User already registered"), true);
  assert.equal(isAlreadyRegisteredError("already exists"), true);
  assert.equal(isAlreadyRegisteredError("Signups not allowed for this instance"), false);
  assert.equal(isAlreadyRegisteredError(null), false);
  assert.equal(isAlreadyRegisteredError(undefined), false);
});

test("invite status prefers used, then expired, then pending", () => {
  const now = Date.parse("2026-11-27T12:00:00.000Z");
  const future = "2026-12-01T00:00:00.000Z";
  const past = "2026-11-01T00:00:00.000Z";
  assert.equal(inviteStatus({ expires_at: future }, now), "pending");
  assert.equal(inviteStatus({ expires_at: past }, now), "expired");
  assert.equal(inviteStatus({ expires_at: future, used_at: "2026-11-20T00:00:00.000Z" }, now), "used");
  assert.equal(inviteStatus({ expires_at: "not-a-date" }, now), "expired");
  assert.equal(inviteStatus({ expires_at: future, used_at: null }, now), "pending");
});
