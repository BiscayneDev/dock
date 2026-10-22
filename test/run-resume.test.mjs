import test from "node:test";
import assert from "node:assert/strict";
import { checkpointData, continuationPrompt } from "../lib/run-resume.ts";

test("checkpointData keeps the tail of the output, capped at 8000 chars", () => {
  const short = checkpointData("hello", 42);
  assert.deepEqual(short, { output: "hello", spentCents: 42 });

  const long = "x".repeat(9000) + "TAIL";
  const cp = checkpointData(long, 7);
  assert.equal(cp.output.length, 8000);
  assert.ok(cp.output.endsWith("TAIL"), "keeps the END of the output");
  assert.equal(cp.spentCents, 7);
});

test("continuationPrompt returns the original prompt when there is no snapshot", () => {
  assert.equal(continuationPrompt("do the thing", null), "do the thing");
  assert.equal(continuationPrompt("do the thing", {}), "do the thing");
  assert.equal(continuationPrompt("do the thing", { output: "" }), "do the thing");
  assert.equal(continuationPrompt("do the thing", { output: 7 }), "do the thing");
});

test("continuationPrompt builds a continuation prompt from a snapshot", () => {
  const out = continuationPrompt("finish the task", { output: "partial work", spentCents: 3 });
  assert.ok(out.includes("CONTINUATION"), "mentions continuation");
  assert.ok(out.includes("partial work"), "carries prior output");
  assert.ok(out.includes("finish the task"), "carries original prompt");
  // long prior output is truncated to 8000 chars from the END
  const long = "y".repeat(9000) + "END";
  const trunc = continuationPrompt("go", { output: long });
  assert.ok(trunc.length < 8300, "prior output truncated");
  assert.ok(trunc.includes("END"));
});

// End-to-end-style composition: checkpoint event -> resumePlan -> continuationPrompt,
// mirroring how lib/worker.ts wires the pieces together for a retried run.
import { resumePlan } from "../lib/task-runs.ts";

test("resumed run wiring: a checkpoint event produces a continuation prompt", () => {
  const events = [
    { kind: "model_call", data: { costCents: 5 } },
    { kind: "checkpoint", data: { step: 1, snapshot: checkpointData("partial output so far", 5) } },
  ];
  const plan = resumePlan("queued", events);
  assert.ok(plan.ok, "non-terminal run with a checkpoint is resumable");
  assert.equal(plan.fromStep, 1);
  const prompt = continuationPrompt("original request", plan.snapshot);
  assert.ok(prompt.includes("CONTINUATION"), "prompt marks the run as a continuation");
  assert.ok(prompt.includes("partial output so far"), "prior output carried through");
  assert.ok(prompt.includes("original request"), "original prompt preserved");
});

test("resumed run wiring: empty-output failure checkpoint resumes ledger state, prompt unchanged", () => {
  // Failure-path checkpoint written by the worker: empty output, spend carried forward.
  const events = [{ kind: "checkpoint", data: { step: 1, snapshot: checkpointData("", 12) } }];
  const plan = resumePlan("queued", events);
  assert.ok(plan.ok);
  assert.equal(plan.fromStep, 1, "fromStep > 0 so resumePlan reports the run as resumed");
  assert.equal(continuationPrompt("original request", plan.snapshot), "original request",
    "empty snapshot output leaves the prompt unchanged");
});
