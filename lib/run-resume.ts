/**
 * Run resume helpers (pure, no imports) so node tests can load this file directly.
 *
 * Each run executes as a SINGLE model call, so "resume" means: the prior output becomes
 * continuation context on the next attempt. Checkpoints carry the tail of the prior output
 * (capped) plus the spend at checkpoint time.
 */

/** Maximum characters of prior output stored in a checkpoint / injected into a continuation. */
export const OUTPUT_SNAPSHOT_LIMIT = 8000

/**
 * Checkpoint payload for a run's prior output. Keeps the END of the output (the most recent
 * context) truncated to OUTPUT_SNAPSHOT_LIMIT characters.
 */
export function checkpointData(output: string, spentCents: number): Record<string, unknown> {
  return {
    output: output.slice(-OUTPUT_SNAPSHOT_LIMIT),
    spentCents,
  }
}

/**
 * Prompt for a resumed run. When the snapshot carries a non-empty prior output, wraps the
 * original prompt in a CONTINUATION note asking the model to pick up where it left off.
 * Otherwise the original prompt is returned unchanged.
 */
export function continuationPrompt(
  originalPrompt: string,
  snapshot: Record<string, unknown> | null,
): string {
  const prior = snapshot && typeof snapshot.output === "string" ? snapshot.output : ""
  if (!prior) return originalPrompt
  const tail = prior.slice(-OUTPUT_SNAPSHOT_LIMIT)
  return [
    "[CONTINUATION] A previous attempt at this run produced partial output before stopping.",
    "Continue from where it left off; do not start over from scratch.",
    "",
    "Prior output (last portion):",
    tail,
    "",
    "Original request:",
    originalPrompt,
  ].join("\n")
}
