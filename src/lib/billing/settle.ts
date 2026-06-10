import {
  payboxSigner,
  payboxSettle,
  PaymentError,
  MissingDependencyError,
} from 'shipyard-inference'
import { getPayboxTokensForUser, getPayboxSdk } from '@/lib/integrations/paybox'
import { createServerClient } from '@/lib/supabase/server'
import { sendMessage } from '@/lib/telegram/client'
import { logger } from '@/lib/logger'

// Keyless, passkey-approved meter-then-settle billing. Each request accrues
// inference_usage.charged_usd (actual + margin, capped at baseline). When a user
// crosses the threshold *during a chat* (so they're present to approve), we ask
// Paybox to sign a USDC transfer from their wallet to the treasury — Paybox
// returns pending_approval, the user taps approve in their Paybox app (passkey),
// and we broadcast the signed tx. Dock never holds a signing key.
//
// Safety (migration 008): claim -> settle -> finalize. claim_settlement stamps the
// billed rows under a per-user advisory lock. On a pre-broadcast failure (no
// approval in time, denied) we void (rows re-accrue, re-prompt next turn). On an
// ambiguous post-broadcast failure we freeze the rows for review — never double-charge.
//
// The approval wait is bounded to fit Solana's ~90s blockhash validity: the tx is
// built with a recent blockhash, so the user must approve within the window or the
// signed tx would be stale. We run inside the webhook's after() callback, so the
// ~55s wait doesn't delay the Telegram response.

const APPROVAL_WINDOW_MS = 55_000

function settleNetwork(): 'devnet' | 'mainnet' {
  return process.env.SHIPYARD_SETTLE_NETWORK === 'mainnet' ? 'mainnet' : 'devnet'
}
function thresholdUsd(): number {
  return Number(process.env.SHIPYARD_SETTLE_THRESHOLD_USD ?? '1.00')
}
function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n < 0.01 ? 4 : 2 })}`
}

export type SettleOutcome =
  | { status: 'skipped'; reason: 'no_treasury' | 'not_connected' | 'no_wallet' }
  | { status: 'below_threshold' }
  | { status: 'settled'; settlementId: string; signature: string; owedUsd: number; atomicUsdc: string }
  | { status: 'voided'; settlementId: string; reason: string }
  | { status: 'frozen'; settlementId: string; reason: string }

interface ClaimResult {
  settlement_id: string
  owed_usd: number
  atomic_usdc: string
}

function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Errors that provably occurred BEFORE the transaction was broadcast — safe to
 * void (release the claim so the rows re-accrue and we re-prompt next turn).
 * Signing/approval happens before sendRawTransaction, so an approval timeout,
 * denial, or missing-deps error is pre-broadcast. Anything we can't positively
 * place pre-broadcast is treated as ambiguous (frozen, never auto-charged twice).
 */
function isPreBroadcast(err: unknown): boolean {
  if (err instanceof MissingDependencyError) return true
  if (err instanceof PaymentError) return /atomic USDC amount/i.test(err.message)
  return /Paybox (wallet sign|message sign)|returned no signed transaction|denied|approval|signature|tim/i.test(
    msgOf(err),
  )
}

/** Mark a settlement failed WITHOUT releasing its rows (ambiguous post-broadcast). */
async function freezeSettlement(
  supabase: ReturnType<typeof createServerClient>,
  settlementId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from('inference_settlements')
    .update({ status: 'failed', failure_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', settlementId)
    .eq('status', 'pending')
}

/**
 * Settle a user's accrued inference cost if it's over threshold, asking them to
 * passkey-approve in Paybox. Call this post-turn (the user is present). Cheap to
 * call every turn — the claim returns null below threshold before any Paybox call.
 * Idempotent/safe to repeat: only ever picks up unclaimed rows.
 */
export async function settleUser(userId: string, chatId: number): Promise<SettleOutcome> {
  const treasury = process.env.SHIPYARD_TREASURY_WALLET
  if (!treasury) return { status: 'skipped', reason: 'no_treasury' }

  const network = settleNetwork()
  const supabase = createServerClient()

  // Claim first — cheap, and returns null (no stamping) when below threshold, so
  // the common per-turn case never touches Paybox.
  const { data: claim, error: claimErr } = await supabase.rpc('claim_settlement', {
    p_user_id: userId,
    p_threshold: thresholdUsd(),
    p_network: network,
    p_treasury: treasury,
  })
  if (claimErr) throw claimErr
  if (!claim) return { status: 'below_threshold' }

  const { settlement_id, owed_usd, atomic_usdc } = claim as ClaimResult
  const owedUsd = Number(owed_usd)

  // From here rows are claimed (pending) — we MUST finalize or void before returning.
  const voidOut = async (reason: string): Promise<void> => {
    await supabase.rpc('void_settlement', { p_settlement_id: settlement_id, p_reason: reason })
  }

  const tokens = await getPayboxTokensForUser(userId)
  if (!tokens) {
    await voidOut('paybox_not_connected')
    return { status: 'skipped', reason: 'not_connected' }
  }

  let credentialId: string
  let address: string
  try {
    const client = await getPayboxSdk(tokens, userId)
    const creds = await client.listCredentials()
    const wallet = creds.find(
      (c) =>
        c.credential.credential_type === 'wallet' &&
        typeof c.credential.metadata?.address === 'string',
    )
    if (!wallet) {
      await voidOut('no_wallet_credential')
      return { status: 'skipped', reason: 'no_wallet' }
    }
    credentialId = wallet.credential.id
    address = wallet.credential.metadata.address as string

    // Prompt the user to approve, then run the (bounded) sign + broadcast.
    await sendMessage({
      chatId,
      text:
        `💸 you've used ${fmtUsd(owedUsd)} of inference. open your Paybox app and approve the ` +
        `wallet request to settle it from your wallet — you've got about a minute.`,
    })

    const signer = await payboxSigner({
      client,
      credentialId,
      network,
      publicKey: address,
      approvalTimeoutMs: APPROVAL_WINDOW_MS,
    })
    const res = await payboxSettle({
      signer,
      treasury,
      amount: atomic_usdc,
      network,
      rpcUrl: process.env.SHIPYARD_SETTLE_RPC_URL,
      usdcMint: process.env.SHIPYARD_SETTLE_USDC_MINT,
    })

    await supabase.rpc('finalize_settlement', {
      p_settlement_id: settlement_id,
      p_signature: res.signature,
      p_payer: res.payer,
    })
    await sendMessage({
      chatId,
      text: `✅ settled ${fmtUsd(owedUsd)} from your Paybox wallet — still cheaper than calling the model direct.\ntx: ${res.signature}`,
    })
    logger.info('inference settlement settled', {
      userId,
      settlementId: settlement_id,
      signature: res.signature,
      owedUsd,
      network,
    })
    return {
      status: 'settled',
      settlementId: settlement_id,
      signature: res.signature,
      owedUsd,
      atomicUsdc: atomic_usdc,
    }
  } catch (err) {
    const reason = msgOf(err)
    if (isPreBroadcast(err)) {
      await voidOut(reason)
      logger.warn('inference settlement voided (pre-broadcast); rows released', {
        userId,
        settlementId: settlement_id,
        reason,
      })
      await sendMessage({
        chatId,
        text: `⌛ didn't get your approval in time — no worries, i'll ask again next time.`,
      }).catch(() => {})
      return { status: 'voided', settlementId: settlement_id, reason }
    }
    // Ambiguous: the transfer may have landed. Freeze for review — never double-charge.
    await freezeSettlement(supabase, settlement_id, reason)
    logger.error('inference settlement FROZEN (post-broadcast/ambiguous) — needs review', {
      userId,
      settlementId: settlement_id,
      reason,
    })
    return { status: 'frozen', settlementId: settlement_id, reason }
  }
}
