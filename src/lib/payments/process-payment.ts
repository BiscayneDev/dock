import { createServerClient } from '@/lib/supabase/server'
import { getDecryptedOWSTokens, getOWSClient } from '@/lib/integrations/openwallet'
import { logger } from '@/lib/logger'
import {
  USDC_CONTRACTS,
  CURRENCY,
  isEVMChain,
  isSolanaChain,
  isSupportedChain,
  toOnChainAmount,
} from './constants'

interface PaymentResult {
  success: boolean
  paymentId?: string
  txHash?: string
  error?: string
}

function buildEVMTransferTx(
  to: string,
  amount: number,
  chain: string
): Record<string, unknown> {
  const tokenContract = USDC_CONTRACTS[chain]
  const onChainAmount = toOnChainAmount(amount, chain)

  // ERC-20 transfer(address,uint256) function selector + ABI-encoded args
  const amountHex = onChainAmount.toString(16).padStart(64, '0')
  const toClean = to.toLowerCase().replace('0x', '').padStart(64, '0')
  const data = `0xa9059cbb${toClean}${amountHex}`

  return {
    to: tokenContract,
    data,
    value: '0x0',
  }
}

function buildSolanaTransferTx(
  to: string,
  amount: number,
  chain: string
): Record<string, unknown> {
  const tokenMint = USDC_CONTRACTS[chain]
  const onChainAmount = toOnChainAmount(amount, chain)

  return {
    type: 'spl_transfer',
    mint: tokenMint,
    to,
    amount: onChainAmount.toString(),
  }
}

export async function processRecipePayment(
  payerId: string,
  recipientAddress: string,
  amount: number,
  chain: string
): Promise<PaymentResult> {
  if (!isSupportedChain(chain)) {
    return { success: false, error: `Unsupported chain: ${chain}` }
  }

  const supabase = createServerClient()

  // Get payer's wallet client
  const tokens = await getDecryptedOWSTokens(payerId)
  if (!tokens) {
    return { success: false, error: 'No wallet connected. Connect a MoonPay wallet to run paid recipes.' }
  }

  const client = getOWSClient(tokens)

  // Get payer's first wallet
  const walletsRes = await client.listWallets()
  if (!walletsRes.ok || !walletsRes.data) {
    return { success: false, error: 'Failed to access wallet' }
  }

  const wallets = walletsRes.data as Array<{ id: string }>
  if (wallets.length === 0) {
    return { success: false, error: 'No wallets found. Create a wallet with `mp wallet create`.' }
  }

  const walletId = wallets[0].id

  // Build transaction based on chain type
  const tx = isEVMChain(chain)
    ? buildEVMTransferTx(recipientAddress, amount, chain)
    : isSolanaChain(chain)
      ? buildSolanaTransferTx(recipientAddress, amount, chain)
      : null

  if (!tx) {
    return { success: false, error: `Cannot build transaction for chain: ${chain}` }
  }

  // Create pending payment record
  const { data: payment, error: insertError } = await supabase
    .from('recipe_payments')
    .insert({
      recipe_id: '00000000-0000-0000-0000-000000000000', // Caller updates this
      payer_id: payerId,
      recipient_id: payerId, // Caller updates this
      amount,
      currency: CURRENCY,
      chain,
      status: 'pending',
    })
    .select('id')
    .single()

  if (insertError || !payment) {
    logger.error('Failed to create payment record', { error: insertError?.message })
    return { success: false, error: 'Failed to initiate payment' }
  }

  // Simulate first
  const simResult = await client.simulate(walletId, chain, tx)
  if (!simResult.ok) {
    await supabase
      .from('recipe_payments')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', payment.id)

    logger.error('Payment simulation failed', { paymentId: payment.id, error: simResult.error })
    return {
      success: false,
      paymentId: payment.id as string,
      error: `Payment simulation failed: ${simResult.error}`,
    }
  }

  // Sign and send
  const sendResult = await client.signAndSend(walletId, chain, tx)
  if (!sendResult.ok) {
    await supabase
      .from('recipe_payments')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', payment.id)

    logger.error('Payment send failed', { paymentId: payment.id, error: sendResult.error })
    return {
      success: false,
      paymentId: payment.id as string,
      error: `Payment failed: ${sendResult.error}`,
    }
  }

  // Extract tx hash from response
  const txData = sendResult.data as { hash?: string; signature?: string; txHash?: string }
  const txHash = txData.hash ?? txData.signature ?? txData.txHash ?? null

  // Mark payment as completed
  await supabase
    .from('recipe_payments')
    .update({
      status: 'completed',
      tx_hash: txHash,
      completed_at: new Date().toISOString(),
    })
    .eq('id', payment.id)

  logger.info('Recipe payment completed', {
    paymentId: payment.id,
    txHash,
    amount,
    chain,
  })

  return {
    success: true,
    paymentId: payment.id as string,
    txHash: txHash ?? undefined,
  }
}

export async function updatePaymentContext(
  paymentId: string,
  recipeId: string,
  recipientId: string,
  recipeRunId?: string
): Promise<void> {
  const supabase = createServerClient()

  await supabase
    .from('recipe_payments')
    .update({
      recipe_id: recipeId,
      recipient_id: recipientId,
      recipe_run_id: recipeRunId ?? null,
    })
    .eq('id', paymentId)
}
