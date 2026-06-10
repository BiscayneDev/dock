import {
  payboxSigner,
  payboxSettle,
  PaymentError,
  MissingDependencyError,
} from 'shipyard-inference'
import {
  getPayboxTokensForUser,
  getPayboxSigningKey,
  getPayboxSdk,
} from '@/lib/integrations/paybox'
import { createServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

// Per-user meter-then-settle billing. Each completed request accrues
// inference_usage.charged_usd (actual + margin, clamped to baseline). Once a
// user's unsettled balance crosses the threshold, we transfer that USDC from
// their own Paybox wallet to the treasury on Solana.
//
// Safety model (see migration 008): claim -> settle (on-chain) -> finalize.
// claim_settlement stamps the exact billed rows under a per-user advisory lock,
// so concurrent crons never double-claim. The one window the DB can't close is a
// crash AFTER the chain confirms but BEFORE finalize — so on any settle error we
// classify pre- vs post-broadcast: pre-broadcast failures release the claim
// (rows re-accrue); post-broadcast/ambiguous failures are FROZEN (rows kept
// stamped, settlement marked failed) for manual review, never auto-charged twice.

function settleNetwork(): 'devnet' | 'mainnet' {
  return process.env.SHIPYARD_SETTLE_NETWORK === 'mainnet' ? 'mainnet' : 'devnet'
}
function thresholdUsd(): number {
  return Number(process.env.SHIPYARD_SETTLE_THRESHOLD_USD ?? '1.00')
}

export type SettleOutcome =
  | { status: 'skipped'; reason: 'not_connected' | 'no_signing_key' | 'no_wallet' | 'no_treasury' }
  | { status: 'below_threshold' }
  | { status: 'settled'; settlementId: string; signature: string; owedUsd: number; atomicUsdc: string }
  | { status: 'voided'; settlementId: string; reason: string }
  | { status: 'frozen'; settlementId: string; reason: string }

interface ClaimResult {
  settlement_id: string
  owed_usd: number
  atomic_usdc: string
}

/**
 * Errors that provably occurred BEFORE the transaction was broadcast — safe to
 * void (release the claim so the rows re-accrue). Everything inside payboxSettle
 * up to and including signing happens pre-broadcast; the amount validation,
 * missing Solana deps, and Paybox sign failures all throw there. Anything we
 * can't positively place pre-broadcast is treated as ambiguous (frozen).
 */
function isPreBroadcast(err: unknown): boolean {
  if (err instanceof MissingDependencyError) return true
  if (err instanceof PaymentError) {
    // payboxSettle's own pre-broadcast guard is the atomic-amount validation;
    // its post-broadcast PaymentError is the "failed on-chain" confirmation.
    return /atomic USDC amount/i.test(err.message)
  }
  const msg = err instanceof Error ? err.message : String(err)
  // Paybox signer failures (no signed tx, denied, approval timeout) are raised
  // while signing — before sendRawTransaction.
  return /Paybox (wallet sign|message sign)|returned no signed transaction|denied|approval|signature/i.test(
    msg,
  )
}

/** Mark a settlement failed WITHOUT releasing its rows (ambiguous post-broadcast). */
async function freezeSettlement(settlementId: string, reason: string): Promise<void> {
  const supabase = createServerClient()
  await supabase
    .from('inference_settlements')
    .update({ status: 'failed', failure_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', settlementId)
    .eq('status', 'pending')
}

/**
 * Settle one user's accrued inference cost, if it's over threshold. Idempotent
 * and safe to call repeatedly / concurrently (the claim is advisory-locked and
 * only ever picks up unclaimed rows). Returns what happened.
 */
export async function settleUser(userId: string): Promise<SettleOutcome> {
  const treasury = process.env.SHIPYARD_TREASURY_WALLET
  if (!treasury) return { status: 'skipped', reason: 'no_treasury' }

  const network = settleNetwork()

  // Preconditions BEFORE claiming, so we never stamp rows for a user who can't pay.
  const tokens = await getPayboxTokensForUser(userId)
  if (!tokens) return { status: 'skipped', reason: 'not_connected' }

  // Without a pbxk1 signing key, payboxSigner would stall at pending_signature
  // until timeout — skip rather than block.
  const signingKey = await getPayboxSigningKey(userId)
  if (!signingKey) return { status: 'skipped', reason: 'no_signing_key' }

  const client = await getPayboxSdk(tokens, userId)

  const creds = await client.listCredentials()
  const wallet = creds.find(
    (c) => c.credential.credential_type === 'wallet' && typeof c.credential.metadata?.address === 'string',
  )
  if (!wallet) return { status: 'skipped', reason: 'no_wallet' }
  const credentialId = wallet.credential.id
  const address = wallet.credential.metadata.address as string

  // Claim under the per-user advisory lock. null => below threshold, nothing stamped.
  const supabase = createServerClient()
  const { data: claim, error: claimErr } = await supabase.rpc('claim_settlement', {
    p_user_id: userId,
    p_threshold: thresholdUsd(),
    p_network: network,
    p_treasury: treasury,
  })
  if (claimErr) throw claimErr
  if (!claim) return { status: 'below_threshold' }

  const { settlement_id, owed_usd, atomic_usdc } = claim as ClaimResult

  try {
    const signer = await payboxSigner({ client, credentialId, network, publicKey: address })
    const res = await payboxSettle({
      signer,
      treasury,
      amount: atomic_usdc,
      network,
      rpcUrl: process.env.SHIPYARD_SETTLE_RPC_URL,
      // Override the canonical Circle devUSDC mint when settling a different USDC
      // token (e.g. Orca/Nebula devUSDC on devnet). Unset => SDK default per network.
      usdcMint: process.env.SHIPYARD_SETTLE_USDC_MINT,
    })
    await supabase.rpc('finalize_settlement', {
      p_settlement_id: settlement_id,
      p_signature: res.signature,
      p_payer: res.payer,
    })
    logger.info('inference settlement settled', {
      userId,
      settlementId: settlement_id,
      signature: res.signature,
      owedUsd: owed_usd,
      network,
    })
    return {
      status: 'settled',
      settlementId: settlement_id,
      signature: res.signature,
      owedUsd: owed_usd,
      atomicUsdc: atomic_usdc,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    if (isPreBroadcast(err)) {
      await supabase.rpc('void_settlement', { p_settlement_id: settlement_id, p_reason: reason })
      logger.warn('inference settlement voided (pre-broadcast); rows released', {
        userId,
        settlementId: settlement_id,
        reason,
      })
      return { status: 'voided', settlementId: settlement_id, reason }
    }
    // Ambiguous: the transfer MAY have landed. Never auto-charge twice — freeze
    // for manual review (always log the settlement id, and signature if any).
    await freezeSettlement(settlement_id, reason)
    logger.error('inference settlement FROZEN (post-broadcast/ambiguous) — needs review', {
      userId,
      settlementId: settlement_id,
      reason,
    })
    return { status: 'frozen', settlementId: settlement_id, reason }
  }
}
