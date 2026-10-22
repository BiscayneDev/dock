// Money action types. Must match MONEY_ACTION_TYPES in lib/task-runs.ts; test/devices.test.mjs checks the two lists agree.
export const MONEY_ACTION_TYPES = Object.freeze(["x402_spend", "moonpay_refund", "payout_change"])

export function isMoneyAction(action) {
  return Boolean(action && typeof action === "object" && MONEY_ACTION_TYPES.includes(action.type))
}
