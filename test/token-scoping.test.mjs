import test from "node:test";
import assert from "node:assert/strict";
import { tokenScoping } from "../lib/token-scoping.ts";

test("tokenScoping binds in single-workspace (and zero-workspace edge) deployments", () => {
  assert.equal(tokenScoping(0), "bind");
  assert.equal(tokenScoping(1), "bind");
});

test("tokenScoping rejects in multi-workspace deployments", () => {
  assert.equal(tokenScoping(2), "reject");
  assert.equal(tokenScoping(7), "reject");
});

test("tokenScoping rejects non-numeric/garbage counts defensively", () => {
  assert.equal(tokenScoping(-1), "bind"); // impossible via count query; treat as not multi
  assert.equal(tokenScoping(Number.NaN), "reject"); // unknown count fails closed
});
